import { ApiError, type Env } from './types.ts';
import { connection } from './repository.ts';
import { DRIVE_SCOPE, accessCredential } from './google.ts';
import { driveJson } from './drive-client.ts';
import { rejectCachedToken } from './token-store.ts';
import { context, encrypt, decrypt } from './crypto.ts';
import { sealThumbnailTicket } from './thumbnails.ts';

const FOLDER = 'application/vnd.google-apps.folder';
const ID = /^[A-Za-z0-9_-]{10,200}$/;
const CONN = /^[A-Za-z0-9-]{36}$/;
const MAX_SIZE = 5_000_000_000_000;
const CHUNK_SIZE = 8 * 1024 * 1024;
function boundedFetch(fetcher:typeof fetch):typeof fetch {
  let remaining=42; // Leave headroom below Workers Free's 50 external subrequests.
  return (async(...args:Parameters<typeof fetch>)=>{
    if(--remaining<0)throw new ApiError(422,'upload_authorization_too_complex');
    return fetcher(...args);
  }) as typeof fetch;
}

type UploadInput = {attemptId:string;projectId:number;linkedFolderId:string;name:string;size:number;mimeType?:string};
type Attempt = {id:string;owner_uid:string;connection_id:string;connection_revision:number;project_id:number;
  linked_folder_id:string;target_folder_id:string;file_id:string;name:string;mime_type:string;size:number;
  encrypted_session:string|null;status:'starting'|'active'|'completed';expires_at:number};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type GoogleFile = {id?:unknown;name?:unknown;mimeType?:unknown;size?:unknown;parents?:unknown;webViewLink?:unknown;thumbnailLink?:unknown;modifiedTime?:unknown};

function validId(value:string):string {
  if (!ID.test(value)) throw new ApiError(400,'invalid_folder_id');
  return value;
}

function input(value:unknown):UploadInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(400,'invalid_upload');
  const data = value as Partial<UploadInput>;
  if (typeof data.attemptId!=='string' || !UUID.test(data.attemptId) ||
      !Number.isSafeInteger(data.projectId) || !data.projectId || data.projectId <= 0 ||
      typeof data.linkedFolderId !== 'string' || !ID.test(data.linkedFolderId) ||
      typeof data.name !== 'string' || !data.name.trim() || data.name.length > 255 ||
      /[\u0000-\u001f\u007f]/.test(data.name) ||
      !Number.isSafeInteger(data.size) || data.size === undefined || data.size < 1 || data.size > MAX_SIZE ||
      (data.mimeType !== undefined && (typeof data.mimeType !== 'string' ||
       data.mimeType.length > 120 || !/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/.test(data.mimeType) ||
       data.mimeType.startsWith('application/vnd.google-apps.'))))
    throw new ApiError(400,'invalid_upload');
  return {attemptId:data.attemptId,projectId:data.projectId,linkedFolderId:data.linkedFolderId,
    name:data.name,size:data.size,mimeType:data.mimeType || 'application/octet-stream'};
}

export async function uploadBody(request:Request):Promise<unknown> {
  const size=Number(request.headers.get('Content-Length')||0);
  if (size>8192) throw new ApiError(413,'upload_metadata_too_large');
  const reader=request.body?.getReader();
  const chunks:Uint8Array[]=[];let length=0;
  if(reader)try{while(true){
    const {done,value}=await reader.read();if(done)break;
    length+=value.byteLength;if(length>8192){await reader.cancel();throw new ApiError(413,'upload_metadata_too_large');}
    chunks.push(value);
  }}finally{reader.releaseLock();}
  const bytes=new Uint8Array(length);let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  const raw=new TextDecoder().decode(bytes);
  try {return JSON.parse(raw) as unknown;} catch {throw new ApiError(400,'invalid_upload');}
}

/** Firestore Rules authorize this *same* Firebase ID token; a folder ID alone is not a grant. */
async function linkedFolder(env:Env,uid:string,token:string,connectionId:string,
  projectId:number,folderId:string,fetcher:typeof fetch):Promise<void> {
  if (!CONN.test(connectionId)) throw new ApiError(400,'invalid_connection_id');
  const docId=String(projectId)+'_'+connectionId+'_'+folderId;
  const url='https://firestore.googleapis.com/v1/projects/'+encodeURIComponent(env.FIREBASE_PROJECT_ID)+
    '/databases/(default)/documents/users/'+encodeURIComponent(uid)+'/driveFolders/'+encodeURIComponent(docId);
  let response:Response;
  try {
    response=await fetcher(url,{method:'GET',redirect:'manual',
      headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(10000)});
  } catch {throw new ApiError(503,'folder_authorization_unavailable');}
  if (response.status===401 || response.status===403) throw new ApiError(403,'upload_project_denied');
  if (response.status===404) throw new ApiError(403,'upload_folder_not_linked');
  if (!response.ok) throw new ApiError(503,'folder_authorization_unavailable');
  const value=await response.json().catch(()=>null) as {fields?:Record<string,{stringValue?:string;integerValue?:string}>}|null;
  const fields=value?.fields;
  if (fields?.ownerUid?.stringValue!==uid || fields?.connectionId?.stringValue!==connectionId ||
      fields?.folderId?.stringValue!==folderId || fields?.projectId?.integerValue!==String(projectId))
    throw new ApiError(403,'upload_folder_not_linked');
  // A link can outlive a deleted project; Rules allow reading such links.
  const project=await fetcher(url.slice(0,url.lastIndexOf('/driveFolders/'))+'/projects/'+projectId,
    {headers:{Authorization:'Bearer '+token},redirect:'manual',signal:AbortSignal.timeout(10000)});
  if(project.status===404 || project.status===403)throw new ApiError(403,'upload_project_denied');
  if(!project.ok)throw new ApiError(503,'folder_authorization_unavailable');
  const saved=await project.json() as {fields?:{ownerUid?:{stringValue?:string}}};
  if(saved.fields?.ownerUid?.stringValue!==uid)throw new ApiError(403,'upload_project_denied');
}

async function destination(env:Env,row:Awaited<ReturnType<typeof connection>>,
  targetId:string,rootId:string,fetcher:typeof fetch,requireGrant=true) {
  // Every descendant must lead to the user-linked root, without trusting the UI breadcrumb.
  let current=targetId;
  const visited=new Set<string>();
  for(let i=0;i<32;i++){
    if(visited.has(current))throw new ApiError(403,'upload_folder_not_linked');
    visited.add(current);
    const url=new URL('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(current));
    url.searchParams.set('fields','id,mimeType,trashed,parents,isAppAuthorized,capabilities(canAddChildren)');
    url.searchParams.set('supportsAllDrives','true');
    const info=await driveJson(env,row,url,fetcher,'drive_folder_not_found');
    if(info.mimeType!==FOLDER || info.trashed===true)throw new ApiError(404,'drive_folder_not_found');
    if(current===targetId){
      if((info.capabilities as {canAddChildren?:boolean}|undefined)?.canAddChildren!==true)
        throw new ApiError(403,'drive_upload_permission_missing');
      if(requireGrant && info.isAppAuthorized!==true)throw new ApiError(409,'drive_picker_required');
    }
    if(current===rootId){
      return;
    }
    const parents=info.parents;
    if(!Array.isArray(parents) || parents.length!==1 || typeof parents[0]!=='string' || !ID.test(parents[0]))
      throw new ApiError(403,'upload_folder_not_linked');
    current=parents[0];
  }
  throw new ApiError(403,'upload_folder_not_linked');
}

function uploadLocation(value:string|null):string {
  if(!value)throw new ApiError(502,'upload_session_invalid');
  let url:URL;
  try{url=new URL(value);}catch{throw new ApiError(502,'upload_session_invalid');}
  if(url.protocol!=='https:' || !['www.googleapis.com','content.googleapis.com'].includes(url.hostname) ||
     url.port || url.username || url.password || url.hash ||
     url.pathname!=='/upload/drive/v3/files' || !url.searchParams.get('upload_id'))
    throw new ApiError(502,'upload_session_invalid');
  return url.href;
}

/** Only metadata travels through the Worker. The browser PUTs bytes to this Google session. */
export async function startUpload(env:Env,uid:string,connectionId:string,targetId:string,
  request:Request,fetcher:typeof fetch=fetch):Promise<Response> {
  fetcher=boundedFetch(fetcher);
  validId(targetId);
  const data=input(await uploadBody(request));
  const firebaseToken=request.headers.get('Authorization')?.replace(/^Bearer /,'')||'';
  let row=await connection(env,uid,connectionId);
  await linkedFolder(env,uid,firebaseToken,connectionId,data.projectId,data.linkedFolderId,fetcher);
  if(row.status!=='connected')throw new ApiError(409,'reconnect_required');
  if(!row.scopes.split(/\s+/).includes(DRIVE_SCOPE))throw new ApiError(409,'drive_upload_permission_missing');
  await destination(env,row,targetId,data.linkedFolderId,fetcher);
  row=await connection(env,uid,connectionId);
  if(row.status!=='connected')throw new ApiError(409,'reconnect_required');
  const existing=await env.DB.prepare('SELECT * FROM drive_upload_attempts WHERE owner_uid=? AND id=?')
    .bind(uid,data.attemptId).first<Attempt>();
  if(existing){
    if(existing.connection_id!==connectionId || existing.connection_revision!==row.revision ||
       existing.project_id!==data.projectId || existing.linked_folder_id!==data.linkedFolderId ||
       existing.target_folder_id!==targetId || existing.name!==data.name || existing.size!==data.size ||
       existing.mime_type!==data.mimeType)throw new ApiError(409,'upload_attempt_mismatch');
    if(existing.expires_at<=Date.now())throw new ApiError(410,'upload_attempt_expired');
    if(existing.status!=='active'||!existing.encrypted_session)throw new ApiError(409,'upload_attempt_uncertain');
    return Response.json({attemptId:data.attemptId,sessionUrl:uploadLocation(await decrypt(env,existing.encrypted_session,
      context(env,uid,row.google_account_id,'upload:'+row.id+':'+data.attemptId))),chunkSize:CHUNK_SIZE},
      {headers:{'Cache-Control':'no-store'}});
  }
  const ids=await driveJson(env,row,new URL('https://www.googleapis.com/drive/v3/files/generateIds?count=1&space=drive&type=files'),fetcher);
  const fileId=Array.isArray(ids.ids)?ids.ids[0]:null;
  if(typeof fileId!=='string'||!ID.test(fileId))throw new ApiError(502,'invalid_google_response');
  // Reserve before the external write. An uncertain start cannot silently mint a duplicate.
  const reserved=await env.DB.prepare(`INSERT OR IGNORE INTO drive_upload_attempts
    (id,owner_uid,connection_id,connection_revision,project_id,linked_folder_id,target_folder_id,file_id,name,mime_type,size,status,expires_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,'starting',?)`)
    .bind(data.attemptId,uid,row.id,row.revision,data.projectId,data.linkedFolderId,targetId,fileId,
      data.name,data.mimeType,data.size,Date.now()+86400000).run();
  if(reserved.meta.changes!==1)throw new ApiError(409,'upload_attempt_uncertain');
  const token=await accessCredential(env,row,fetcher);
  const url=new URL('https://www.googleapis.com/upload/drive/v3/files');
  url.searchParams.set('uploadType','resumable');
  url.searchParams.set('fields','id,name,mimeType,size,parents,webViewLink');
  url.searchParams.set('supportsAllDrives','true');
  let response:Response;
  try {
    response=await fetcher(url,{method:'POST',redirect:'manual',headers:{
      Authorization:'Bearer '+token.value,'Content-Type':'application/json; charset=UTF-8',
      'X-Upload-Content-Length':String(data.size),'X-Upload-Content-Type':data.mimeType!,
      Origin:env.FRONTEND_ORIGIN,
    },body:JSON.stringify({id:fileId,name:data.name,mimeType:data.mimeType,parents:[targetId]}),
    signal:AbortSignal.timeout(12000)});
  }catch{throw new ApiError(502,'drive_upload_transport_failed');}
  if(response.status===401){
    await response.body?.cancel();
    await rejectCachedToken(env,row,token.version);
    throw new ApiError(409,'reconnect_required');
  }
  if(!response.ok){
    if(response.status>=400&&response.status<500)
      await env.DB.prepare("DELETE FROM drive_upload_attempts WHERE owner_uid=? AND id=? AND status='starting'")
        .bind(uid,data.attemptId).run();
    // Drive returns several quota classes as HTTP 403; do not mistake them for missing OAuth grants.
    const error=await response.json().catch(()=>null) as {error?:{errors?:Array<{reason?:string}>}}|null;
    const reasons=error?.error?.errors?.map(item=>item.reason)||[];
    if(response.status===429 || reasons.some(reason=>['rateLimitExceeded','userRateLimitExceeded','dailyLimitExceeded','quotaExceeded'].includes(reason||'')))
      throw new ApiError(429,'drive_rate_limited');
    if(response.status===507 || reasons.includes('storageQuotaExceeded'))
      throw new ApiError(507,'drive_storage_full');
    if(response.status===403)throw new ApiError(403,'drive_upload_permission_missing');
    if(response.status===400 || response.status===413)throw new ApiError(400,'drive_upload_rejected');
    throw new ApiError(502,'drive_upload_unavailable');
  }
  const sessionUrl=uploadLocation(response.headers.get('Location'));
  const encrypted=await encrypt(env,sessionUrl,context(env,uid,row.google_account_id,'upload:'+row.id+':'+data.attemptId));
  const saved=await env.DB.prepare(`UPDATE drive_upload_attempts SET encrypted_session=?,status='active'
    WHERE owner_uid=? AND id=? AND EXISTS(SELECT 1 FROM drive_connections WHERE id=? AND owner_uid=? AND revision=? AND status='connected')`)
    .bind(encrypted,uid,data.attemptId,row.id,uid,row.revision).run();
  if(saved.meta.changes!==1)throw new ApiError(409,'connection_changed');
  return Response.json({attemptId:data.attemptId,sessionUrl,chunkSize:CHUNK_SIZE},{headers:{'Cache-Control':'no-store'}});
}

/** Independently verify Drive's final file before updating local UI/cache. */
export async function completeUpload(env:Env,uid:string,connectionId:string,targetId:string,
  request:Request,fetcher:typeof fetch=fetch):Promise<Response> {
  fetcher=boundedFetch(fetcher);
  validId(targetId);
  const payload=await uploadBody(request);
  const data=payload as {attemptId?:string;projectId?:number;linkedFolderId?:string;fileId?:string;size?:number}|null;
  if(!data || typeof data.attemptId!=='string'||!UUID.test(data.attemptId)|| !Number.isSafeInteger(data.projectId) || !data.projectId ||
     typeof data.linkedFolderId!=='string'||!ID.test(data.linkedFolderId)||
     typeof data.fileId!=='string'||!ID.test(data.fileId)||
     !Number.isSafeInteger(data.size)||data.size===undefined||data.size<1)
    throw new ApiError(400,'invalid_upload');
  const firebaseToken=request.headers.get('Authorization')?.replace(/^Bearer /,'')||'';
  const row=await connection(env,uid,connectionId);
  if(row.status!=='connected')throw new ApiError(409,'reconnect_required');
  const attempt=await env.DB.prepare('SELECT * FROM drive_upload_attempts WHERE owner_uid=? AND id=?')
    .bind(uid,data.attemptId).first<Attempt>();
  if(!attempt || attempt.connection_id!==row.id || attempt.connection_revision!==row.revision ||
     attempt.project_id!==data.projectId || attempt.target_folder_id!==targetId ||
     attempt.linked_folder_id!==data.linkedFolderId || attempt.file_id!==data.fileId ||
     attempt.size!==data.size)throw new ApiError(409,'upload_attempt_mismatch');
  if(attempt.expires_at<=Date.now())throw new ApiError(410,'upload_attempt_expired');
  await linkedFolder(env,uid,firebaseToken,connectionId,data.projectId!,data.linkedFolderId,fetcher);
  await destination(env,row,targetId,data.linkedFolderId,fetcher);
  const url=new URL('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(data.fileId));
  url.searchParams.set('fields','id,name,mimeType,size,parents,trashed,webViewLink,thumbnailLink,modifiedTime');
  url.searchParams.set('supportsAllDrives','true');
  const result=await driveJson(env,row,url,fetcher,'drive_upload_not_confirmed') as GoogleFile & {trashed?:boolean};
  if(result.id!==data.fileId || !Array.isArray(result.parents) ||
     !result.parents.includes(targetId) || result.trashed===true ||
     result.size!==String(attempt.size) || result.name!==attempt.name || result.mimeType!==attempt.mime_type)
    throw new ApiError(409,'drive_upload_not_confirmed');
  await env.DB.prepare("UPDATE drive_upload_attempts SET status='completed',encrypted_session=NULL WHERE owner_uid=? AND id=?")
    .bind(uid,data.attemptId).run();
  const latest=await connection(env,uid,connectionId);
  if(latest.status!=='connected'||latest.revision!==attempt.connection_revision)throw new ApiError(409,'connection_changed');
  const thumbnailTicket=typeof result.thumbnailLink==='string'
    ?await sealThumbnailTicket(env,uid,connectionId,latest.revision,data.fileId,result.thumbnailLink):undefined;
  return Response.json({file:{id:result.id,name:result.name,mimeType:result.mimeType,
    size:result.size,webViewLink:result.webViewLink,thumbnailTicket,modifiedTime:result.modifiedTime}});
}

export async function cleanupUploads(env:Env):Promise<void>{
  await env.DB.prepare('DELETE FROM drive_upload_attempts WHERE rowid IN (SELECT rowid FROM drive_upload_attempts WHERE expires_at<=? LIMIT 100)')
    .bind(Date.now()).run();
}

/** Same link/ancestry checks before presenting any browser authorization UI. */
export async function authorizeUploadFolder(env:Env,uid:string,connectionId:string,targetId:string,
  request:Request,fetcher:typeof fetch=fetch):Promise<Response>{
  fetcher=boundedFetch(fetcher);
  validId(targetId);
  const data=await uploadBody(request) as {projectId?:number;linkedFolderId?:string}|null;
  if(!data||!Number.isSafeInteger(data.projectId)||!data.projectId||data.projectId<0||
    typeof data.linkedFolderId!=='string'||!ID.test(data.linkedFolderId))throw new ApiError(400,'invalid_upload');
  const row=await connection(env,uid,connectionId);
  if(row.status!=='connected')throw new ApiError(409,'reconnect_required');
  await linkedFolder(env,uid,request.headers.get('Authorization')?.replace(/^Bearer /,'')||'',
    connectionId,data.projectId,data.linkedFolderId,fetcher);
  try{await destination(env,row,targetId,data.linkedFolderId,fetcher);return Response.json({authorized:true});}
  catch(error){if(!(error instanceof ApiError)||error.code!=='drive_picker_required')throw error;}
  if(!env.GOOGLE_PICKER_API_KEY||!env.GOOGLE_CLIENT_ID)throw new ApiError(503,'picker_not_configured');
  const appId=env.GOOGLE_CLIENT_ID.split('-')[0];
  if(!/^\d+$/.test(appId))throw new ApiError(503,'picker_not_configured');
  return Response.json({authorized:false,clientId:env.GOOGLE_CLIENT_ID,appId,
    developerKey:env.GOOGLE_PICKER_API_KEY,accountId:row.google_account_id});
}
