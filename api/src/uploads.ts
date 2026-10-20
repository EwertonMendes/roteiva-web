import { ApiError, type Env } from './types.ts';
import { connection } from './repository.ts';
import { DRIVE_SCOPE, accessCredential } from './google.ts';
import { driveJson } from './drive-client.ts';
import { rejectCachedToken } from './token-store.ts';

const FOLDER = 'application/vnd.google-apps.folder';
const ID = /^[A-Za-z0-9_-]{10,200}$/;
const CONN = /^[A-Za-z0-9-]{36}$/;
const MAX_SIZE = 5_000_000_000_000;
const CHUNK_SIZE = 8 * 1024 * 1024;

type UploadInput = {projectId:number;linkedFolderId:string;name:string;size:number;mimeType?:string};
type GoogleFile = {id?:unknown;name?:unknown;mimeType?:unknown;size?:unknown;parents?:unknown;webViewLink?:unknown};

function validId(value:string):string {
  if (!ID.test(value)) throw new ApiError(400,'invalid_folder_id');
  return value;
}

function input(value:unknown):UploadInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(400,'invalid_upload');
  const data = value as Partial<UploadInput>;
  if (!Number.isSafeInteger(data.projectId) || !data.projectId || data.projectId <= 0 ||
      typeof data.linkedFolderId !== 'string' || !ID.test(data.linkedFolderId) ||
      typeof data.name !== 'string' || !data.name.trim() || data.name.length > 255 ||
      /[\u0000-\u001f\u007f]/.test(data.name) ||
      !Number.isSafeInteger(data.size) || data.size === undefined || data.size < 1 || data.size > MAX_SIZE ||
      (data.mimeType !== undefined && (typeof data.mimeType !== 'string' ||
       data.mimeType.length > 120 || !/^[\x20-\x7e]+$/.test(data.mimeType))))
    throw new ApiError(400,'invalid_upload');
  return {projectId:data.projectId,linkedFolderId:data.linkedFolderId,
    name:data.name,size:data.size,mimeType:data.mimeType || 'application/octet-stream'};
}

async function body(request:Request):Promise<unknown> {
  const size=Number(request.headers.get('Content-Length')||0);
  if (size>8192) throw new ApiError(413,'upload_metadata_too_large');
  const raw=await request.text();
  if (raw.length>8192) throw new ApiError(413,'upload_metadata_too_large');
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
}

async function destination(env:Env,row:Awaited<ReturnType<typeof connection>>,
  targetId:string,rootId:string,fetcher:typeof fetch) {
  // Every descendant must lead to the user-linked root, without trusting the UI breadcrumb.
  let current=targetId;
  const visited=new Set<string>();
  for(let i=0;i<32;i++){
    if(visited.has(current))throw new ApiError(403,'upload_folder_not_linked');
    visited.add(current);
    const url=new URL('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(current));
    url.searchParams.set('fields','id,mimeType,trashed,parents,capabilities(canAddChildren)');
    url.searchParams.set('supportsAllDrives','true');
    const info=await driveJson(env,row,url,fetcher,'drive_folder_not_found');
    if(info.mimeType!==FOLDER || info.trashed===true)throw new ApiError(404,'drive_folder_not_found');
    if(current===rootId){
      if(targetId===rootId && (info.capabilities as {canAddChildren?:boolean}|undefined)?.canAddChildren===false)
        throw new ApiError(403,'drive_upload_permission_missing');
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
     !url.pathname.startsWith('/upload/drive/v3/files') || !url.searchParams.has('upload_id'))
    throw new ApiError(502,'upload_session_invalid');
  return url.href;
}

/** Only metadata travels through the Worker. The browser PUTs bytes to this Google session. */
export async function startUpload(env:Env,uid:string,connectionId:string,targetId:string,
  request:Request,fetcher:typeof fetch=fetch):Promise<Response> {
  validId(targetId);
  const data=input(await body(request));
  const firebaseToken=request.headers.get('Authorization')?.replace(/^Bearer /,'')||'';
  await linkedFolder(env,uid,firebaseToken,connectionId,data.projectId,data.linkedFolderId,fetcher);
  const row=await connection(env,uid,connectionId);
  if(row.status!=='connected')throw new ApiError(409,'reconnect_required');
  if(!row.scopes.split(/\s+/).includes(DRIVE_SCOPE))throw new ApiError(409,'drive_upload_permission_missing');
  await destination(env,row,targetId,data.linkedFolderId,fetcher);
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
    },body:JSON.stringify({name:data.name,mimeType:data.mimeType,parents:[targetId]}),
    signal:AbortSignal.timeout(12000)});
  }catch{throw new ApiError(502,'drive_upload_transport_failed');}
  if(response.status===401){
    await response.body?.cancel();
    await rejectCachedToken(env,row,token.version);
    throw new ApiError(409,'reconnect_required');
  }
  if(response.status===403)throw new ApiError(403,'drive_upload_permission_missing');
  if(response.status===429)throw new ApiError(429,'drive_rate_limited');
  if(response.status!==200 && response.status!==201)throw new ApiError(502,'drive_upload_unavailable');
  const sessionUrl=uploadLocation(response.headers.get('Location'));
  // Capability URL: browser memory only; no HTTP caching, Firestore, D1 or logs.
  return Response.json({sessionUrl,chunkSize:CHUNK_SIZE},{headers:{'Cache-Control':'no-store'}});
}

/** Independently verify Drive's final file before updating local UI/cache. */
export async function completeUpload(env:Env,uid:string,connectionId:string,targetId:string,
  request:Request,fetcher:typeof fetch=fetch):Promise<Response> {
  validId(targetId);
  const payload=await body(request);
  const data=payload as {projectId?:number;linkedFolderId?:string;fileId?:string;size?:number}|null;
  if(!data || !Number.isSafeInteger(data.projectId) || !data.projectId ||
     typeof data.linkedFolderId!=='string'||!ID.test(data.linkedFolderId)||
     typeof data.fileId!=='string'||!ID.test(data.fileId)||
     !Number.isSafeInteger(data.size)||data.size===undefined||data.size<1)
    throw new ApiError(400,'invalid_upload');
  const firebaseToken=request.headers.get('Authorization')?.replace(/^Bearer /,'')||'';
  await linkedFolder(env,uid,firebaseToken,connectionId,data.projectId!,data.linkedFolderId,fetcher);
  const row=await connection(env,uid,connectionId);
  await destination(env,row,targetId,data.linkedFolderId,fetcher);
  const url=new URL('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(data.fileId));
  url.searchParams.set('fields','id,name,mimeType,size,parents,trashed,webViewLink');
  url.searchParams.set('supportsAllDrives','true');
  const result=await driveJson(env,row,url,fetcher,'drive_upload_not_confirmed') as GoogleFile & {trashed?:boolean};
  if(result.id!==data.fileId || !Array.isArray(result.parents) ||
     !result.parents.includes(targetId) || result.trashed===true ||
     result.size!==String(data.size))throw new ApiError(409,'drive_upload_not_confirmed');
  return Response.json({file:{id:result.id,name:result.name,mimeType:result.mimeType,
    size:result.size,webViewLink:result.webViewLink}});
}
