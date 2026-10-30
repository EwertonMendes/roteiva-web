import { ApiError, type Env, type Connection } from './types.ts';
import { identity, verifiedTrialPrincipal } from './auth.ts';
import { assertActiveAccess } from './access.ts';
import { connection } from './repository.ts';
import { DRIVE_SCOPE, accessCredential } from './google.ts';
import { driveJson } from './drive-client.ts';
import { random, hash, encrypt, decrypt, context } from './crypto.ts';
import { uploadBody } from './uploads.ts';
import {mintReviewMediaTicket,reviewMediaSubject,streamReviewMedia,REVIEW_MEDIA_MAX_AGE} from './review-media.ts';
import {assertDropboxFolderLinked,verifyDropboxFile} from './dropbox-uploads.ts';
import {dropboxMedia} from './dropbox.ts';
import {validStorageFileId,validStorageFolderId,type StorageProviderId} from './storage.ts';

type Status = 'draft'|'publishing'|'pending'|'changes'|'approved'|'replacing'|'closing'|'closed';
type Mode = 'link'|'google';
type Review = {
  id:string;owner_uid:string;client_id:number;project_id:number;client_name:string;project_name:string;
  studio_name:string;title:string;message:string;recipient_email:string;access_mode:Mode;status:Status;
  current_version:number;expires_at:number;token_hash:string;encrypted_token:string;transition_id?:string|null;restrict_existing_public:number;drive_share_enabled:number;created_at:number;updated_at:number;
};
type Asset = {review_id:string;version:number;file_id:string;connection_id:string;linked_folder_id:string;provider:StorageProviderId;
  name:string;mime_type:string;permission_id:string|null;grant_state:'unshared'|'granting'|'granted'|'revoking'|'revoked'};
type Selection = {fileId:string;connectionId:string;linkedFolderId:string;provider:StorageProviderId};
const ID=/^[A-Za-z0-9_-]{10,200}$/;
const CONN=/^[A-Za-z0-9-]{36}$/;
type Participant={email:string;role:'reviewer'|'viewer'};
const EMAIL=/^[^@\s]+@[^@\s]+\.[^@\s]+$/;
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
  status:r.status,version:r.current_version,expiresAt:r.expires_at,driveShareEnabled:r.drive_share_enabled===1,createdAt:r.created_at,updatedAt:r.updated_at
});

function parseParticipants(data:unknown,mode:Mode,legacyEmail:string):Participant[] {
  if(mode==='link')return [];
  const source=data===undefined?[{email:legacyEmail,role:'reviewer'}]:data;
  if(!Array.isArray(source)||source.length<1||source.length>200)throw new ApiError(400,'review_invalid_participants');
  const unique=new Set<string>();
  const parsed:Participant[]=source.map((item):Participant=>{
    if(!item||typeof item!=='object'||Array.isArray(item))throw new ApiError(400,'review_invalid_participants');
    const entry=item as Record<string,unknown>;
    const email=inputText(entry.email,200,true).toLowerCase(),role=entry.role;
    if(!EMAIL.test(email)||(role!=='reviewer'&&role!=='viewer')||unique.has(email))
      throw new ApiError(400,'review_invalid_participants');
    unique.add(email);return {email,role:role as Participant['role']};
  });
  if(!parsed.some(item=>item.role==='reviewer'))throw new ApiError(400,'review_reviewer_required');
  return parsed;
}
async function participants(env:Env,id:string):Promise<Participant[]>{
  const result=await env.DB.prepare('SELECT email,role FROM review_participants WHERE review_id=? ORDER BY role,email')
    .bind(id).all<Participant>();
  return result.results;
}
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
  if(s.provider==='dropbox'){
    return assertDropboxFolderLinked(env,uid,token,s.connectionId,projectId,s.linkedFolderId);
  }
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
  if(!validStorageFileId(s.provider,s.fileId)||!validStorageFolderId(s.provider,s.linkedFolderId,true)||!CONN.test(s.connectionId))
    throw new ApiError(400,'review_invalid_input');
  await verifyFolder(env,uid,token,projectId,s);
  if(s.provider==='dropbox'){
    const meta=await verifyDropboxFile(env,uid,s.connectionId,s.linkedFolderId,s.fileId);
    return {name:meta.name,mimeType:meta.mimeType,appAuthorized:false,
      canShare:false,ancestors:[],inheritsPublic:false};
  }
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
    const provider=d.provider??'google_drive';
    if(provider!=='google_drive'&&provider!=='dropbox')throw new ApiError(400,'review_invalid_input');
    if(typeof d.fileId!=='string'||typeof d.connectionId!=='string'||typeof d.linkedFolderId!=='string'||
      !validStorageFileId(provider,d.fileId)||!validStorageFolderId(provider,d.linkedFolderId,true)||
      !CONN.test(d.connectionId)||seen.has(provider+':'+d.connectionId+':'+d.fileId))
      throw new ApiError(400,'review_invalid_input');
    seen.add(provider+':'+d.connectionId+':'+d.fileId);
    return {fileId:d.fileId,connectionId:d.connectionId,linkedFolderId:d.linkedFolderId,provider};
  });
}
async function validatedAssets(env:Env,uid:string,token:string,projectId:number,list:Selection[],id:string,version:number){
  const result:Asset[]=[];
  for(const item of list){
    let meta:Awaited<ReturnType<typeof checkedFile>>;
    try{meta=await checkedFile(env,uid,token,projectId,item);}
    catch(error){
      if(error instanceof ApiError)error.asset={fileId:item.fileId};
      throw error;
    }
    result.push({review_id:id,version,file_id:item.fileId,connection_id:item.connectionId,
      linked_folder_id:item.linkedFolderId,provider:item.provider,name:meta.name,mime_type:meta.mimeType,permission_id:null,grant_state:'unshared'});
  }
  return result;
}
function insertAssets(env:Env,entries:Asset[],transition?:string){
  return entries.map(a=>env.DB.prepare(
    "INSERT INTO review_assets(review_id,version,file_id,connection_id,linked_folder_id,provider,name,mime_type,grant_state) SELECT ?,?,?,?,?,?,?,?,'unshared'"+
    (transition?" WHERE EXISTS(SELECT 1 FROM review_requests WHERE id=? AND status='replacing' AND transition_id=?)":""))
    .bind(a.review_id,a.version,a.file_id,a.connection_id,a.linked_folder_id,a.provider,a.name,a.mime_type,
      ...(transition?[a.review_id,transition]:[])));
}
async function tokenFor(env:Env,r:Review):Promise<string>{
  return decrypt(env,r.encrypted_token,tokenContext(env,r));
}
async function detail(env:Env,r:Review){
  const [files,comments,decisions,votes,people,token]=await Promise.all([
    assets(env,r.id),
    env.DB.prepare('SELECT * FROM review_comments WHERE review_id=? ORDER BY created_at DESC LIMIT 300')
      .bind(r.id).all(),
    env.DB.prepare('SELECT * FROM review_decisions WHERE review_id=? ORDER BY created_at DESC LIMIT 50')
      .bind(r.id).all(),
    env.DB.prepare('SELECT version,email,decision,author_name,message,created_at FROM review_votes WHERE review_id=? ORDER BY created_at DESC LIMIT 500')
      .bind(r.id).all(),
    participants(env,r.id),tokenFor(env,r)
  ]);
  return {review:{...showReview(r),url:reviewLink(token)},participants:people,votes:votes.results,
    assets:files.map(a=>({
      version:a.version,fileId:a.file_id,name:a.name,mimeType:a.mime_type,grantState:a.grant_state,
      connectionId:a.connection_id,linkedFolderId:a.linked_folder_id,provider:a.provider
    })),comments:comments.results,decisions:decisions.results};
}
function pages(n:URLSearchParams):number{
  return Math.min(50,Math.max(0,Number.parseInt(n.get('page')||'0',10)||0));
}
/** Review invitations can include many named Google accounts; cap request bytes
 * independently from the smaller upload metadata limit without reading unbounded input. */
async function reviewCreateBody(request:Request):Promise<unknown>{
  const max=64*1024;
  if(Number(request.headers.get('Content-Length')||0)>max)throw new ApiError(413,'review_invalid_participants');
  const reader=request.body?.getReader();
  const chunks:Uint8Array[]=[];let length=0;
  if(reader)try{
    while(true){
      const {done,value}=await reader.read();
      if(done)break;
      length+=value.byteLength;
      if(length>max){await reader.cancel();throw new ApiError(413,'review_invalid_participants');}
      chunks.push(value);
    }
  }finally{reader.releaseLock();}
  const bytes=new Uint8Array(length);let offset=0;
  for(const part of chunks){bytes.set(part,offset);offset+=part.byteLength;}
  try{return JSON.parse(new TextDecoder().decode(bytes)) as unknown;}
  catch{throw new ApiError(400,'review_invalid_input');}
}
async function createReview(request:Request,env:Env,uid:string):Promise<Response>{
  const data=await reviewCreateBody(request) as Record<string,unknown>;
  if(!data||typeof data!=='object'||Array.isArray(data))throw new ApiError(400,'review_invalid_input');
  const projectId=integer(data.projectId),clientId=integer(data.clientId);
  if(!projectId||!clientId)throw new ApiError(400,'review_invalid_input');
  const title=inputText(data.title,180,true),message=inputText(data.message||'',1500);
  const studio=inputText(data.studioName||'Estúdio',120,true);
  const mode:Mode=data.mode==='link'?'link':data.mode==='google'?'google':(()=>{throw new ApiError(400,'review_invalid_input');})();
  const email=inputText(data.recipientEmail||'',200).toLowerCase();
  const people=parseParticipants(data.participants,mode,email);
  const shareDirect=data.driveShareEnabled===true?1:0;
  const restrict=shareDirect&&data.restrictExistingPublic===true?1:0;
  const days=integer(data.expiresInDays);
  if(!days||days>30)throw new ApiError(400,'review_invalid_input');
  const list=selected(data.assets);
  const bearer=request.headers.get('Authorization')!.slice(7);
  const metadata=await verifyProject(env,uid,bearer,projectId,clientId);
  const id=crypto.randomUUID(),secret=random(),ts=now();
  const entries=await validatedAssets(env,uid,bearer,projectId,list,id,1);
  if(shareDirect&&entries.some(a=>a.provider==='dropbox'))
    throw new ApiError(409,'dropbox_direct_share_not_supported');
  const r={id,owner_uid:uid};
  const encrypted=await encrypt(env,secret,tokenContext(env,r));
  await env.DB.batch([
    env.DB.prepare("INSERT INTO review_requests(id,owner_uid,client_id,project_id,client_name,project_name,studio_name,title,message,recipient_email,access_mode,status,current_version,expires_at,token_hash,encrypted_token,restrict_existing_public,drive_share_enabled,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,'draft',1,?,?,?,?,?,?,?)")
      .bind(id,uid,clientId,projectId,metadata.clientName,metadata.projectName,studio,title,message,people.find(p=>p.role==='reviewer')?.email||'',mode,
        ts+days*86400000,await hash(secret),encrypted,restrict,shareDirect,ts,ts),
    ...people.map(p=>env.DB.prepare("INSERT INTO review_participants(review_id,email,role) VALUES(?,?,?)").bind(id,p.email,p.role)),
    ...insertAssets(env,entries)
  ]);
  return Response.json({id,review:{...showReview({
    id,owner_uid:uid,client_id:clientId,project_id:projectId,client_name:metadata.clientName,
    project_name:metadata.projectName,studio_name:studio,title,message,recipient_email:people.find(p=>p.role==='reviewer')?.email||'',access_mode:mode,
    restrict_existing_public:restrict,drive_share_enabled:shareDirect,status:'draft',current_version:1,expires_at:ts+days*86400000,token_hash:'',encrypted_token:encrypted,
    created_at:ts,updated_at:ts
  }),url:reviewLink(secret)}},{status:201});
}
const REVIEW_PAGE_SIZE=15;
async function ownerList(env:Env,uid:string,url:URL):Promise<Response>{
  const search=inputText(url.searchParams.get('q')||'',80).toLowerCase();
  const condition=['draft','pending','changes','approved','closed'].includes(url.searchParams.get('status')||'')
    ?url.searchParams.get('status')!:'';
  // Fetch one extra entry to distinguish a full final page from a page with more results.
  // The summary is owner-scoped and intentionally independent of list search/filters.
  const [list,counts]=await Promise.all([
    env.DB.prepare("SELECT * FROM review_requests WHERE owner_uid=? AND (LOWER(client_name) LIKE ? OR LOWER(project_name) LIKE ? OR LOWER(title) LIKE ?) AND (?='' OR status=?) ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?")
      .bind(uid,'%'+search+'%','%'+search+'%','%'+search+'%',condition,condition,REVIEW_PAGE_SIZE+1,pages(url.searchParams)*REVIEW_PAGE_SIZE).all<Review>(),
    env.DB.prepare("SELECT status, COUNT(*) AS total FROM review_requests WHERE owner_uid=? AND status IN ('pending','changes','approved') GROUP BY status")
      .bind(uid).all<{status:'pending'|'changes'|'approved';total:number}>()
  ]);
  const summary={pending:0,changes:0,approved:0};
  for(const row of counts.results)summary[row.status]=row.total;
  return Response.json({reviews:list.results.slice(0,REVIEW_PAGE_SIZE).map(showReview),
    hasMore:list.results.length>REVIEW_PAGE_SIZE,summary});
}
function permissionUrl(fileId:string,permissionId?:string):URL {
  const u=new URL('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(fileId)+'/permissions'+
    (permissionId?'/'+encodeURIComponent(permissionId):''));
  u.searchParams.set('supportsAllDrives','true');
  return u;
}
async function permissions(env:Env,row:Connection,fileId:string){
  const all:{id:string;type:string;role:string;emailAddress?:string;permissionDetails?:{inherited?:boolean}[]}[]=[];
  let cursor:string|undefined;
  for(let i=0;i<20;i++){
    const u=permissionUrl(fileId);
    u.searchParams.set('fields','nextPageToken,permissions(id,type,role,emailAddress,allowFileDiscovery,permissionDetails(inherited))');
    u.searchParams.set('pageSize','100');
    if(cursor)u.searchParams.set('pageToken',cursor);
    const res=await driveJson(env,row,u);
    if(Array.isArray(res.permissions))all.push(...res.permissions as typeof all);
    if(typeof res.nextPageToken!=='string'||!res.nextPageToken)return all;
    if(res.nextPageToken===cursor)throw new ApiError(409,'review_permission_list_too_large');
    cursor=res.nextPageToken;
  }
  throw new ApiError(409,'review_permission_list_too_large');
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
  const sel={fileId:a.file_id,connectionId:a.connection_id,linkedFolderId:a.linked_folder_id,provider:a.provider};
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
    if(r.drive_share_enabled===0){await job(current);return;}
    if(r.access_mode==='google'){await job(current);return;}
    await env.DB.prepare('INSERT OR IGNORE INTO review_file_claims(file_id,review_id,version) VALUES(?,?,?)')
      .bind(a.file_id,r.id,a.version).run();
    let claim=await env.DB.prepare('SELECT review_id,version FROM review_file_claims WHERE file_id=?')
      .bind(a.file_id).first<{review_id:string;version:number}>();
    if(claim&&(claim.review_id!==r.id||claim.version!==a.version)){
      const holder=await env.DB.prepare("SELECT a.grant_state,a.permission_id,r.status FROM review_assets a JOIN review_requests r ON r.id=a.review_id WHERE a.review_id=? AND a.version=? AND a.file_id=?")
        .bind(claim.review_id,claim.version,a.file_id).first<{grant_state:string;permission_id:string|null;status:string}>();
      if(holder?.grant_state==='granted'&&holder.permission_id===null){
        // Earlier invitation reused a pre-existing public ACL: nobody owns it.
        await env.DB.prepare('DELETE FROM review_file_claims WHERE file_id=? AND review_id=? AND version=?')
          .bind(a.file_id,claim.review_id,claim.version).run();
        await env.DB.prepare('INSERT OR IGNORE INTO review_file_claims(file_id,review_id,version) VALUES(?,?,?)')
          .bind(a.file_id,r.id,a.version).run();
        claim=await env.DB.prepare('SELECT review_id,version FROM review_file_claims WHERE file_id=?')
          .bind(a.file_id).first<{review_id:string;version:number}>();
      }else if(r.access_mode==='link'&&holder?.grant_state==='granted'&&holder.permission_id&&
        ['pending','changes','approved','publishing'].includes(holder.status)){
        await job(current);
        const referenced=await env.DB.prepare("INSERT OR IGNORE INTO review_link_uses(review_id,version,file_id) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM review_requests r JOIN review_assets a ON a.review_id=r.id AND a.version=? AND a.file_id=? WHERE r.id=? AND r.status IN ('pending','changes','approved','publishing') AND a.grant_state='granted' AND a.permission_id IS NOT NULL)")
          .bind(r.id,a.version,a.file_id,claim.version,a.file_id,claim.review_id).run();
        if(referenced.meta.changes!==1){
          const retained=await env.DB.prepare("SELECT 1 FROM review_link_uses WHERE review_id=? AND version=? AND file_id=?")
            .bind(r.id,a.version,a.file_id).first();
          if(!retained)throw new ApiError(409,'review_busy');
        }
        return;
      }
    }
    if(claim?.review_id!==r.id||claim.version!==a.version)throw new ApiError(409,'review_file_in_use');
    await job(current);
    const after=await env.DB.prepare('SELECT grant_state,permission_id FROM review_assets WHERE review_id=? AND version=? AND file_id=?')
      .bind(r.id,a.version,a.file_id).first<{grant_state:string;permission_id:string|null}>();
    if(after?.grant_state==='granted'&&after.permission_id===null)await releaseClaim(env,r,a);
  }finally{
    await env.DB.prepare('UPDATE review_assets SET lease_id=NULL,lease_until=0 WHERE review_id=? AND version=? AND file_id=? AND lease_id=?')
      .bind(r.id,a.version,a.file_id,lease).run();
  }
}
type CheckedAsset=Awaited<ReturnType<typeof checkedFile>>;

type GoogleAcl={file_id:string;email:string;connection_id:string;permission_id:string|null;managed:number;state:'granting'|'ready'|'revoking';updated_at:number;owner_review_id:string|null;owner_uid:string|null};
async function sharedGoogleAcl(env:Env,fileId:string,email:string):Promise<GoogleAcl|null>{
  return env.DB.prepare('SELECT * FROM review_google_acl WHERE file_id=? AND email=?')
    .bind(fileId,email).first<GoogleAcl>();
}
async function grantGoogle(env:Env,r:Review,a:Asset,validation:CheckedAsset):Promise<void>{
  const active=await env.DB.prepare("SELECT 1 FROM review_requests WHERE id=? AND status='publishing' AND current_version=? AND expires_at>?")
    .bind(r.id,a.version,now()).first();
  if(!active)throw new ApiError(409,'review_busy');
  if(a.grant_state==='granted')return;
  if(a.grant_state!=='unshared'&&a.grant_state!=='granting')throw new ApiError(409,'review_grant_conflict');
  const row=await connection(env,r.owner_uid,a.connection_id);
  let existing=await permissions(env,row,a.file_id);
  // Portal identity restrictions are independent from Google Drive ACLs.
  // A public parent is NOT a reason to block a Google-authenticated Roteiva review.
  // Never modify inherited permissions: they can also serve other projects/links.
  // Shared-drive permission listings may include inherited grants. Never try
  // to DELETE a parent's permission via a child's permission endpoint.
  const directPublic=existing.filter(p=>p.type==='anyone'&&
    (!p.permissionDetails?.length||p.permissionDetails.some(detail=>detail.inherited===false)));
  if(directPublic.length&&r.restrict_existing_public===1){
    // Explicit opt-in: changing these public ACLs affects *all* Drive links.
    // Never delete an ACL that belongs to another active Roteiva invitation.
    const shared=await env.DB.prepare("SELECT 1 FROM review_file_claims WHERE file_id=? AND review_id!=?")
      .bind(a.file_id,r.id).first();
    if(shared)throw new ApiError(409,'review_file_in_use');
    for(const p of directPublic)await mutatePermission(env,row,a.file_id,'DELETE',undefined,p.id);
    existing=await permissions(env,row,a.file_id);
  }
  const people=await participants(env,r.id);
  if(!people.length||!people.some(p=>p.role==='reviewer'))throw new ApiError(409,'review_reviewer_required');

  // Anyone-with-link access might belong to the file itself or a public parent.
  // It already permits opening the original in Drive. Do not create redundant
  // per-account ACLs or take ownership of the user's public permissions.
  // Authentication and reviewer/viewer roles remain enforced in the Roteiva portal.
  let inheritedAnyone=false;
  if(validation.inheritsPublic&&!existing.some(p=>p.type==='anyone')){
    for(const parent of validation.ancestors){
      const acl=await permissions(env,row,parent);
      if(acl.some(p=>p.type==='anyone')){inheritedAnyone=true;break;}
    }
  }
  if(inheritedAnyone||existing.some(p=>p.type==='anyone')){
    const granted=await env.DB.prepare("UPDATE review_assets SET grant_state='granted',permission_id=NULL WHERE review_id=? AND version=? AND file_id=? AND grant_state IN ('unshared','granting') AND EXISTS(SELECT 1 FROM review_requests WHERE id=? AND status='publishing' AND current_version=?)")
      .bind(r.id,a.version,a.file_id,r.id,a.version).run();
    if(granted.meta.changes!==1)throw new ApiError(409,'review_busy');
    return;
  }
  if(a.grant_state==='unshared'){
    const started=await env.DB.prepare("UPDATE review_assets SET grant_state='granting' WHERE review_id=? AND version=? AND file_id=? AND grant_state='unshared'")
      .bind(r.id,a.version,a.file_id).run();
    if(started.meta.changes!==1)throw new ApiError(409,'review_busy');
  }
  for(const person of people){
    let match=existing.find(p=>p.type==='user'&&p.emailAddress?.toLowerCase()===person.email);
    await env.DB.prepare("INSERT OR IGNORE INTO review_google_acl(file_id,email,connection_id,permission_id,managed,state,updated_at,owner_review_id,owner_uid) VALUES(?,?,?,?,?,?,?,?,?)")
      .bind(a.file_id,person.email,a.connection_id,match?.id||null,match?0:1,match?'ready':'granting',now(),r.id,r.owner_uid).run();
    let acl=await sharedGoogleAcl(env,a.file_id,person.email);
    if(!acl)throw new ApiError(503,'review_drive_unavailable');
    if(acl.state==='revoking')throw new ApiError(409,'review_busy');
    if(acl.state==='granting'&&acl.owner_review_id!==r.id){
      if(acl.updated_at>now()-120000)throw new ApiError(409,'review_busy');
      const takeover=await env.DB.prepare("UPDATE review_google_acl SET owner_review_id=?,updated_at=? WHERE file_id=? AND email=? AND state='granting' AND updated_at<=?")
        .bind(r.id,now(),a.file_id,person.email,now()-120000).run();
      if(takeover.meta.changes!==1)throw new ApiError(409,'review_busy');
      acl=(await sharedGoogleAcl(env,a.file_id,person.email))!;
    }
    if(!match&&acl.state==='ready'){
      const updated=await env.DB.prepare("UPDATE review_google_acl SET state='granting',managed=1,permission_id=NULL,owner_review_id=?,updated_at=? WHERE file_id=? AND email=? AND state='ready'")
        .bind(r.id,now(),a.file_id,person.email).run();
      if(updated.meta.changes!==1)throw new ApiError(409,'review_busy');
      acl=(await sharedGoogleAcl(env,a.file_id,person.email))!;
    }
    if(acl.state==='granting'){
      if(!match){
        if(!validation.appAuthorized||!validation.canShare||
          !row.scopes.split(/\s+/).includes(DRIVE_SCOPE))
          throw new ApiError(409,'review_drive_file_authorization_required');
        const created=await mutatePermission(env,row,a.file_id,'POST',
          {type:'user',role:'reader',emailAddress:person.email});
        if(typeof created.id!=='string'||!created.id)throw new ApiError(503,'review_drive_unavailable');
        match={id:created.id,type:'user',role:'reader',emailAddress:person.email};
        existing.push(match);
      }
      await env.DB.prepare("UPDATE review_google_acl SET state='ready',permission_id=?,updated_at=? WHERE file_id=? AND email=? AND state='granting' AND owner_review_id=?")
        .bind(match.id,now(),a.file_id,person.email,r.id).run();
    }
    await env.DB.prepare("INSERT OR REPLACE INTO review_google_uses(review_id,version,file_id,email,state) VALUES(?,?,?,?,'active')")
      .bind(r.id,a.version,a.file_id,person.email).run();
  }
  const done=await env.DB.prepare("UPDATE review_assets SET grant_state='granted',permission_id=NULL WHERE review_id=? AND version=? AND file_id=? AND grant_state='granting' AND EXISTS(SELECT 1 FROM review_requests WHERE id=? AND status='publishing' AND current_version=?)")
    .bind(r.id,a.version,a.file_id,r.id,a.version).run();
  if(done.meta.changes!==1)throw new ApiError(409,'review_busy');
}
async function revokeGoogle(env:Env,r:Review,a:Asset):Promise<void>{
  // Include incomplete grants that committed their ACL but did not finish their use row.
  const people=await participants(env,r.id);
  const row=await connection(env,r.owner_uid,a.connection_id);
  for(const person of people){
    await env.DB.prepare("UPDATE review_google_uses SET state='revoked' WHERE review_id=? AND version=? AND file_id=? AND email=?")
      .bind(r.id,a.version,a.file_id,person.email).run();
    const acl=await sharedGoogleAcl(env,a.file_id,person.email);
    if(!acl)continue;
    const inUse=await env.DB.prepare("SELECT 1 FROM review_google_uses WHERE file_id=? AND email=? AND state='active' LIMIT 1")
      .bind(a.file_id,person.email).first();
    if(inUse)continue;
    if(!acl.managed){
      await env.DB.prepare("DELETE FROM review_google_acl WHERE file_id=? AND email=? AND managed=0")
        .bind(a.file_id,person.email).run();
      continue;
    }
    if(acl.state!=='revoking'){
      const claimed=await env.DB.prepare("UPDATE review_google_acl SET state='revoking',updated_at=? WHERE file_id=? AND email=? AND state IN ('ready','granting') AND NOT EXISTS(SELECT 1 FROM review_google_uses WHERE file_id=? AND email=? AND state='active')")
        .bind(now(),a.file_id,person.email,a.file_id,person.email).run();
      if(claimed.meta.changes!==1)throw new ApiError(409,'review_busy');
    }
    let id=acl.permission_id;
    if(!id){
      const list=await permissions(env,row,a.file_id);
      id=list.find(p=>p.type==='user'&&p.emailAddress?.toLowerCase()===person.email)?.id||null;
    }
    if(id){
      const authorized=acl.owner_uid?await connection(env,acl.owner_uid,acl.connection_id):row;
      await mutatePermission(env,authorized,a.file_id,'DELETE',undefined,id);
    }
    await env.DB.prepare("DELETE FROM review_google_acl WHERE file_id=? AND email=? AND state='revoking'")
      .bind(a.file_id,person.email).run();
  }
  await env.DB.prepare("UPDATE review_assets SET grant_state='revoked',permission_id=NULL WHERE review_id=? AND version=? AND file_id=?")
    .bind(r.id,a.version,a.file_id).run();
}

async function grantLocked(env:Env,r:Review,a:Asset,validation:CheckedAsset):Promise<void>{
  if(a.provider==='dropbox'&&r.drive_share_enabled!==0)
    throw new ApiError(409,'dropbox_direct_share_not_supported');
  if(r.drive_share_enabled===0){
    // The chosen asset was already verified as readable via the owner's Drive
    // connection and linked project folder. isAppAuthorized can be false for
    // public/inherited files even though Roteiva can read/stream them; no Drive
    // permission mutation is necessary in portal-only mode.
    const updated=await env.DB.prepare("UPDATE review_assets SET grant_state='granted',permission_id=NULL WHERE review_id=? AND version=? AND file_id=? AND grant_state IN ('unshared','granting') AND EXISTS(SELECT 1 FROM review_requests WHERE id=? AND status='publishing' AND current_version=?)")
      .bind(r.id,a.version,a.file_id,r.id,a.version).run();
    if(updated.meta.changes!==1&&a.grant_state!=='granted')throw new ApiError(409,'review_busy');
    return;
  }
  if(r.access_mode==='google')return grantGoogle(env,r,a,validation);
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
  if(r.access_mode==='link'&&a.grant_state==='unshared'&&publiclyReadable){
    const saved=await env.DB.prepare("UPDATE review_assets SET grant_state='granted',permission_id=NULL WHERE review_id=? AND version=? AND file_id=? AND grant_state='unshared' AND EXISTS(SELECT 1 FROM review_requests WHERE id=? AND status='publishing')")
      .bind(r.id,a.version,a.file_id,r.id).run();
    if(saved.meta.changes!==1)throw new ApiError(409,'review_busy');
    return;
  }
  const match=existing.find(p=>p.type==='anyone');
  if(a.grant_state==='granting'&&inheritedPublic&&!match){
    // While awaiting Drive, the owner made the containing folder public.
    // Reuse the owner's access rather than creating a redundant file ACL.
    const saved=await env.DB.prepare("UPDATE review_assets SET grant_state='granted',permission_id=NULL WHERE review_id=? AND version=? AND file_id=? AND grant_state='granting' AND EXISTS(SELECT 1 FROM review_requests WHERE id=? AND status='publishing')")
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
    id=match.id;
  } else {
    const created=await mutatePermission(env,row,a.file_id,'POST',
      {type:'anyone',role:'reader'});
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
  if(r.access_mode==='google')return;
  await env.DB.prepare('DELETE FROM review_file_claims WHERE file_id=? AND review_id=? AND version=?')
    .bind(a.file_id,r.id,a.version).run();
}
async function revokeLocked(env:Env,r:Review,a:Asset):Promise<void>{
  if(a.grant_state==='revoked'||a.grant_state==='unshared')return;
  if(r.drive_share_enabled===0){
    await env.DB.prepare("UPDATE review_assets SET grant_state='revoked',permission_id=NULL WHERE review_id=? AND version=? AND file_id=?")
      .bind(r.id,a.version,a.file_id).run();
    return;
  }
  if(r.access_mode==='google')return revokeGoogle(env,r,a);
  if(a.permission_id&&r.access_mode==='link'){
    // Transfer ownership rather than deleting an ACL while another review
    // still uses that same file. The current review's claim is moved atomically.
    const used=await env.DB.prepare("SELECT u.review_id,u.version FROM review_link_uses u JOIN review_requests r ON r.id=u.review_id JOIN review_assets a ON a.review_id=u.review_id AND a.version=u.version AND a.file_id=u.file_id WHERE u.file_id=? AND r.status IN ('publishing','pending','changes','approved') AND a.grant_state='granted' ORDER BY r.created_at LIMIT 1")
      .bind(a.file_id).first<{review_id:string;version:number}>();
    if(used){
      const batch=await env.DB.batch([
        env.DB.prepare("UPDATE review_file_claims SET review_id=?,version=? WHERE file_id=? AND review_id=? AND version=?")
          .bind(used.review_id,used.version,a.file_id,r.id,a.version),
        env.DB.prepare("UPDATE review_assets SET permission_id=? WHERE review_id=? AND version=? AND file_id=? AND grant_state='granted' AND permission_id IS NULL")
          .bind(a.permission_id,used.review_id,used.version,a.file_id),
        env.DB.prepare("DELETE FROM review_link_uses WHERE review_id=? AND version=? AND file_id=?")
          .bind(used.review_id,used.version,a.file_id),
        env.DB.prepare("UPDATE review_assets SET grant_state='revoked',permission_id=NULL WHERE review_id=? AND version=? AND file_id=?")
          .bind(r.id,a.version,a.file_id)
      ]);
      if(batch[0].meta.changes!==1||batch[1].meta.changes!==1)throw new ApiError(409,'review_busy');
      return;
    }
  }
  await env.DB.prepare('DELETE FROM review_link_uses WHERE review_id=? AND version=? AND file_id=?')
    .bind(r.id,a.version,a.file_id).run();
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
  for(const file of files){
    try{await grant(env,r,file,bearer);}
    catch(error){
      if(error instanceof ApiError)error.asset={fileId:file.file_id,fileName:file.name};
      throw error;
    }
  }
  const published=await env.DB.prepare("UPDATE review_requests SET status='pending',updated_at=? WHERE id=? AND owner_uid=? AND status='publishing' AND current_version=? AND expires_at>? AND NOT EXISTS(SELECT 1 FROM review_assets WHERE review_id=? AND version=? AND grant_state!='granted')")
    .bind(now(),r.id,r.owner_uid,r.current_version,now(),r.id,r.current_version).run();
  if(published.meta.changes!==1)throw new ApiError(409,'review_busy');
  return Response.json({review:await detail(env,await stored(env,r.id,r.owner_uid))});
}
async function revise(request:Request,env:Env,r:Review):Promise<Response>{
  const bearer=request.headers.get('Authorization')!.slice(7);
  const data=await uploadBody(request) as {assets?:unknown}|null;
  if(r.expires_at<=now())throw new ApiError(410,'review_expired');
  // A previous request may have committed the version switch but lost the HTTP
  // response before publish completed. Retrying must finish THAT version,
  // never increment it again or strand the editor on review_invalid_state.
  if((r.status==='draft'||r.status==='publishing')&&r.current_version>1){
    const decision=await env.DB.prepare("SELECT 1 FROM review_decisions WHERE review_id=? AND version=? AND decision='changes'")
      .bind(r.id,r.current_version-1).first();
    if(decision)return publish(request,env,r);
  }
  if(r.status!=='changes'&&r.status!=='replacing')throw new ApiError(409,'review_invalid_state');
  const version=r.current_version+1;
  if(r.status==='changes'){
    const entries=await validatedAssets(env,r.owner_uid,bearer,r.project_id,selected(data?.assets),r.id,version);
    if(r.drive_share_enabled&&entries.some(a=>a.provider==='dropbox'))
      throw new ApiError(409,'dropbox_direct_share_not_supported');
    const transition=crypto.randomUUID();
    const commands=[
      env.DB.prepare("UPDATE review_requests SET status='replacing',transition_id=?,updated_at=? WHERE id=? AND owner_uid=? AND status='changes' AND current_version=?")
        .bind(transition,now(),r.id,r.owner_uid,r.current_version),
      ...insertAssets(env,entries,transition)
    ];
    const results=await env.DB.batch(commands);
    if(results[0].meta.changes!==1)throw new ApiError(409,'review_busy');
  }
  let next=await assets(env,r.id,version);
  // Recovery for existing DEV rows stuck in 'replacing' with no new assets:
  // preserve the old version, reuse the stored transition fence and validate
  // the newly selected files against the original client's project.
  if(!next.length&&r.status==='replacing'){
    const entries=await validatedAssets(env,r.owner_uid,bearer,r.project_id,selected(data?.assets),r.id,version);
    const current=await stored(env,r.id,r.owner_uid);
    if(current.status!=='replacing'||current.current_version!==r.current_version||!current.transition_id)
      throw new ApiError(409,'review_busy');
    await env.DB.batch(insertAssets(env,entries,current.transition_id));
    next=await assets(env,r.id,version);
  }
  if(!next.length)throw new ApiError(409,'review_revision_recovery_required');
  // During 'replacing' the public link is blocked. Revoke only Roteiva-owned
  // ACLs; resume safely after transient Google failures or network retries.
  for(const old of await assets(env,r.id,r.current_version))await revokeAsset(env,r,old);
  const changed=await env.DB.prepare("UPDATE review_requests SET current_version=?,status='draft',transition_id=NULL,updated_at=? WHERE id=? AND owner_uid=? AND current_version=? AND status='replacing' AND NOT EXISTS(SELECT 1 FROM review_assets WHERE review_id=? AND version=? AND grant_state NOT IN ('revoked','unshared'))")
    .bind(version,now(),r.id,r.owner_uid,r.current_version,r.id,r.current_version).run();
  if(changed.meta.changes!==1){
    const current=await stored(env,r.id,r.owner_uid);
    if(['draft','publishing'].includes(current.status)&&current.current_version===version)
      return publish(request,env,current);
    throw new ApiError(409,'review_busy');
  }
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
  let email='',role:'reviewer'|'viewer'='reviewer';
  if(r.access_mode==='google'){
    const principal=await verifiedTrialPrincipal(request,env);
    email=principal.verifiedEmail.toLowerCase();
    const participant=await env.DB.prepare('SELECT role FROM review_participants WHERE review_id=? AND email=?')
      .bind(r.id,email).first<{role:'reviewer'|'viewer'}>();
    if(!participant)throw new ApiError(403,'review_recipient_denied');
    role=participant.role;
    if((action==='comment'||action==='decide')&&role!=='reviewer')
      throw new ApiError(403,'review_viewer_read_only');
  }
  const files=await assets(env,r.id,r.current_version);
  if(files.some(a=>a.grant_state!=='granted'))throw new ApiError(409,'review_not_ready');
  if(action==='view'){
    const [comments,decisions,votes,myVote]=await Promise.all([
      env.DB.prepare('SELECT id,version,file_id,author_name,body,seconds,created_at FROM review_comments WHERE review_id=? AND version=? ORDER BY created_at DESC LIMIT 200')
        .bind(r.id,r.current_version).all(),
      env.DB.prepare('SELECT version,decision,author_name,message,created_at FROM review_decisions WHERE review_id=? ORDER BY created_at DESC LIMIT 40')
        .bind(r.id).all(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM review_votes WHERE review_id=? AND version=? AND decision='approved'")
        .bind(r.id,r.current_version).first<{count:number}>(),
      email?env.DB.prepare('SELECT decision FROM review_votes WHERE review_id=? AND version=? AND email=?')
        .bind(r.id,r.current_version,email).first<{decision:string}>():Promise.resolve(null)
    ]);
    const total=r.access_mode==='google'?
      await env.DB.prepare("SELECT COUNT(*) AS count FROM review_participants WHERE review_id=? AND role='reviewer'")
        .bind(r.id).first<{count:number}>():null;
    // The portal already verified this participant and selected the version.
    // Bundle short-lived signed URLs with the first response, avoiding a second
    // Worker/D1 round trip every time the user selects another file.
    const mediaTickets:Record<string,{url:string;expiresAt:number}>={};
    const subject=r.access_mode==='google'?await reviewMediaSubject(env,r.id,email):undefined;
    const expiresAt=Math.min(r.expires_at,now()+REVIEW_MEDIA_MAX_AGE);
    for(const file of files){
      if(!(/^(image|video|audio)\//.test(file.mime_type)||file.mime_type==='application/pdf'))continue;
      const ticket=await mintReviewMediaTicket(env,r.id,file.file_id,r.current_version,r.expires_at,r.token_hash,subject);
      mediaTickets[file.file_id]={url:'https://roteiva-api-dev.ewertonmendes9.workers.dev/reviews/media?ticket='+ticket,expiresAt};
    }
    return Response.json({mediaTickets,review:{title:r.title,message:r.message,studioName:r.studio_name,
      status:r.status,version:r.current_version,expiresAt:r.expires_at,mode:r.access_mode,
      driveShareEnabled:r.drive_share_enabled===1,
      role:r.access_mode==='google'?role:'reviewer',myVote:myVote?.decision||null,
      approvalsReceived:votes?.count||0,approvalsRequired:total?.count||1},
      assets:files.map(a=>({fileId:a.file_id,name:a.name,mimeType:a.mime_type,provider:a.provider})),
      comments:comments.results,decisions:decisions.results});
  }
  if(action==='media'){
    const body=await uploadBody(request) as Record<string,unknown>|null;
    if(!body||typeof body!=='object'||Array.isArray(body)||integer(body.version)!==r.current_version)
      throw new ApiError(409,'review_version_changed');
    const fileId=inputText(body.fileId,200,true);
    const chosen=files.find(asset=>asset.file_id===fileId);
    if(!chosen)throw new ApiError(404,'review_not_found');
    if(!(/^(video|image|audio)\//.test(chosen.mime_type)||chosen.mime_type==='application/pdf'))
      throw new ApiError(415,'review_media_unsupported');
    const subject=r.access_mode==='google'?await reviewMediaSubject(env,r.id,email):undefined;
    const ticket=await mintReviewMediaTicket(env,r.id,fileId,r.current_version,r.expires_at,r.token_hash,subject);
    return Response.json({url:'https://roteiva-api-dev.ewertonmendes9.workers.dev/reviews/media?ticket='+ticket,
      expiresAt:Math.min(r.expires_at,now()+REVIEW_MEDIA_MAX_AGE)});
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
  if(r.access_mode==='google'){
    const eventId=crypto.randomUUID();
    const vote=await env.DB.prepare("INSERT OR IGNORE INTO review_votes(review_id,version,email,decision,author_name,message,created_at) SELECT ?,?,?,?,?,?,? FROM review_requests WHERE id=? AND status='pending' AND current_version=? AND token_hash=? AND expires_at>?")
      .bind(r.id,r.current_version,email,decision,authorName,message,ts,r.id,r.current_version,r.token_hash,ts).run();
    if(vote.meta.changes!==1)throw new ApiError(409,'review_already_decided');
    // One request for changes ends the round immediately. Otherwise every
    // registered reviewer must explicitly approve before the owner sees Approved.
    const complete=decision==='changes'||!(await env.DB.prepare(
      "SELECT 1 FROM review_participants p WHERE p.review_id=? AND p.role='reviewer' AND NOT EXISTS(SELECT 1 FROM review_votes v WHERE v.review_id=p.review_id AND v.version=? AND v.email=p.email AND v.decision='approved') LIMIT 1"
    ).bind(r.id,r.current_version).first());
    if(complete){
      const saved=await env.DB.batch([
        env.DB.prepare("INSERT OR IGNORE INTO review_decisions(id,review_id,version,decision,author_name,author_email,message,created_at) SELECT ?,?,?,?,?,?,?,? FROM review_requests WHERE id=? AND status='pending' AND current_version=? AND token_hash=?")
          .bind(eventId,r.id,r.current_version,decision,authorName,email,message,ts,r.id,r.current_version,r.token_hash),
        env.DB.prepare("UPDATE review_requests SET status=?,updated_at=? WHERE id=? AND status='pending' AND current_version=? AND token_hash=? AND EXISTS(SELECT 1 FROM review_decisions WHERE id=?)")
          .bind(decision,ts,r.id,r.current_version,r.token_hash,eventId)
      ]);
      if(saved[0].meta.changes!==1||saved[1].meta.changes!==1)throw new ApiError(409,'review_busy');
    }
    return Response.json({saved:true,status:complete?decision:'pending'});
  }
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
/** Authenticated owner image preview. Unlike Drive's cross-origin iframe, this
 * preserves Roteiva's wheel/gesture behavior even when the modal itself scrolls.
 * Only images explicitly selected for this owner's current review are served.
 */
async function ownerImage(env:Env,r:Review,url:URL):Promise<Response>{
  if(!['pending','changes','approved'].includes(r.status)||r.expires_at<=now())
    throw new ApiError(404,'review_not_found');
  const fileId=url.searchParams.get('fileId')||'';
  if(!validStorageFileId(fileId.startsWith('id:')?'dropbox':'google_drive',fileId))throw new ApiError(404,'review_not_found');
  const asset=await env.DB.prepare(
    "SELECT connection_id,mime_type,provider FROM review_assets WHERE review_id=? AND version=? AND file_id=? AND grant_state='granted'"
  ).bind(r.id,r.current_version,fileId)
    .first<{connection_id:string;mime_type:string;provider:StorageProviderId}>();
  if(!asset||!asset.mime_type.startsWith('image/'))throw new ApiError(404,'review_not_found');
  let upstream:Response;
  if(asset.provider==='dropbox'){
    upstream=await dropboxMedia(env,r.owner_uid,asset.connection_id,fileId);
  }else{
    const row=await connection(env,r.owner_uid,asset.connection_id);
    const credential=await accessCredential(env,row);
    const target=new URL('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(fileId));
    target.searchParams.set('alt','media');target.searchParams.set('supportsAllDrives','true');
    try{upstream=await fetch(target,{
      method:'GET',redirect:'manual',signal:AbortSignal.timeout(24000),
      headers:{Authorization:'Bearer '+credential.value}
    });}catch{throw new ApiError(502,'media_unavailable');}
  }
  if(!upstream.ok||upstream.redirected||upstream.status>=300&&upstream.status<400){
    await upstream.body?.cancel();throw new ApiError(502,'media_unavailable');
  }
  const max=24*1024*1024,reported=Number(upstream.headers.get('Content-Length')||0);
  if(Number.isFinite(reported)&&reported>max){await upstream.body?.cancel();throw new ApiError(413,'media_unavailable');}
  const type=(upstream.headers.get('Content-Type')||'').split(';')[0].trim().toLowerCase();
  if(!(asset.provider==='dropbox'&&type==='application/octet-stream')&&(!type.startsWith('image/')||type!==asset.mime_type.toLowerCase())){
    await upstream.body?.cancel();throw new ApiError(502,'media_unavailable');
  }
  let used=0;
  const bounded=upstream.body?.pipeThrough(new TransformStream<Uint8Array,Uint8Array>({
    transform(chunk,controller){
      used+=chunk.byteLength;
      if(used>max)throw new Error('image exceeds preview limit');
      controller.enqueue(chunk);
    }
  }));
  return new Response(bounded||null,{status:200,headers:{
    'Content-Type':asset.mime_type,'Cache-Control':'private, no-store',
    'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
    'Content-Disposition':'inline'
  }});
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
  if(parts.length===4&&parts[3]==='image'&&request.method==='GET')return ownerImage(env,r,url);
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
