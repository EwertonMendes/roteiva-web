import {ApiError, type Env} from './types.ts';
import {connection} from './repository.ts';
import {DRIVE_READ_SCOPE, accessCredential} from './google.ts';
import {driveJson} from './drive-client.ts';

const FILE_ID = /^[A-Za-z0-9_-]{10,200}$/;
const IMAGE_TYPES = new Set(['image/jpeg','image/png','image/webp','image/gif','image/avif']);
const MAX_BYTES = 1024 * 1024; // thumbnail only; never proxy original video or full-resolution media

/** Validates the Google-provided, short-lived thumbnail URL before proxying it. */
export function allowedThumbnailUrl(raw: unknown): URL | null {
  if(typeof raw !== 'string' || raw.length > 4096)return null;
  try {
    const url=new URL(raw);
    const host=url.hostname.toLowerCase();
    if(url.protocol!=='https:' || url.username || url.password || url.port ||
       !(host==='googleusercontent.com' || host.endsWith('.googleusercontent.com') ||
         host==='drive.google.com'))return null;
    return url;
  }catch{return null;}
}

/** Private, bounded thumbnail proxy. Never accepts user-supplied URLs or media downloads. */
export async function thumbnail(env:Env,uid:string,connectionId:string,fileId:string,fetcher:typeof fetch=fetch):Promise<Response> {
  if(!FILE_ID.test(fileId))throw new ApiError(400,'invalid_file_id');
  const row=await connection(env,uid,connectionId);
  if(!row.scopes.split(' ').includes(DRIVE_READ_SCOPE))throw new ApiError(409,'drive_read_permission_missing');

  const target=new URL('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(fileId));
  target.searchParams.set('fields','id,mimeType,thumbnailLink,trashed');
  target.searchParams.set('supportsAllDrives','true');
  const info=await driveJson(env,row,target,fetcher,'file_unavailable');
  if(info.trashed===true || info.mimeType==='application/vnd.google-apps.folder')throw new ApiError(404,'thumbnail_unavailable');
  const url=allowedThumbnailUrl(info.thumbnailLink);
  if(!url)throw new ApiError(404,'thumbnail_unavailable');

  // No redirect following: a bearer token must never be forwarded to another host.
  const access=await accessCredential(env,row,fetcher);
  let response:Response;
  try{
    response=await fetcher(url,{method:'GET',redirect:'manual',
      headers:{Authorization:'Bearer '+access.value},signal:AbortSignal.timeout(8000)});
  }catch{throw new ApiError(502,'thumbnail_unavailable');}
  if(response.status!==200){await response.body?.cancel();throw new ApiError(502,'thumbnail_unavailable');}
  const mime=(response.headers.get('Content-Type')||'').split(';')[0].trim().toLowerCase();
  const length=Number(response.headers.get('Content-Length')||'0');
  if(!IMAGE_TYPES.has(mime) || (length>MAX_BYTES && length>0)){
    await response.body?.cancel();throw new ApiError(502,'thumbnail_unavailable');
  }
  const reader=response.body?.getReader();
  if(!reader)throw new ApiError(502,'thumbnail_unavailable');
  const chunks:Uint8Array[]=[];let total=0;
  try{
    while(true){
      const {done,value}=await reader.read();
      if(done)break;
      total+=value.byteLength;
      if(total>MAX_BYTES)throw new ApiError(502,'thumbnail_unavailable');
      chunks.push(value);
    }
  }catch{
    await reader.cancel().catch(()=>{});
    throw new ApiError(502,'thumbnail_unavailable');
  }
  if(total===0)throw new ApiError(404,'thumbnail_unavailable');
  const bytes=new Uint8Array(total);let position=0;
  for(const chunk of chunks){bytes.set(chunk,position);position+=chunk.length;}
  return new Response(bytes,{status:200,headers:{
    'Content-Type':mime,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'
  }});
}
