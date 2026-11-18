import {ApiError,type Env} from './types.ts';
import {adminToken} from './firebase-admin.ts';

type Value={integerValue?:string;stringValue?:string;timestampValue?:string;mapValue?:{fields?:Record<string,Value>}};
type FirestoreDocument={name:string;updateTime:string;fields:Record<string,Value>};
type Domain='projects'|'tasks'|'events'|'financeEntries';
const DOMAINS:readonly Domain[]=['projects','tasks','events','financeEntries'];
const MAX_BATCH=15;
const ownerId=/^[A-Za-z0-9_-]{1,128}$/;
const collectionNames=['tasks','events','financeEntries','driveFolders','dropboxFolders'] as const;
function prefix(env:Env,uid:string){
  if(!ownerId.test(uid))throw new ApiError(400,'invalid_identity');
  return 'https://firestore.googleapis.com/v1/projects/'+encodeURIComponent(env.FIREBASE_PROJECT_ID)+
    '/databases/(default)/documents/users/'+encodeURIComponent(uid);
}
async function request<T>(url:string,token:string,method:'GET'|'POST'|'PATCH',body?:unknown):Promise<T>{
  let response:Response;
  try{response=await fetch(url,{method,redirect:'manual',
    headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});}
  catch{throw new ApiError(503,'project_firestore_unavailable');}
  if(!response.ok)throw new ApiError(response.status===404?404:response.status===409||response.status===412?409:503,
    response.status===404?'project_firestore_missing':response.status===409||response.status===412?'project_firestore_conflict':'project_firestore_unavailable');
  return response.json() as Promise<T>;
}
function integer(value:Value|undefined):number{
  const text=value?.integerValue;
  const number=Number(text);
  if(!text||!Number.isSafeInteger(number)||number<0)throw new ApiError(503,'project_firestore_invalid_record');
  return number;
}
function counter(doc:FirestoreDocument){
  const fields=doc.fields;
  const current=integer(fields.revision);
  const domains=fields.domains?.mapValue?.fields,counts=fields.counts?.mapValue?.fields;
  if(!domains||!counts)throw new ApiError(503,'project_sync_invalid');
  const revisions:Record<string,Value>={},sizes:Record<string,Value>={};
  for(const name of ['clients',...DOMAINS.slice(0,2),'deliveries','events','financeEntries','activities']){
    revisions[name]={integerValue:String(integer(domains[name]))};
    sizes[name]={integerValue:String(integer(counts[name]))};
  }
  return {current,revisions,sizes};
}
const iv=(x:number):Value=>({integerValue:String(x)});
const time=():Value=>({timestampValue:new Date().toISOString()});
async function projectDocs(env:Env,uid:string,token:string,collection:string,id:number):Promise<FirestoreDocument[]>{
  const data=await request<Array<{document?:FirestoreDocument}>>(prefix(env,uid)+':runQuery',token,'POST',{
    structuredQuery:{from:[{collectionId:collection}],
      where:{fieldFilter:{field:{fieldPath:'projectId'},op:'EQUAL',value:iv(id)}},
      limit:MAX_BATCH}
  });
  if(!Array.isArray(data))throw new ApiError(503,'project_firestore_invalid_record');
  const path='/users/'+encodeURIComponent(uid)+'/'+collection+'/';
  return data.flatMap(row=>row.document?[row.document]:[]).map(row=>{
    if(!row.name.includes(path)||!row.updateTime||!row.fields)throw new ApiError(503,'project_firestore_invalid_record');
    return row;
  });
}
async function commit(env:Env,uid:string,token:string,domain:Domain|null,docs:FirestoreDocument[],mode:'delete'|'detach'):Promise<void>{
  if(!docs.length)return;
  const parent=prefix(env,uid);
  let sync:FirestoreDocument|undefined;
  let state:ReturnType<typeof counter>|undefined;
  if(domain){
    sync=await request<FirestoreDocument>(parent+'/sync/state',token,'GET');
    if(!sync?.updateTime)throw new ApiError(503,'project_sync_invalid');
    state=counter(sync);
    state.revisions[domain]=iv(integer(state.revisions[domain])+1);
    if(mode==='delete'){
      const remaining=integer(state.sizes[domain])-docs.length;
      if(remaining<0)throw new ApiError(503,'project_sync_invalid');
      state.sizes[domain]=iv(remaining);
    }
  }
  const writes=docs.map(document=>{
    if(mode==='delete')return {delete:document.name,currentDocument:{updateTime:document.updateTime}};
    return {update:{name:document.name,fields:{
      projectId:iv(0),revision:iv(integer(document.fields.revision)+1),updatedAt:time()
    }},updateMask:{fieldPaths:['projectId','revision','updatedAt']},
    currentDocument:{updateTime:document.updateTime}};
  });
  if(sync&&state)writes.push({
    update:{name:sync.name,fields:{revision:iv(state.current+1),
      domains:{mapValue:{fields:state.revisions}},counts:{mapValue:{fields:state.sizes}},updatedAt:time()}},
    updateMask:{fieldPaths:['revision','domains','counts','updatedAt']},
    currentDocument:{updateTime:sync.updateTime}
  } as typeof writes[number]);
  await request(parent.replace('/users/'+encodeURIComponent(uid),'')+':commit',token,'POST',{writes});
}

/** Persistent, admin-only fence blocks stale/offline client writes before cleanup. */
export async function fenceProject(env:Env,uid:string,id:number):Promise<void>{
  const token=await adminToken(env);
  await request(prefix(env,uid)+'/projectDeletionFences/'+id+
    '?updateMask.fieldPaths=ownerUid&updateMask.fieldPaths=projectId',
    token,'PATCH',{fields:{ownerUid:{stringValue:uid},projectId:iv(id)}});
}

/** Returns false after one bounded, atomic Firestore batch; true only when verified empty. */
export async function eraseProjectFirestoreChunk(env:Env,uid:string,id:number):Promise<boolean>{
  const token=await adminToken(env),parent=prefix(env,uid);
  for(const collection of collectionNames){
    const docs=await projectDocs(env,uid,token,collection,id);
    if(!docs.length)continue;
    const domain=collection==='tasks'||collection==='events'||collection==='financeEntries'?collection:null;
    await commit(env,uid,token,domain,docs,collection==='financeEntries'?'detach':'delete');
    return false;
  }
  let project:FirestoreDocument|null=null;
  try{project=await request<FirestoreDocument>(parent+'/projects/'+id,token,'GET');}
  catch(error){
    // A 404 is the idempotent completed state, but never mask service failures.
    if(error instanceof ApiError&&error.code==='project_firestore_missing')return true;
    throw error;
  }
  if(!project?.fields||project.fields.ownerUid?.stringValue!==uid)
    throw new ApiError(503,'project_firestore_invalid_record');
  // One final check rejects a late linked write rather than claiming completion.
  for(const name of collectionNames)if((await projectDocs(env,uid,token,name,id)).length)
    return false;
  await commit(env,uid,token,'projects',[project],'delete');
  return false;
}
