import { ApiError, type Env, type Connection } from './types.ts';
import { identity, verifiedTrialPrincipal } from './auth.ts';
import { assertActiveAccess } from './access.ts';
import { connection } from './repository.ts';
import { DRIVE_SCOPE, accessCredential } from './google.ts';
import { driveJson } from './drive-client.ts';
import { random, hash, encrypt, decrypt, context } from './crypto.ts';
import { uploadBody } from './uploads.ts';
import {mintReviewMediaTicket,streamReviewMedia} from './review-media.ts';

type Status = 'draft'|'publishing'|'pending'|'changes'|'approved'|'replacing'|'closing'|'closed';
type Mode = 'link'|'google';
type Review = {
  id:string;owner_uid:string;client_id:number;project_id:number;client_name:string;project_name:string;
  studio_name:string;title:string;message:string;recipient_email:string;access_mode:Mode;status:Status;
  current_version:number;expires_at:number;token_hash:string;encrypted_token:string;created_at:number;updated_at:number;
};
type Asset = {review_id:string;version:number;file_id:string;connection_id:string;linked_folder_id:string;
  name:string;mime_type:string;permission_id:string|null;grant_state:'unshared'|'granting'|'granted'|'revoking'|'revoked'};
type Selection = {fileId:string;connectionId:string;linkedFolderId:string};
const ID=/^[A-Za-z0-9_-]{10,200}$/;
const CONN=/^[A-Za-z0-9-]{36}$/;
const UUID=/^[0-9a-f-]{36}$/i;
const FRONT='https://roteiva-web-dev.web.app';
const now=()=>Date.now();
const inputText=(s:unknown,max:number,required=false)=>{
  if(typeof s!=='string' || s.length>max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(s))
    throw new ApiError(400,'review_invalid_input');
  const value=s.trim();
  if(required&&!value)throw new ApiError(400,'review_invalid_input');
  return value;
};
const integer=(x:unknown)=>Number.isSafeInteger(x)&&Number(x)>0&&Number(x)<9007199254740991?Number(x):0;
const reviewLink=(token:string)=>FRONT+'/review/'+encodeURIComponent(token);
const tokenContext=(env:Env,row:Pick<Review,'owner_uid'|'id'>)=>context(env,row.owner_uid,row.id,'review-invite');
const showReview=(r:Review)=>({
  id:r.id,clientId:r.client_id,projectId:r.project_id,clientName:r.client_name,projectName:r.project_name,
  studioName:r.studio_name,title:r.title,message:r.message,recipientEmail:r.recipient_email,mode:r.access_mode,
  status:r.status,version:r.current_version,expiresAt:r.expires_at,createdAt:r.created_at,updatedAt:r.updated_at
});
async function activeOwner(request:Request,env:Env):Promise<string>{
  const uid=await identity(request,env);
  await assertActiveAccess(env,uid);
  return uid;
}
async function stored(env:Env,id:string,uid:string):Promise<Review>{
  if(!UUID.test(id))throw new ApiError(404,'review_not_found');
  const row=await env.DB.prepare('SELECT * FROM review_requests WHERE id=? AND owner_uid=?')
    .bind(id,uid).first<Review>();
  if(!row)throw new ApiError(404,'review_not_found');
  return row;
}
async function assets(env:Env,id:string,version?:number):Promise<Asset[]>{
  const result=version===undefined?
    await env.DB.prepare('SELECT * FROM review_assets WHERE review_id=? ORDER BY version,file_id').bind(id).all<Asset>() :
    await env.DB.prepare('SELECT * FROM review_assets WHERE review_id=? AND version=? ORDER BY file_id')
      .bind(id,version).all<Asset>();
  return result.results;
}
async function driveFile(env:Env,row:Connection,id:string):Promise<Record<string,unknown>>{
  const url=new URL('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(id));
  url.searchParams.set('fields','id,name,mimeType,trashed,parents,isAppAuthorized,inheritedPermissionsDisabled,capabilities(canShare)');
  url.searchParams.set('supportsAllDrives','true');
  return driveJson(env,row,url);
}
async function verifyProject(env:Env,uid:string,token:string,projectId:number,clientId:number):
  Promise<{clientName:string;projectName:string}> {
  const base='https://firestore.googleapis.com/v1/projects/'+env.FIREBASE_PROJECT_ID+
    '/databases/(default)/documents/users/'+encodeURIComponent(uid);
  const load=async(suffix:string)=>{
    let response:Response;
    try{response=await fetch(base+suffix,{redirect:'manual',headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(10000)});}
    catch{throw new ApiError(503,'review_firestore_unavailable');}
    if(response.status===403||response.status===404)throw new ApiError(403,'review_project_denied');
    if(!response.ok)throw new ApiError(503,'review_firestore_unavailable');
    return response.json() as Promise<{fields?:Record<string,{stringValue?:string;integerValue?:string}>}>;
  };
  const [project,client]=await Promise.all([load('/projects/'+projectId),load('/clients/'+clientId)]);
  if(project.fields?.ownerUid?.stringValue!==uid||client.fields?.ownerUid?.stringValue!==uid||
     project.fields?.clientId?.integerValue!==String(clientId))throw new ApiError(403,'review_project_denied');
  return {projectName:inputText(project.fields?.name?.stringValue,200,true),
    clientName:inputText(client.fields?.name?.stringValue,200,true)};
}
async function verifyFolder(env:Env,uid:string,token:string,projectId:number,s:Selection):Promise<void>{
  const key=projectId+'_'+s.connectionId+'_'+s.linkedFolderId;
  const url='https://firestore.googleapis.com/v1/projects/'+env.FIREBASE_PROJECT_ID+
    '/databases/(default)/documents/users/'+encodeURIComponent(uid)+'/driveFolders/'+key;
  let response:Response;
  try{response=await fetch(url,{redirect:'manual',headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(10000)});}
  catch{throw new ApiError(503,'review_firestore_unavailable');}
  if(!response.ok)throw new ApiError(response.status===404||response.status===403?403:503,
    response.status===404||response.status===403?'review_folder_denied':'review_firestore_unavailable');
  const d=await response.json() as {fields?:Record<string,{stringValue?:string;integerValue?:string}>};
  if(d.fields?.ownerUid?.stringValue!==uid||d.fields?.projectId?.integerValue!==String(projectId)||
    d.fields?.connectionId?.stringValue!==s.connectionId||d.fields?.folderId?.stringValue!==s.linkedFolderId)
    throw new ApiError(403,'review_folder_denied');
}
async function checkedFile(env:Env,uid:string,token:string,projectId:number,s:Selection):
  Promise<{name:string;mimeType:string;appAuthorized:boolean;canShare:boolean;ancestors:string[];inheritsPublic:boolean}>{
  if(!ID.test(s.fileId)||!ID.test(s.linkedFolderId)||!CONN.test(s.connectionId))
    throw new ApiError(400,'review_invalid_input');
  await verifyFolder(env,uid,token,projectId,s);
  const row=await connection(env,uid,s.connectionId);
  const item=await driveFile(env,row,s.fileId);
  if(item.id!==s.fileId||item.trashed===true||
     typeof item.name!=='string'||typeof item.mimeType!=='string'||
     !(/^(video|image|audio)\//.test(item.mimeType)||item.mimeType==='application/pdf'))
    throw new ApiError(403,'review_file_denied');
  let parents=item.parents;
  const ancestors:string[]=[];
  let inheritsPublic=item.inheritedPermissionsDisabled!==true;
  const seen=new Set<string>([s.fileId]);
  for(let i=0;i<24;i++){
    if(!Array.isArray(parents)||parents.length!==1||typeof parents[0]!=='string')
      throw new ApiError(403,'review_file_denied');
    const parent=parents[0];
    ancestors.push(parent);
    if(parent===s.linkedFolderId)return {name:inputText(item.name,255,true),mimeType:item.mimeType,
      appAuthorized:item.isAppAuthorized===true,
      canShare:(item.capabilities as {canShare?:boolean}|undefined)?.canShare===true,
      ancestors,inheritsPublic};
    if(!ID.test(parent)||seen.has(parent))throw new ApiError(403,'review_file_denied');
    seen.add(parent);
    const next=await driveFile(env,row,parent);
    if(next.trashed===true||next.mimeType!=='application/vnd.google-apps.folder')
      throw new ApiError(403,'review_file_denied');
    if(next.inheritedPermissionsDisabled===true)inheritsPublic=false;
    parents=next.parents;
  }
  throw new ApiError(403,'review_file_denied');
}
function selected(value:unknown):Selection[]{
  if(!Array.isArray(value)||value.length<1||value.length>8)throw new ApiError(400,'review_invalid_input');
  const seen=new Set<string>();
  return value.map((x:unknown)=>{
    if(!x||typeof x!=='object'||Array.isArray(x))throw new ApiError(400,'review_invalid_input');
    const d=x as Partial<Selection>;
    if(typeof d.fileId!=='string'||typeof d.connectionId!=='string'||typeof d.linkedFolderId!=='string'||
      !ID.test(d.fileId)||!ID.test(d.linkedFolderId)||!CONN.test(d.connectionId)||seen.has(d.fileId))
      throw new ApiError(400,'review_invalid_input');
    seen.add(d.fileId);
    return {fileId:d.fileId,connectionId:d.connectionId,linkedFolderId:d.linkedFolderId};
  });
}
async function validatedAssets(env:Env,uid:string,token:string,projectId:number,list:Selection[],id:string,version:number){
  const result:Asset[]=[];
  for(const item of list){
    const meta=await checkedFile(env,uid,token,projectId,item);
    result.push({review_id:id,version,file_id:item.fileId,connection_id:item.connectionId,
      linked_folder_id:item.linkedFolderId,name:meta.name,mime_type:meta.mimeType,permission_id:null,grant_state:'unshared'});
  }
  return result;
}
function insertAssets(env:Env,entries:Asset[],transition?:string){
  return entries.map(a=>env.DB.prepare(
    "INSERT INTO review_assets(review_id,version,file_id,connection_id,linked_folder_id,name,mime_type,grant_state) SELECT ?,?,?,?,?,?,?,'unshared'"+
    (transition?" WHERE EXISTS(SELECT 1 FROM review_requests WHERE id=? AND status='replacing' AND transition_id=?)":""))
    .bind(a.review_id,a.version,a.file_id,a.connection_id,a.linked_folder_id,a.name,a.mime_type,
      ...(transition?[a.review_id,transition]:[])));
}
async function tokenFor(env:Env,r:Review):Promise<string>{
  return decrypt(env,r.encrypted_token,tokenContext(env,r));
}
async function detail(env:Env,r:Review){
  const [files,comments,decisions,token]=await Promise.all([
    assets(env,r.id),
    env.DB.prepare('SELECT * FROM review_comments WHERE review_id=? ORDER BY created_at DESC LIMIT 300')
      .bind(r.id).all(),
    env.DB.prepare('SELECT * FROM review_decisions WHERE review_id=? ORDER BY created_at DESC LIMIT 50')
      .bind(r.id).all(),tokenFor(env,r)
  ]);
  return {review:{...showReview(r),url:reviewLink(token)},assets:files.map(a=>({
    version:a.version,fileId:a.file_id,name:a.name,mimeType:a.mime_type,grantState:a.grant_state
  })),comments:comments.results,decisions:decisions.results};
}
function pages(n:URLSearchParams):number{
  return Math.min(50,Math.max(0,Number.parseInt(n.get('page')||'0',10)||0));
}
async function createReview(request:Request,env:Env,uid:string):Promise<Response>{
  const data=await uploadBody(request) as Record<string,unknown>;
  if(!data||typeof data!=='object'||Array.isArray(data))throw new ApiError(400,'review_invalid_input');
  const projectId=integer(data.projectId),clientId=integer(data.clientId);
  if(!projectId||!clientId)throw new ApiError(400,'review_invalid_input');
  const title=inputText(data.title,180,true),message=inputText(data.message||'',1500);
  const studio=inputText(data.studioName||'Estúdio',120,true);
  const mode:Mode=data.mode==='link'?'link':data.mode==='google'?'google':(()=>{throw new ApiError(400,'review_invalid_input');})();
  const email=inputText(data.recipientEmail||'',200).toLowerCase();
  if(mode==='google'&&!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))throw new ApiError(400,'review_invalid_input');
  const days=integer(data.expiresInDays);
  if(!days||days>30)throw new ApiError(400,'review_invalid_input');
  const list=selected(data.assets);
  const bearer=request.headers.get('Authorization')!.slice(7);
  const metadata=await verifyProject(env,uid,bearer,projectId,clientId);
  const id=crypto.randomUUID(),secret=random(),ts=now();
  const entries=await validatedAssets(env,uid,bearer,projectId,list,id,1);
  const r={id,owner_uid:uid};
  const encrypted=await encrypt(env,secret,tokenContext(env,r));
  await env.DB.batch([
    env.DB.prepare("INSERT INTO review_requests(id,owner_uid,client_id,project_id,client_name,project_name,studio_name,title,message,recipient_email,access_mode,status,current_version,expires_at,token_hash,encrypted_token,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,'draft',1,?,?,?,?,?)")
      .bind(id,uid,clientId,projectId,metadata.clientName,metadata.projectName,studio,title,message,email,mode,
        ts+days*86400000,await hash(secret),encrypted,ts,ts),
    ...insertAssets(env,entries)
  ]);
  return Response.json({id,review:{...showReview({
    id,owner_uid:uid,client_id:clientId,project_id:projectId,client_name:metadata.clientName,
    project_name:metadata.projectName,studio_name:studio,title,message,recipient_email:email,access_mode:mode,
    status:'draft',current_version:1,expires_at:ts+days*86400000,token_hash:'',encrypted_token:encrypted,
    created_at:ts,updated_at:ts
  }),url:reviewLink(secret)}},{status:201});
}
async function ownerList(env:Env,uid:string,url:URL):Promise<Response>{
  const search=inputText(url.searchParams.get('q')||'',80).toLowerCase();
  const condition=['draft','pending','changes','approved','closed'].includes(url.searchParams.get('status')||'')
    ?url.searchParams.get('status')!:'';
  const rows=await env.DB.prepare("SELECT * FROM review_requests WHERE owner_uid=? AND (LOWER(client_name) LIKE ? OR LOWER(project_name) LIKE ? OR LOWER(title) LIKE ?) AND (?='' OR status=?) ORDER BY updated_at DESC LIMIT 25 OFFSET ?")
    .bind(uid,'%'+search+'%','%'+search+'%','%'+search+'%',condition,condition,pages(url.searchParams)*25).all<Review>();
  return Response.json({reviews:rows.results.map(showReview),hasMore:rows.results.length===25});
}
function permissionUrl(fileId:string,permissionId?:string):URL {
  const u=new URL('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(fileId)+'/permissions'+
    (permissionId?'/'+encodeURIComponent(permissionId):''));
  u.searchParams.set('supportsAllDrives','true');
  return u;
}
async function permissions(env:Env,row:Connection,fileId:string){
  const u=permissionUrl(fileId);
  u.searchParams.set('fields','nextPageToken,permissions(id,type,role,emailAddress,allowFileDiscovery)');
  u.searchParams.set('pageSize','100');
  const res=await driveJson(env,row,u);
  if(res.nextPageToken)throw new ApiError(409,'review_permission_list_too_large');
  return (Array.isArray(res.permissions)?res.permissions:[]) as {id:string;type:string;role:string;emailAddress?:string}[];
}
async function mutatePermission(env:Env,row:Connection,fileId:string,method:'POST'|'DELETE',
  value?:Record<string,string>,permissionId?:string):Promise<Record<string,unknown>>{
  const auth=await accessCredential(env,row);
  const u=permissionUrl(fileId,permissionId);
  if(method==='POST'){
    u.searchParams.set('fields','id,type,role');
    // Drive forbids sendNotificationEmail on anyone/domain permissions.
    if(value?.type==='user'||value?.type==='group')
      u.searchParams.set('sendNotificationEmail','false');
  }
  let res:Response;
  try{res=await fetch(u,{method,redirect:'manual',
    headers:{Authorization:'Bearer '+auth.value,...(value?{'Content-Type':'application/json'}:{})},
    ...(value?{body:JSON.stringify(value)}:{}),signal:AbortSignal.timeout(12000)});}
  catch{throw new ApiError(503,'review_drive_unavailable');}
  if(res.status===404&&method==='DELETE')return {};
  if(!res.ok)throw new ApiError(res.status===403?403:503,
    res.status===403?'review_drive_share_denied':'review_drive_unavailable');
  return method==='DELETE'?{}:res.json() as Promise<Record<string,unknown>>;
}
async function grant(env:Env,r:Review,a:Asset,ownerToken:string):Promise<void>{
  const sel={fileId:a.file_id,connectionId:a.connection_id,linkedFolderId:a.linked_folder_id};
  const validation=await checkedFile(env,r.owner_uid,ownerToken,r.project_id,sel);
  return withAssetLease(env,r,a,async current=>grantLocked(env,r,current,validation));
}
/** Serialize bounded Google ACL calls, including reconciliation after a lost response.
 * A crashed call's lease outlives its token/Drive request timeouts. Keep the claim
 * until DELETE succeeds; another invitation must never adopt this one's ACL.
 */
async function withAssetLease(env:Env,r:Review,a:Asset,job:(current:Asset)=>Promise<void>,revoking=false):Promise<void>{
  const lease=crypto.randomUUID();
  const locked=await env.DB.prepare('UPDATE review_assets SET lease_id=?,lease_until=? WHERE review_id=? AND version=? AND file_id=? AND lease_until<=?')
    .bind(lease,now()+120000,r.id,a.version,a.file_id,now()).run();
  if(locked.meta.changes!==1)throw new ApiError(409,'review_busy');
  try{
    const current=await env.DB.prepare('SELECT * FROM review_assets WHERE review_id=? AND version=? AND file_id=?')
      .bind(r.id,a.version,a.file_id).first<Asset>();
    if(!current)throw new ApiError(409,'review_busy');
    if(revoking&&(current.grant_state==='unshared'||current.grant_state==='revoked')){
      await job(current);return;
    }
    await env.DB.prepare('INSERT OR IGNORE INTO review_file_claims(file_id,review_id,version) VALUES(?,?,?)')
      .bind(a.file_id,r.id,a.version).run();
    const claim=await env.DB.prepare('SELECT review_id,version FROM review_file_claims WHERE file_id=?')
      .bind(a.file_id).first<{review_id:string;version:number}>();
    if(claim?.review_id!==r.id||claim.version!==a.version)throw new ApiError(409,'review_file_in_use');
    await job(current);
  }finally{
    await env.DB.prepare('UPDATE review_assets SET lease_id=NULL,lease_until=0 WHERE review_id=? AND version=? AND file_id=? AND lease_id=?')
      .bind(r.id,a.version,a.file_id,lease).run();
  }
}
type CheckedAsset=Awaited<ReturnType<typeof checkedFile>>;
async function grantLocked(env:Env,r:Review,a:Asset,validation:CheckedAsset):Promise<void>{
  const active=await env.DB.prepare("SELECT 1 FROM review_requests WHERE id=? AND status='publishing' AND current_version=? AND expires_at>?")
    .bind(r.id,a.version,now()).first();
  if(!active)throw new ApiError(409,'review_busy');
  if(a.grant_state==='granted')return;
  if(a.grant_state!=='unshared'&&a.grant_state!=='granting')throw new ApiError(409,'review_grant_conflict');
  const row=await connection(env,r.owner_uid,a.connection_id);
  const existing=await permissions(env,row,a.file_id);
  // A file can be readable through a public folder without having a direct
  // ACL. Never mutate or claim ownership of a user-created folder permission.
  const directPublic=existing.some(p=>p.type==='anyone');
  let inheritedPublic=false;
  if(validation.inheritsPublic && !directPublic){
    for(const parent of validation.ancestors){
      const inherited=await permissions(env,row,parent);
      if(inherited.some(p=>p.type==='anyone')){inheritedPublic=true;break;}
    }
  }
  const publiclyReadable=directPublic||inheritedPublic;
  if(r.access_mode==='google'&&existing.some(p=>p.type==='group'||
    (p.type==='user'&&p.role!=='owner'&&p.emailAddress?.toLowerCase()!==r.recipient_email&&
      p.emailAddress?.toLowerCase()!==row.google_email?.toLowerCase())))
    throw new ApiError(409,'review_existing_public_permission');
  // Google-only mode must never promise confidentiality for public ancestry.
  if(r.access_mode==='google'&&(publiclyReadable||existing.some(p=>p.type==='domain')))
    throw new ApiError(409,'review_existing_public_permission');
  if(r.access_mode==='link'&&a.grant_state==='unshared'&&publiclyReadable){
    const saved=await env.DB.prepare("UPDATE review_assets SET grant_state='granted',permission_id=NULL WHERE review_id=? AND version=? AND file_id=? AND grant_state='unshared' AND EXISTS(SELECT 1 FROM review_requests WHERE id=? AND status='publishing')")
      .bind(r.id,a.version,a.file_id,r.id).run();
    if(saved.meta.changes!==1)throw new ApiError(409,'review_busy');
    return;
  }
  const match=existing.find(p=>r.access_mode==='link'?p.type==='anyone':
    p.type==='user'&&p.emailAddress?.toLowerCase()===r.recipient_email);
  if(a.grant_state==='granting'&&inheritedPublic&&!match&&r.access_mode==='link'){
    // While awaiting Drive, the owner made the containing folder public.
    // Reuse the owner's access rather than creating a redundant file ACL.
    const saved=await env.DB.prepare("UPDATE review_assets SET grant_state='granted',permission_id=NULL WHERE review_id=? AND version=? AND file_id=? AND grant_state='granting' AND EXISTS(SELECT 1 FROM review_requests WHERE id=? AND status='publishing')")
      .bind(r.id,a.version,a.file_id,r.id).run();
    if(saved.meta.changes!==1)throw new ApiError(409,'review_busy');
    return;
  }
  if(a.grant_state==='unshared'&&match&&r.access_mode==='google'){
    // Pre-existing Google ACL belongs to the user, not Roteiva: never revoke it.
    const saved=await env.DB.prepare("UPDATE review_assets SET grant_state='granted',permission_id=NULL WHERE review_id=? AND version=? AND file_id=? AND grant_state='unshared' AND EXISTS(SELECT 1 FROM review_requests WHERE id=? AND status='publishing')")
      .bind(r.id,a.version,a.file_id,r.id).run();
    if(saved.meta.changes!==1)throw new ApiError(409,'review_busy');
    return;
  }
  if(!match&&(!validation.appAuthorized||!validation.canShare||
      !row.scopes.split(/\s+/).includes(DRIVE_SCOPE)))
    throw new ApiError(409,'review_drive_file_authorization_required');
  if(a.grant_state==='unshared'){
    const lock=await env.DB.prepare("UPDATE review_assets SET grant_state='granting' WHERE review_id=? AND version=? AND file_id=? AND grant_state='unshared' AND EXISTS(SELECT 1 FROM review_requests WHERE id=? AND status='publishing')")
      .bind(r.id,a.version,a.file_id,r.id).run();
    if(lock.meta.changes!==1)throw new ApiError(409,'review_busy');
  }
  // In the authenticated mode, a pre-existing user ACL is never considered ours.
  let id:string|null=null;
  if(match){
    if(a.grant_state==='granting' || r.access_mode==='link')id=match.id;
  } else {
    const created=await mutatePermission(env,row,a.file_id,'POST',
      r.access_mode==='link'?{type:'anyone',role:'reader'}:
        {type:'user',role:'reader',emailAddress:r.recipient_email});
    if(typeof created.id!=='string'||!created.id)throw new ApiError(503,'review_drive_unavailable');
    id=created.id;
  }
  const saved=await env.DB.prepare("UPDATE review_assets SET grant_state='granted',permission_id=? WHERE review_id=? AND version=? AND file_id=? AND grant_state='granting' AND EXISTS(SELECT 1 FROM review_requests WHERE id=? AND status='publishing')")
    .bind(id,r.id,a.version,a.file_id,r.id).run();
  if(saved.meta.changes!==1){
    // Closing an invitation may race a Google grant. Compensate immediately:
    // a late ACL must never outlive a review whose state already closed.
    // Persist the known ID before compensation. Failed DELETE remains recoverable
    // by close/cron, and close cannot finish while this asset lease is held.
    await env.DB.prepare("UPDATE review_assets SET grant_state='revoking',permission_id=? WHERE review_id=? AND version=? AND file_id=?")
      .bind(id,r.id,a.version,a.file_id).run();
    if(id)await mutatePermission(env,row,a.file_id,'DELETE',undefined,id);
    await env.DB.prepare("UPDATE review_assets SET grant_state='revoked',permission_id=NULL WHERE review_id=? AND version=? AND file_id=?")
      .bind(r.id,a.version,a.file_id).run();
    await releaseClaim(env,r,a);
    throw new ApiError(409,'review_busy');
  }
}
async function revokeAsset(env:Env,r:Review,a:Asset):Promise<void>{
  return withAssetLease(env,r,a,async current=>{
    await revokeLocked(env,r,current);
    await releaseClaim(env,r,current);
  },true);
}
async function releaseClaim(env:Env,r:Review,a:Asset):Promise<void>{
  await env.DB.prepare('DELETE FROM review_file_claims WHERE file_id=? AND review_id=? AND version=?')
    .bind(a.file_id,r.id,a.version).run();
}
async function revokeLocked(env:Env,r:Review,a:Asset):Promise<void>{
  if(a.grant_state==='revoked'||a.grant_state==='unshared')return;
  const row=await connection(env,r.owner_uid,a.connection_id);
  // Repair an unknown completion of a Google grant before closing.
  if(a.grant_state==='granting'){
    const all=await permissions(env,row,a.file_id);
    const found=all.find(p=>r.access_mode==='link'?p.type==='anyone':
      p.type==='user'&&p.emailAddress?.toLowerCase()===r.recipient_email);
    if(found)await mutatePermission(env,row,a.file_id,'DELETE',undefined,found.id);
  } else if(a.permission_id) {
    await mutatePermission(env,row,a.file_id,'DELETE',undefined,a.permission_id);
  }
  await env.DB.prepare("UPDATE review_assets SET grant_state='revoked',permission_id=NULL WHERE review_id=? AND version=? AND file_id=?")
    .bind(r.id,a.version,a.file_id).run();
}
async function publish(request:Request,env:Env,r:Review):Promise<Response>{
  if(!['draft','publishing'].includes(r.status))throw new ApiError(409,'review_invalid_state');
  if(r.expires_at<=now())throw new ApiError(410,'review_expired');
  const bearer=request.headers.get('Authorization')!.slice(7);
  await verifyProject(env,r.owner_uid,bearer,r.project_id,r.client_id);
  // All grants complete before any public client sees the review.
  await env.DB.prepare("UPDATE review_requests SET status='publishing',updated_at=? WHERE id=? AND owner_uid=? AND status IN ('draft','publishing')")
    .bind(now(),r.id,r.owner_uid).run();
  const files=await assets(env,r.id,r.current_version);
  if(!files.length)throw new ApiError(409,'review_invalid_state');
  for(const file of files)await grant(env,r,file,bearer);
  const published=await env.DB.prepare("UPDATE review_requests SET status='pending',updated_at=? WHERE id=? AND owner_uid=? AND status='publishing' AND current_version=? AND expires_at>? AND NOT EXISTS(SELECT 1 FROM review_assets WHERE review_id=? AND version=? AND grant_state!='granted')")
    .bind(now(),r.id,r.owner_uid,r.current_version,now(),r.id,r.current_version).run();
  if(published.meta.changes!==1)throw new ApiError(409,'review_busy');
  return Response.json({review:await detail(env,await stored(env,r.id,r.owner_uid))});
}
async function revise(request:Request,env:Env,r:Review):Promise<Response>{
  const bearer=request.headers.get('Authorization')!.slice(7);
  const data=await uploadBody(request) as {assets?:unknown}|null;
  const version=r.current_version+1;
  if(r.status==='changes'){
    const entries=await validatedAssets(env,r.owner_uid,bearer,r.project_id,selected(data?.assets),r.id,version);
    const transition=crypto.randomUUID();
    const commands=[
      env.DB.prepare("UPDATE review_requests SET status='replacing',transition_id=?,updated_at=? WHERE id=? AND owner_uid=? AND status='changes' AND current_version=?")
        .bind(transition,now(),r.id,r.owner_uid,r.current_version),
      ...insertAssets(env,entries,transition)
    ];
    const results=await env.DB.batch(commands);
    if(results[0].meta.changes!==1)throw new ApiError(409,'review_busy');
  }else if(r.status!=='replacing')throw new ApiError(409,'review_invalid_state');
  const next=await assets(env,r.id,version);
  if(!next.length)throw new ApiError(409,'review_invalid_state');
  // Status 'replacing' blocks the public portal throughout the revocation.
  for(const old of await assets(env,r.id,r.current_version))await revokeAsset(env,r,old);
  const changed=await env.DB.prepare("UPDATE review_requests SET current_version=?,status='draft',updated_at=? WHERE id=? AND owner_uid=? AND current_version=? AND status='replacing'")
    .bind(version,now(),r.id,r.owner_uid,r.current_version).run();
  if(changed.meta.changes!==1)throw new ApiError(409,'review_busy');
  return publish(request,env,await stored(env,r.id,r.owner_uid));
}
async function close(env:Env,r:Review):Promise<Response>{
  if(r.status==='closed')return Response.json({closed:true});
  await env.DB.prepare("UPDATE review_requests SET status='closing',updated_at=? WHERE id=? AND owner_uid=? AND status!='closed'")
    .bind(now(),r.id,r.owner_uid).run();
  for(const file of await assets(env,r.id))await revokeAsset(env,r,file);
  await env.DB.prepare("UPDATE review_requests SET status='closed',updated_at=? WHERE id=? AND owner_uid=? AND status='closing'")
    .bind(now(),r.id,r.owner_uid).run();
  return Response.json({closed:true});
}
async function rotate(env:Env,r:Review):Promise<Response>{
  if(!['pending','changes','approved','draft'].includes(r.status))
    throw new ApiError(409,'review_invalid_state');
  const secret=random(),encrypted=await encrypt(env,secret,tokenContext(env,r));
  const rotated=await env.DB.prepare("UPDATE review_requests SET token_hash=?,encrypted_token=?,updated_at=? WHERE id=? AND owner_uid=? AND token_hash=? AND status IN ('pending','changes','approved','draft') AND expires_at>?")
    .bind(await hash(secret),encrypted,now(),r.id,r.owner_uid,r.token_hash,now()).run();
  if(rotated.meta.changes!==1)throw new ApiError(409,'review_busy');
  return Response.json({url:reviewLink(secret)});
}
async function publicReview(request:Request,env:Env,action:'view'|'comment'|'decide'|'media'):Promise<Response>{
  const token=request.headers.get('X-Review-Token')||'';
  if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw new ApiError(404,'review_not_found');
  const r=await env.DB.prepare('SELECT * FROM review_requests WHERE token_hash=?').bind(await hash(token)).first<Review>();
  if(!r||r.status==='closed'||r.status==='closing')throw new ApiError(404,'review_not_found');
  if(r.expires_at<=now())throw new ApiError(410,'review_expired');
  if(!['pending','changes','approved'].includes(r.status))throw new ApiError(409,'review_not_ready');
  let email='';
  if(r.access_mode==='google'){
    const principal=await verifiedTrialPrincipal(request,env);
    email=principal.verifiedEmail.toLowerCase();
    if(email!==r.recipient_email)throw new ApiError(403,'review_recipient_denied');
  }
  const files=await assets(env,r.id,r.current_version);
  if(files.some(a=>a.grant_state!=='granted'))throw new ApiError(409,'review_not_ready');
  if(action==='view'){
    const [comments,decisions]=await Promise.all([
      env.DB.prepare('SELECT id,version,file_id,author_name,body,seconds,created_at FROM review_comments WHERE review_id=? AND version=? ORDER BY created_at DESC LIMIT 200')
        .bind(r.id,r.current_version).all(),
      env.DB.prepare('SELECT version,decision,author_name,message,created_at FROM review_decisions WHERE review_id=? ORDER BY created_at DESC LIMIT 40')
        .bind(r.id).all()
    ]);
    return Response.json({review:{title:r.title,message:r.message,studioName:r.studio_name,
      status:r.status,version:r.current_version,expiresAt:r.expires_at,mode:r.access_mode},
      assets:files.map(a=>({fileId:a.file_id,name:a.name,mimeType:a.mime_type})),
      comments:comments.results,decisions:decisions.results});
  }
  if(action==='media'){
    const body=await uploadBody(request) as Record<string,unknown>|null;
    if(!body||typeof body!=='object'||Array.isArray(body)||integer(body.version)!==r.current_version)
      throw new ApiError(409,'review_version_changed');
    const fileId=inputText(body.fileId,200,true);
    const chosen=files.find(a=>a.file_id===fileId&&a.mime_type.startsWith('video/'));
    if(!chosen)throw new ApiError(404,'review_not_found');
    const ticket=await mintReviewMediaTicket(env,r.id,fileId,r.current_version,r.expires_at,r.token_hash);
    return Response.json({url:'https://roteiva-api-dev.ewertonmendes9.workers.dev/reviews/media?ticket='+ticket,
      expiresAt:Math.min(r.expires_at,now()+12*60*1000)});
  }
  if(r.status!=='pending')throw new ApiError(409,'review_already_decided');
  const data=await uploadBody(request) as Record<string,unknown>|null;
  if(!data||typeof data!=='object'||Array.isArray(data))throw new ApiError(400,'review_invalid_input');
  if(integer(data.version)!==r.current_version)throw new ApiError(409,'review_version_changed');
  const author=email||inputText(data.authorName,100,true);
  const authorName=email?inputText(data.authorName||email,100,true):author;
  if(action==='comment'){
    const fileId=inputText(data.fileId,200,true),body=inputText(data.body,1500,true);
    const chosen=files.find(a=>a.file_id===fileId);
    if(!chosen)throw new ApiError(400,'review_invalid_input');
    if(data.seconds!=null&&typeof data.seconds!=='number')throw new ApiError(400,'review_invalid_input');
    const sec=data.seconds==null?null:data.seconds;
    if(sec!==null&&(!Number.isSafeInteger(sec)||sec<0||sec>172800||
       !chosen.mime_type.startsWith('video/')))
      throw new ApiError(400,'review_invalid_input');
    const saved=await env.DB.prepare("INSERT INTO review_comments(id,review_id,version,file_id,author_name,author_email,body,seconds,created_at) SELECT ?,?,?,?,?,?,?,?,? FROM review_requests WHERE id=? AND status='pending' AND current_version=? AND token_hash=? AND expires_at>?")
      .bind(crypto.randomUUID(),r.id,r.current_version,fileId,authorName,email||null,body,sec,now(),
        r.id,r.current_version,r.token_hash,now()).run();
    if(saved.meta.changes!==1)throw new ApiError(409,'review_already_decided');
    return Response.json({saved:true});
  }
  const decision=data.decision;
  if(decision!=='approved'&&decision!=='changes')throw new ApiError(400,'review_invalid_input');
  const message=inputText(data.message||'',1500,decision==='changes');
  const ts=now();
  // Unique(review_id,version) makes double-click/replay unable to produce conflicting approvals.
  // Conditional insert + transition within one D1 batch avoid phantom decisions on replay.
  const eventId=crypto.randomUUID();
  const saved=await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO review_decisions(id,review_id,version,decision,author_name,author_email,message,created_at) SELECT ?,?,?,?,?,?,?,? FROM review_requests WHERE id=? AND status='pending' AND current_version=? AND token_hash=? AND expires_at>?")
      .bind(eventId,r.id,r.current_version,decision,authorName,email||null,message,ts,r.id,r.current_version,r.token_hash,ts),
    env.DB.prepare("UPDATE review_requests SET status=?,updated_at=? WHERE id=? AND status='pending' AND current_version=? AND token_hash=? AND expires_at>? AND EXISTS(SELECT 1 FROM review_decisions WHERE id=?)")
      .bind(decision,ts,r.id,r.current_version,r.token_hash,ts,eventId)
  ]);
  if(saved[0].meta.changes!==1||saved[1].meta.changes!==1)throw new ApiError(409,'review_already_decided');
  return Response.json({saved:true,status:decision});
}
export async function reviewRouter(request:Request,env:Env,url:URL):Promise<Response>{
  const path=url.pathname;
  if(path==='/reviews/media')return streamReviewMedia(request,env,url);
  if(path==='/reviews/public' || path==='/reviews/public/comment' || path==='/reviews/public/decide'||path==='/reviews/public/media-ticket'){
    if(!['GET','POST'].includes(request.method))throw new ApiError(405,'method_not_allowed');
    if((path==='/reviews/public')!==(request.method==='GET'))throw new ApiError(405,'method_not_allowed');
    return publicReview(request,env,path.endsWith('/comment')?'comment':path.endsWith('/decide')?'decide':path.endsWith('/media-ticket')?'media':'view');
  }
  const uid=await activeOwner(request,env);
  if(path==='/reviews'&&request.method==='GET')return ownerList(env,uid,url);
  if(path==='/reviews'&&request.method==='POST')return createReview(request,env,uid);
  const parts=path.split('/');
  if(parts.length!==4&&parts.length!==3)throw new ApiError(404,'not_found');
  const r=await stored(env,parts[2],uid);
  if(parts.length===3&&request.method==='GET')return Response.json(await detail(env,r));
  if(parts.length!==4||request.method!=='POST')throw new ApiError(405,'method_not_allowed');
  if(parts[3]==='publish')return publish(request,env,r);
  if(parts[3]==='revise')return revise(request,env,r);
  if(parts[3]==='close')return close(env,r);
  if(parts[3]==='rotate')return rotate(env,r);
  throw new ApiError(404,'not_found');
}


/**
 * Close invitations before revoking OAuth: otherwise Drive "anyone" grants could
 * outlive the owner's Roteiva account. One review per cron tick bounds requests.
 */
export async function closeOwnerReviews(env:Env,uid:string):Promise<boolean>{
  const r=await env.DB.prepare("SELECT * FROM review_requests WHERE owner_uid=? AND status!='closed' ORDER BY updated_at LIMIT 1")
    .bind(uid).first<Review>();
  if(r){await close(env,r);return false;}
  const old=await env.DB.prepare('SELECT id FROM review_requests WHERE owner_uid=? LIMIT 20')
    .bind(uid).all<{id:string}>();
  if(old.results.length){
    await env.DB.batch(old.results.map(x=>env.DB.prepare('DELETE FROM review_requests WHERE owner_uid=? AND id=?').bind(uid,x.id)));
    return false;
  }
  return true;
}
/** A disconnected Drive cannot retain a Roteiva-managed active invite. */
export async function assertNoConnectionReviews(env:Env,uid:string,connectionId:string):Promise<void>{
  const row=await env.DB.prepare("SELECT 1 FROM review_requests r JOIN review_assets a ON a.review_id=r.id WHERE r.owner_uid=? AND a.connection_id=? AND r.status!='closed' LIMIT 1")
    .bind(uid,connectionId).first();
  if(row)throw new ApiError(409,'review_close_before_disconnect');
}
/** Expired capability links cease to work immediately; revoke Drive ACLs in bounded cron jobs. */
export async function cleanupExpiredReviews(env:Env):Promise<void>{
  const r=await env.DB.prepare("SELECT * FROM review_requests WHERE (expires_at<=? OR status='closing') AND status!='closed' AND updated_at<? ORDER BY updated_at LIMIT 1")
    .bind(now(),now()-60000).first<Review>();
  if(r)await close(env,r);
}
