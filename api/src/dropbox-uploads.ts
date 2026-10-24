import {ApiError,type Env} from './types.ts';
import {context,encrypt,decrypt} from './crypto.ts';
import {dropboxConnection,dropboxAccess,dropboxMetadata,dropboxNormalize} from './dropbox.ts';
import {validStorageFileId,validStorageFolderId,validConnectionId} from './storage.ts';
import {uploadBody} from './uploads.ts';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CHUNK=4*1024*1024, MAX_FILE=2_199_019_061_248;
type Attempt={id:string;owner_uid:string;connection_id:string;connection_revision:number;
 project_id:number;linked_folder_id:string;target_folder_id:string;name:string;
 size:number;mime_type:string;encrypted_session:string|null;committed_offset:number;
 status:'starting'|'active'|'uncertain'|'completed'|'failed';file_id:string|null;
 lease_id:string|null;lease_until:number;expires_at:number};
type Start={attemptId:string;projectId:number;linkedFolderId:string;targetFolderId:string;
 name:string;size:number;mimeType:string};
function validName(name:unknown):name is string {
 return typeof name==='string'&&name.length>0&&name.length<=255&&
  name!=='.'&&name!=='..'&&!/[/\\\u0000-\u001f\u007f]/.test(name);
}
function isStart(data:unknown):data is Start{
 if(!data||typeof data!=='object'||Array.isArray(data))return false;
 const x=data as Partial<Start>;
 return typeof x.attemptId==='string'&&UUID.test(x.attemptId)&&
  Number.isSafeInteger(x.projectId)&&x.projectId!>0&&
  typeof x.linkedFolderId==='string'&&validStorageFolderId('dropbox',x.linkedFolderId,true)&&
  typeof x.targetFolderId==='string'&&validStorageFolderId('dropbox',x.targetFolderId,true)&&
  validName(x.name)&&typeof x.size==='number'&&Number.isSafeInteger(x.size)&&x.size>0&&x.size<=MAX_FILE&&
  typeof x.mimeType==='string'&&x.mimeType.length<=120&&/^[\w!#$&^.+-]+\/[\w!#$&^.+-]+$/.test(x.mimeType);
}
function envFire(env:Env,uid:string):string{
 return 'https://firestore.googleapis.com/v1/projects/'+encodeURIComponent(env.FIREBASE_PROJECT_ID)+
 '/databases/(default)/documents/users/'+encodeURIComponent(uid);
}
export async function assertDropboxFolderLinked(env:Env,uid:string,auth:string,connectionId:string,
 projectId:number,linkedFolderId:string,fetcher:typeof fetch=fetch):Promise<void>{
 const docId=projectId+'_'+connectionId+'_'+linkedFolderId,base=envFire(env,uid);
 const headers={Authorization:'Bearer '+auth};
 const url=base+'/dropboxFolders/'+encodeURIComponent(docId);
 let response:Response;
 try{response=await fetcher(url,{method:'GET',redirect:'manual',headers,signal:AbortSignal.timeout(10000)})}
 catch{throw new ApiError(503,'dropbox_folder_authorization_unavailable')}
 if(!response.ok)throw new ApiError(response.status===401||response.status===403||response.status===404?403:503,
  'dropbox_folder_not_linked');
 const record=await response.json().catch(()=>null) as {fields?:Record<string,{stringValue?:string;integerValue?:string}>}|null;
 if(record?.fields?.ownerUid?.stringValue!==uid||
    record?.fields?.connectionId?.stringValue!==connectionId||
    record?.fields?.projectId?.integerValue!==String(projectId)||
    record?.fields?.folderId?.stringValue!==linkedFolderId)
   throw new ApiError(403,'dropbox_folder_not_linked');
 const project=await fetcher(base+'/projects/'+projectId,{method:'GET',redirect:'manual',headers,signal:AbortSignal.timeout(10000)});
 if(!project.ok)throw new ApiError(403,'dropbox_project_denied');
 const meta=await project.json().catch(()=>null) as {fields?:{ownerUid?:{stringValue?:string}}}|null;
 if(meta?.fields?.ownerUid?.stringValue!==uid)throw new ApiError(403,'dropbox_project_denied');
}
function norm(path:string):string {return path.toLowerCase().replace(/\/+$/,'');}
export async function verifyDropboxDescendant(env:Env,uid:string,connectionId:string,
 linkedId:string,targetId:string,requireFile=false):Promise<{path:string;name:string;mimeType:string}>{
 if(!validStorageFolderId('dropbox',linkedId,true)||!validStorageFolderId('dropbox',targetId,true))
  throw new ApiError(400,'dropbox_invalid_folder');
 if(requireFile)throw new ApiError(400,'dropbox_invalid_folder');
 const linked=linkedId==='root'?null:await dropboxMetadata(env,uid,connectionId,linkedId);
 const target=targetId==='root'?null:await dropboxMetadata(env,uid,connectionId,targetId);
 if(linked&&linked['.tag']!=='folder'||target&&target['.tag']!=='folder')throw new ApiError(403,'dropbox_folder_not_linked');
 const parent=linkedId==='root'?'':linked?.path_lower,child=targetId==='root'?'':target?.path_lower;
 if(typeof parent!=='string'||typeof child!=='string')throw new ApiError(403,'dropbox_folder_not_linked');
 if(parent&&norm(child)!==norm(parent)&&!norm(child).startsWith(norm(parent)+'/'))
  throw new ApiError(403,'dropbox_folder_not_linked');
 return {path:target?.path_display||'',name:target?.name||'Meu Dropbox',mimeType:'application/vnd.roteiva.folder'};
}
export async function verifyDropboxFile(env:Env,uid:string,connectionId:string,linkedId:string,
 fileId:string):Promise<{name:string;mimeType:string;size:number}>{
 if(!validStorageFileId('dropbox',fileId))throw new ApiError(400,'dropbox_invalid_file');
 const folder=linkedId==='root'?null:await dropboxMetadata(env,uid,connectionId,linkedId);
 const file=await dropboxMetadata(env,uid,connectionId,fileId);
 if(folder&&folder['.tag']!=='folder'||file['.tag']!=='file'||!file.is_downloadable)
   throw new ApiError(403,'review_file_denied');
 const root=folder?folder.path_lower:'',p=file.path_lower;
 if(typeof root!=='string'||typeof p!=='string'||!p.startsWith(norm(root)+'/')||
   p===norm(root)+'/')throw new ApiError(403,'review_file_denied');
 const normalized=dropboxNormalize(file);
 if(!normalized||!/^(image|video|audio)\//.test(normalized.mimeType)&&normalized.mimeType!=='application/pdf')
  throw new ApiError(415,'review_media_unsupported');
 return {name:normalized.name,mimeType:normalized.mimeType,size:Number(file.size)||0};
}
function sessionContext(env:Env,row:Attempt){
 return context(env,row.owner_uid,row.connection_id,'dropbox-upload:'+row.id+':'+row.connection_revision);
}
async function attempt(env:Env,uid:string,connectionId:string,id:string):Promise<Attempt>{
 if(!UUID.test(id)||!validConnectionId(connectionId))throw new ApiError(400,'dropbox_invalid_upload');
 const row=await env.DB.prepare('SELECT * FROM dropbox_upload_attempts WHERE owner_uid=? AND connection_id=? AND id=?')
 .bind(uid,connectionId,id).first<Attempt>();
 if(!row)throw new ApiError(404,'dropbox_upload_not_found');
 if(row.expires_at<Date.now())throw new ApiError(410,'dropbox_upload_expired');
 return row;
}
async function contentRequest(env:Env,uid:string,connectionId:string,endpoint:string,
 arg:unknown,body:Uint8Array,fetcher:typeof fetch=fetch):Promise<Response>{
 const row=await dropboxConnection(env,uid,connectionId);
 if(row.status!=='connected')throw new ApiError(409,'dropbox_reconnect_required');
 const token=await dropboxAccess(env,row,fetcher);
 let response:Response;
 try{response=await fetcher('https://content.dropboxapi.com/2/files/'+endpoint,{
   method:'POST',redirect:'manual',signal:AbortSignal.timeout(25000),
   headers:{Authorization:'Bearer '+token,'Dropbox-API-Arg':JSON.stringify(arg),
    'Content-Type':'application/octet-stream'},body
  });}catch{throw new ApiError(502,'dropbox_upload_transport_failed')}
 if(response.status>=300&&response.status<400){await response.body?.cancel();throw new ApiError(502,'dropbox_upload_unavailable')}
 return response;
}
async function boundedBytes(request:Request,max:number):Promise<Uint8Array>{
 const declared=Number(request.headers.get('Content-Length')||0);
 if(declared>max)throw new ApiError(413,'dropbox_upload_chunk_too_large');
 const chunks:Uint8Array[]=[];let used=0;
 const reader=request.body?.getReader();if(!reader)throw new ApiError(400,'dropbox_upload_empty');
 try{while(true){const {value,done}=await reader.read();if(done)break;
  used+=value.byteLength;
  if(used>max){await reader.cancel();throw new ApiError(413,'dropbox_upload_chunk_too_large')}
  chunks.push(value);
 }}finally{reader.releaseLock()}
 const b=new Uint8Array(used);let i=0;for(const chunk of chunks){b.set(chunk,i);i+=chunk.length}return b;
}
async function lock(env:Env,row:Attempt):Promise<string>{
 const lease=crypto.randomUUID(),ts=Date.now();
 const acquired=await env.DB.prepare(
 "UPDATE dropbox_upload_attempts SET lease_id=?,lease_until=? WHERE owner_uid=? AND id=? AND connection_id=? AND lease_until<? AND status IN ('active','uncertain')"
 ).bind(lease,ts+60000,row.owner_uid,row.id,row.connection_id,ts).run();
 if(acquired.meta.changes!==1)throw new ApiError(409,'dropbox_upload_busy');
 return lease;
}
async function unlock(env:Env,row:Attempt,lease:string):Promise<void>{
 await env.DB.prepare('UPDATE dropbox_upload_attempts SET lease_id=NULL,lease_until=0 WHERE owner_uid=? AND id=? AND lease_id=?')
 .bind(row.owner_uid,row.id,lease).run();
}
export async function startDropboxUpload(env:Env,uid:string,connectionId:string,request:Request):Promise<Response>{
 const raw=await uploadBody(request);
 if(!isStart(raw))throw new ApiError(400,'dropbox_invalid_upload');
 const data=raw;
 const token=request.headers.get('Authorization')?.slice(7)||'';
 await assertDropboxFolderLinked(env,uid,token,connectionId,data.projectId,data.linkedFolderId);
 await verifyDropboxDescendant(env,uid,connectionId,data.linkedFolderId,data.targetFolderId);
 const conn=await dropboxConnection(env,uid,connectionId);
 if(conn.status!=='connected')throw new ApiError(409,'dropbox_reconnect_required');
 const old=await env.DB.prepare('SELECT * FROM dropbox_upload_attempts WHERE owner_uid=? AND id=?')
  .bind(uid,data.attemptId).first<Attempt>();
 if(old){
  if(old.connection_id!==connectionId||old.connection_revision!==conn.revision||old.project_id!==data.projectId||
   old.linked_folder_id!==data.linkedFolderId||old.target_folder_id!==data.targetFolderId||
   old.name!==data.name||old.mime_type!==data.mimeType||old.size!==data.size)
    throw new ApiError(409,'dropbox_upload_mismatch');
  if(old.status==='completed')return Response.json({attemptId:old.id,offset:old.size,completed:true,fileId:old.file_id});
  if(!old.encrypted_session)throw new ApiError(409,'dropbox_upload_uncertain');
  return Response.json({attemptId:old.id,offset:old.committed_offset,chunkSize:CHUNK});
 }
 const ts=Date.now();
 const inserted=await env.DB.prepare(
 "INSERT OR IGNORE INTO dropbox_upload_attempts(id,owner_uid,connection_id,connection_revision,project_id,linked_folder_id,target_folder_id,name,size,mime_type,status,expires_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,'starting',?,?,?)"
 ).bind(data.attemptId,uid,connectionId,conn.revision,data.projectId,data.linkedFolderId,
    data.targetFolderId,data.name,data.size,data.mimeType,ts+6*86400000,ts,ts).run();
 if(inserted.meta.changes!==1)throw new ApiError(409,'dropbox_upload_busy');
 const response=await contentRequest(env,uid,connectionId,'upload_session/start',{close:false},new Uint8Array(0));
 if(!response.ok){await response.body?.cancel();throw new ApiError(502,'dropbox_upload_unavailable')}
 const json=await response.json().catch(()=>null) as {session_id?:unknown}|null;
 if(typeof json?.session_id!=='string'||json.session_id.length>400)
  throw new ApiError(502,'dropbox_upload_unavailable');
 const row=await attempt(env,uid,connectionId,data.attemptId);
 const encrypted=await encrypt(env,json.session_id,sessionContext(env,row));
 const saved=await env.DB.prepare(
 "UPDATE dropbox_upload_attempts SET encrypted_session=?,status='active',updated_at=? WHERE owner_uid=? AND id=? AND status='starting' AND connection_revision=?"
 ).bind(encrypted,Date.now(),uid,data.attemptId,conn.revision).run();
 if(saved.meta.changes!==1)throw new ApiError(409,'dropbox_upload_busy');
 return Response.json({attemptId:data.attemptId,offset:0,chunkSize:CHUNK});
}
export async function appendDropboxUpload(env:Env,uid:string,connectionId:string,id:string,
 request:Request):Promise<Response>{
 const row=await attempt(env,uid,connectionId,id);
 const offset=Number(new URL(request.url).searchParams.get('offset'));
 if(!Number.isSafeInteger(offset)||offset<0||offset%CHUNK!==0||offset>row.size)
  throw new ApiError(400,'dropbox_upload_invalid_offset');
 const bytes=await boundedBytes(request,CHUNK);
 if(bytes.length<=0||offset+bytes.length>row.size||
   (offset+bytes.length<row.size&&bytes.length!==CHUNK))throw new ApiError(400,'dropbox_upload_invalid_chunk');
 if(row.status==='completed')throw new ApiError(409,'dropbox_upload_already_finished');
 if(offset<row.committed_offset&&offset+bytes.length===row.committed_offset)
  return Response.json({offset:row.committed_offset});
 if(offset!==row.committed_offset||!row.encrypted_session)
   throw new ApiError(409,'dropbox_upload_invalid_offset');
 const auth=request.headers.get('Authorization')?.slice(7)||'';
 await assertDropboxFolderLinked(env,uid,auth,connectionId,row.project_id,row.linked_folder_id);
 await verifyDropboxDescendant(env,uid,connectionId,row.linked_folder_id,row.target_folder_id);
 const conn=await dropboxConnection(env,uid,connectionId);
 if(conn.revision!==row.connection_revision)throw new ApiError(409,'dropbox_reconnect_required');
 const lease=await lock(env,row);
 try{
  const session=await decrypt(env,row.encrypted_session,sessionContext(env,row));
  const response=await contentRequest(env,uid,connectionId,'upload_session/append_v2',
   {cursor:{session_id:session,offset},close:offset+bytes.length===row.size},bytes);
  let committed=0;
  if(response.ok){committed=offset+bytes.length;await response.body?.cancel();}
  else if(response.status===409){
   const failure=await response.json().catch(()=>null);
   const find=(x:unknown,d=0):number|null=>{
    if(d>5||!x||typeof x!=='object')return null;
    const obj=x as Record<string,unknown>;
    if(obj['.tag']==='incorrect_offset'&&Number.isSafeInteger(obj.correct_offset))return obj.correct_offset as number;
    for(const v of Object.values(obj)){const found=find(v,d+1);if(found!==null)return found}
    return null;
   };
   const server=find(failure);
   if(server!==offset+bytes.length)throw new ApiError(409,'dropbox_upload_invalid_offset');
   committed=server;
  }else{await response.body?.cancel();
   throw new ApiError(response.status===429?429:502,'dropbox_upload_unavailable')}
  const saved=await env.DB.prepare(
    "UPDATE dropbox_upload_attempts SET committed_offset=?,status='active',updated_at=? WHERE owner_uid=? AND id=? AND lease_id=? AND committed_offset=? AND status IN ('active','uncertain')"
  ).bind(committed,Date.now(),uid,id,lease,offset).run();
  if(saved.meta.changes!==1)throw new ApiError(409,'dropbox_upload_busy');
  return Response.json({offset:committed});
 }catch(error){
  await env.DB.prepare("UPDATE dropbox_upload_attempts SET status='uncertain',updated_at=? WHERE owner_uid=? AND id=? AND lease_id=?")
   .bind(Date.now(),uid,id,lease).run();
  throw error;
 }finally{await unlock(env,row,lease)}
}
export async function finishDropboxUpload(env:Env,uid:string,connectionId:string,id:string,request:Request):Promise<Response>{
 const row=await attempt(env,uid,connectionId,id);
 if(row.status==='completed'&&row.file_id)return Response.json({fileId:row.file_id,id:row.file_id,name:row.name,size:String(row.size),mimeType:row.mime_type});
 if(row.status==='uncertain')throw new ApiError(409,'dropbox_upload_uncertain');
 if(row.status!=='active'||row.committed_offset!==row.size||!row.encrypted_session)
  throw new ApiError(409,'dropbox_upload_incomplete');
 const auth=request.headers.get('Authorization')?.slice(7)||'';
 await assertDropboxFolderLinked(env,uid,auth,connectionId,row.project_id,row.linked_folder_id);
 const target=await verifyDropboxDescendant(env,uid,connectionId,row.linked_folder_id,row.target_folder_id);
 const conn=await dropboxConnection(env,uid,connectionId);
 if(conn.revision!==row.connection_revision)throw new ApiError(409,'dropbox_reconnect_required');
 const lease=await lock(env,row);
 try{
  const session=await decrypt(env,row.encrypted_session,sessionContext(env,row));
  const dest=(target.path||'')+'/'+row.name;
  const response=await contentRequest(env,uid,connectionId,'upload_session/finish',
    {cursor:{session_id:session,offset:row.size},commit:{path:dest,mode:'add',autorename:true,mute:true}},new Uint8Array(0));
  if(!response.ok){await response.body?.cancel();throw new ApiError(502,'dropbox_upload_unconfirmed')}
  const data=await response.json().catch(()=>null) as {id?:unknown;name?:unknown;size?:unknown;path_lower?:unknown}|null;
  if(!data||typeof data.id!=='string'||!validStorageFileId('dropbox',data.id)||
    data.size!==row.size||typeof data.path_lower!=='string'||
    !data.path_lower.startsWith((target.path.toLowerCase()||'')+'/'))
    throw new ApiError(502,'dropbox_upload_unconfirmed');
  const saved=await env.DB.prepare(
    "UPDATE dropbox_upload_attempts SET status='completed',file_id=?,encrypted_session=NULL,updated_at=? WHERE owner_uid=? AND id=? AND lease_id=? AND committed_offset=?"
  ).bind(data.id,Date.now(),uid,id,lease,row.size).run();
  if(saved.meta.changes!==1)throw new ApiError(409,'dropbox_upload_busy');
  return Response.json({fileId:data.id,id:data.id,name:data.name,size:String(row.size),mimeType:row.mime_type});
 }catch(error){
  // Never blindly finish twice: the response may have been lost after commit.
  await env.DB.prepare("UPDATE dropbox_upload_attempts SET status='uncertain',updated_at=? WHERE owner_uid=? AND id=? AND lease_id=?")
   .bind(Date.now(),uid,id,lease).run();
  throw error;
 }finally{await unlock(env,row,lease)}
}
export async function cleanupDropboxUploads(env:Env):Promise<void>{
 await env.DB.prepare('DELETE FROM dropbox_upload_attempts WHERE rowid IN (SELECT rowid FROM dropbox_upload_attempts WHERE expires_at<? LIMIT 50)').bind(Date.now()).run();
 await env.DB.prepare('DELETE FROM dropbox_oauth_transactions WHERE rowid IN (SELECT rowid FROM dropbox_oauth_transactions WHERE expires_at<? LIMIT 50)').bind(Date.now()).run();
}
