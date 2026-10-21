import {streamBoundedThumbnail} from './thumbnail-stream.ts';
import {ApiError,type Env} from './types.ts';
import {connection} from './repository.ts';
import {DRIVE_READ_SCOPE,accessCredential} from './google.ts';
import {driveJson} from './drive-client.ts';
import {encrypt,decrypt,base64url,decode} from './crypto.ts';

const FILE_ID=/^[A-Za-z0-9_-]{10,200}$/;
const IMAGE_TYPES=new Set(['image/jpeg','image/png','image/webp','image/gif','image/avif']);
const MAX_BYTES=1024*1024;
const TICKET_TTL_MS=90_000;
const encoder=new TextEncoder();
const decoder=new TextDecoder();

export function allowedThumbnailUrl(raw:unknown):URL|null {
  if(typeof raw!=='string'||raw.length>4096)return null;
  try{
    const url=new URL(raw);
    const host=url.hostname.toLowerCase();
    if(url.protocol!=='https:'||url.username||url.password||url.port||
      !(host==='googleusercontent.com'||host.endsWith('.googleusercontent.com')||host==='drive.google.com'))return null;
    return url;
  }catch{return null;}
}

function ticketContext(env:Env,uid:string,connectionId:string){
  // Distinct AAD from OAuth credentials. AES-GCM integrity covers the URL and expiry.
  return JSON.stringify(['roteiva',env.ENVIRONMENT,'drive-thumbnail-v1',uid,connectionId]);
}
export async function sealThumbnailTicket(env:Env,uid:string,connectionId:string,revision:number,
  fileId:string,rawUrl:unknown):Promise<string|undefined>{
  if(!FILE_ID.test(fileId)||!allowedThumbnailUrl(rawUrl))return undefined;
  const payload={fileId,url:rawUrl,revision,expiry:Date.now()+TICKET_TTL_MS};
  const sealed=await encrypt(env,JSON.stringify(payload),ticketContext(env,uid,connectionId));
  return base64url(encoder.encode(sealed));
}
async function resolveTicket(env:Env,uid:string,connectionId:string,revision:number,fileId:string,ticket:string){
  if(ticket.length>8000||!/^[A-Za-z0-9_-]+$/.test(ticket))throw new ApiError(400,'invalid_thumbnail_ticket');
  try{
    const sealed=decoder.decode(decode(ticket));
    const payload=JSON.parse(await decrypt(env,sealed,ticketContext(env,uid,connectionId))) as
      {fileId?:unknown;url?:unknown;revision?:unknown;expiry?:unknown};
    if(payload.fileId!==fileId||payload.revision!==revision)throw new ApiError(403,'thumbnail_ticket_denied');
    if(typeof payload.expiry!=='number'||!Number.isFinite(payload.expiry)||payload.expiry<Date.now()||
      payload.expiry>Date.now()+TICKET_TTL_MS+5000)throw new ApiError(410,'thumbnail_ticket_expired');
    const url=allowedThumbnailUrl(payload.url);
    if(!url)throw new ApiError(400,'invalid_thumbnail_ticket');
    return url;
  }catch(e){
    if(e instanceof ApiError)throw e;
    throw new ApiError(400,'invalid_thumbnail_ticket');
  }
}

/** Bounded private thumbnail proxy. A sealed ticket reuses Drive metadata from files.list. */
export async function thumbnail(env:Env,uid:string,connectionId:string,fileId:string,
  ticket?:string|null,fetcher:typeof fetch=fetch):Promise<Response>{
  if(!FILE_ID.test(fileId))throw new ApiError(400,'invalid_file_id');
  const started=Date.now();
  const row=await connection(env,uid,connectionId);
  if(row.status!=='connected')throw new ApiError(409,'reconnect_required');
  if(!row.scopes.split(' ').includes(DRIVE_READ_SCOPE))throw new ApiError(409,'drive_read_permission_missing');

  let url:URL;
  if(ticket){
    url=await resolveTicket(env,uid,connectionId,row.revision,fileId,ticket);
  }else{
    // Backward-compatible slow fallback when a list has no ticket or a ticket has expired.
    const target=new URL('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(fileId));
    target.searchParams.set('fields','id,mimeType,thumbnailLink,trashed');
    target.searchParams.set('supportsAllDrives','true');
    const info=await driveJson(env,row,target,fetcher,'file_unavailable');
    if(info.trashed===true||info.mimeType==='application/vnd.google-apps.folder')throw new ApiError(404,'thumbnail_unavailable');
    const found=allowedThumbnailUrl(info.thumbnailLink);
    if(!found)throw new ApiError(404,'thumbnail_unavailable');
    url=found;
  }

  // Never redirect with bearer tokens, and never download original videos or file bytes.
  const access=await accessCredential(env,row,fetcher);
  let response:Response;
  try{
    response=await fetcher(url,{method:'GET',redirect:'manual',
      headers:{Authorization:'Bearer '+access.value},signal:AbortSignal.timeout(8000)});
  }catch{throw new ApiError(502,'thumbnail_unavailable');}
  if(response.status!==200){await response.body?.cancel();throw new ApiError(502,'thumbnail_unavailable');}
  const mime=(response.headers.get('Content-Type')||'').split(';')[0].trim().toLowerCase();
  const length=Number(response.headers.get('Content-Length')||'0');
  if(!IMAGE_TYPES.has(mime)||(length>MAX_BYTES&&length>0)){
    await response.body?.cancel();throw new ApiError(502,'thumbnail_unavailable');
  }
  const streamed=streamBoundedThumbnail(response,mime,MAX_BYTES,bytes=>{
    console.info(JSON.stringify({event:'drive_thumbnail',durationMs:Date.now()-started,
      mode:ticket?'ticket':'fallback',bytes,delivery:'stream'}));
  });
  if(streamed)return streamed;
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
  console.info(JSON.stringify({event:'drive_thumbnail',durationMs:Date.now()-started,mode:ticket?'ticket':'fallback',bytes:total,delivery:'buffer'}));
  return new Response(bytes,{status:200,headers:{
    'Content-Type':mime,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'
  }});
}
