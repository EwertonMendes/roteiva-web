import { importPKCS8, SignJWT } from 'jose';
import { ApiError, type Env } from './types.ts';

// Dedicated minimal-IAM Google service account, stored only as a Cloudflare Worker secret.
const PROJECT='roteiva-web-dev';
const FIRESTORE='https://firestore.googleapis.com/v1/projects/'+PROJECT+'/databases/(default)/documents';
const IDENTITY='https://identitytoolkit.googleapis.com/v1/projects/'+PROJECT+'/accounts';
type Account={type:string;project_id:string;client_email:string;private_key:string;token_uri:string};
function credentials(env:Env):Account {
  if(env.ENVIRONMENT!=='dev'||env.FIREBASE_PROJECT_ID!==PROJECT||env.ACCOUNT_DELETION_ENABLED!=='true')
    throw new ApiError(503,'deletion_unavailable');
  let value:Account;
  try {value=JSON.parse(env.FIREBASE_ADMIN_CREDENTIALS_JSON||'') as Account;}
  catch {throw new ApiError(503,'deletion_unavailable');}
  if(value.type!=='service_account'||value.project_id!==PROJECT||
    !value.client_email?.endsWith('.iam.gserviceaccount.com')||
    !value.private_key?.includes('BEGIN PRIVATE KEY')||
    value.token_uri!=='https://oauth2.googleapis.com/token')
      throw new ApiError(503,'deletion_unavailable');
  return value;
}
export function deletionConfigured(env:Env):boolean {
  try{credentials(env);return true;}catch{return false;}
}
export async function adminToken(env:Env,fetcher:typeof fetch=fetch):Promise<string> {
  const a=credentials(env);
  let assertion:string;
  try {
    const now=Math.floor(Date.now()/1000);
    assertion=await new SignJWT({scope:'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/identitytoolkit'})
      .setProtectedHeader({alg:'RS256',typ:'JWT'}).setIssuer(a.client_email)
      .setAudience(a.token_uri).setIssuedAt(now).setExpirationTime(now+300)
      .sign(await importPKCS8(a.private_key,'RS256'));
  }catch{throw new ApiError(503,'admin_token_unavailable');}
  let response:Response;
  try{response=await fetcher(a.token_uri,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion}),
    signal:AbortSignal.timeout(10000)});}
  catch{throw new ApiError(503,'admin_token_unavailable');}
  if(!response.ok)throw new ApiError(503,'admin_token_unavailable');
  const data=await response.json() as {access_token?:string};
  if(!data.access_token)throw new ApiError(503,'admin_token_unavailable');
  return data.access_token;
}
async function adminRequest(url:string,token:string,method:'POST'|'PATCH'|'DELETE',
  body?:unknown,fetcher:typeof fetch=fetch):Promise<Record<string,unknown>>{
  let response:Response;
  try{response=await fetcher(url,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});}
  catch{throw new ApiError(503,'admin_service_unavailable');}
  if(response.status===404)return {missing:true};
  if(response.status===403)throw new ApiError(503,'admin_permission_denied');
  if(!response.ok)throw new ApiError(503,'admin_service_unavailable');
  if(response.status===204)return {};
  return response.json().catch(()=>({})) as Promise<Record<string,unknown>>;
}
function uidPart(uid:string):string{
  if(!/^[A-Za-z0-9_-]{1,128}$/.test(uid))throw new ApiError(400,'invalid_identity');
  return encodeURIComponent(uid);
}
const root=(uid:string)=>FIRESTORE+'/users/'+uidPart(uid);
export async function lockAccount(uid:string,token:string,fetcher:typeof fetch=fetch){
  const data=await adminRequest(root(uid)+'?updateMask.fieldPaths=deletionState&updateMask.fieldPaths=ownerUid',
    token,'PATCH',{fields:{deletionState:{stringValue:'deleting'},ownerUid:{stringValue:uid}}},fetcher);
  if(data.missing)throw new ApiError(503,'admin_service_unavailable');
}
async function collectionIds(parent:string,token:string,fetcher:typeof fetch):Promise<string[]>{
  const result=await adminRequest(parent+':listCollectionIds',token,'POST',{pageSize:100},fetcher);
  if(result.missing)return [];
  if(result.nextPageToken)throw new ApiError(503,'unexpected_collection_fanout');
  const ids=result.collectionIds;
  if(ids!==undefined&&!Array.isArray(ids))throw new ApiError(503,'admin_service_unavailable');
  return (ids as string[]||[]).filter(x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(x));
}
async function documents(collection:string,token:string,fetcher:typeof fetch):Promise<{name:string}[]>{
  let r:Response;
  try{r=await fetcher(collection+'?pageSize=30&showMissing=true',
    {headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(15000)});}
  catch{throw new ApiError(503,'admin_service_unavailable');}
  if(r.status===404)return [];
  if(!r.ok)throw new ApiError(503,r.status===403?'admin_permission_denied':'admin_service_unavailable');
  const data=await r.json() as {documents?:{name:string}[]};
  return data.documents||[];
}
export async function deleteFirestoreChunk(uid:string,token:string,maxDeletes=20,fetcher:typeof fetch=fetch):Promise<boolean>{
  let left=maxDeletes;
  const prefix='projects/'+PROJECT+'/databases/(default)/documents/users/'+uidPart(uid)+'/';
  async function walk(parent:string,depth:number):Promise<void>{
    if(left<=0)return;
    if(depth>16)throw new ApiError(503,'unexpected_collection_depth');
    for(const id of await collectionIds(parent,token,fetcher)){
      if(left<=0)return;
      for(const doc of await documents(parent+'/'+encodeURIComponent(id),token,fetcher)){
        if(left<=0)return;
        if(!doc.name.startsWith(prefix))throw new ApiError(503,'invalid_firestore_path');
        const child=FIRESTORE+'/'+doc.name.split('/documents/')[1];
        await walk(child,depth+1);
        if(left<=0)return;
        await adminRequest(child,token,'DELETE',undefined,fetcher);
        left--;
      }
    }
  }
  await walk(root(uid),0);
  return left>0 && (await collectionIds(root(uid),token,fetcher)).length===0;
}
export async function deleteRoot(uid:string,token:string,fetcher:typeof fetch=fetch){
  if((await collectionIds(root(uid),token,fetcher)).length)throw new ApiError(503,'firestore_not_empty');
  await adminRequest(root(uid),token,'DELETE',undefined,fetcher);
}
export async function deleteIdentity(uid:string,token:string,fetcher:typeof fetch=fetch){
  let response:Response;
  try{response=await fetcher(IDENTITY+':delete',{method:'POST',
    headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    body:JSON.stringify({localId:uid}),signal:AbortSignal.timeout(15000)});}
  catch{throw new ApiError(503,'admin_service_unavailable');}
  if(response.ok)return;
  if(response.status===400||response.status===404){
    // Retry after a successful remote deletion may report USER_NOT_FOUND.
    const error=await response.json().catch(()=>({})) as {error?:{message?:string}};
    if(error.error?.message==='USER_NOT_FOUND')return;
  }
  if(response.status===403)throw new ApiError(503,'admin_permission_denied');
  throw new ApiError(503,'admin_service_unavailable');
}
