import {ApiError,type Env} from './types.ts';
import {base64url,decode} from './crypto.ts';
import {libraryFor,libraryNode} from './library-core.ts';
import {libraryContent} from './library-content.ts';
import {readLibrarySource} from './library-assets.ts';
import {apiOrigin} from './environment.ts';

type Video={id:string;readyToStream:boolean;status?:{state:string};preview?:string;hlsPlaybackUrl?:string};
type Asset={provider:'google_drive'|'dropbox';connection_id:string;file_id:string;mime_type:string;source_revision:string|null;size:string|null};
type Row={owner_uid:string;provider:Asset['provider'];connection_id:string;file_id:string;source_revision:string;source_size:string;status:'creating'|'processing'|'ready'|'failed';stream_uid:string|null;playback_origin:string|null;created_at:number;updated_at:number};
type Ticket={u:string;p:number;n:string;r:string;s:string;e:number;k:string};
const encoder=new TextEncoder(),decoder=new TextDecoder();
const nodePattern=/^[0-9a-f-]{36}$/i;
const uidPattern=/^[a-f0-9]{32}$/i;
function supported(env:Env){return env.ENVIRONMENT==='dev'&&env.STREAM_PREVIEW_ENABLED==='true'&&!!env.STREAM;}
function stream(env:Env){if(!supported(env))throw new ApiError(503,'stream_preview_not_configured');return env.STREAM!;}
async function macKey(env:Env,version:string){
 const keys=JSON.parse(env.TOKEN_KEYS||'{}') as Record<string,string>;
 if(!keys[version])throw new ApiError(503,'key_unavailable');
 const bytes=decode(keys[version]);
 if(bytes.byteLength!==32)throw new ApiError(503,'invalid_key');
 return crypto.subtle.importKey('raw',bytes,{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
}
export async function mintStreamIngestTicket(env:Env,body:Omit<Ticket,'k'>):Promise<string>{
 const ticket:Ticket={...body,k:env.TOKEN_KEY_VERSION};
 const data=base64url(encoder.encode(JSON.stringify(ticket)));
 const sig=await crypto.subtle.sign('HMAC',await macKey(env,ticket.k),encoder.encode('roteiva/stream-ingest/v1/'+data));
 return data+'.'+base64url(new Uint8Array(sig));
}
export async function verifyStreamIngestTicket(env:Env,token:string):Promise<Ticket>{
 if(token.length>1100||!/^[-_A-Za-z0-9]+\.[-_A-Za-z0-9]+$/.test(token))throw new ApiError(404,'not_found');
 const [data,signature]=token.split('.');
 let p:Ticket;
 try{p=JSON.parse(decoder.decode(decode(data))) as Ticket;}
 catch{throw new ApiError(404,'not_found');}
 if(!p||typeof p.u!=='string'||p.u.length>160||!nodePattern.test(p.n)||
   !Number.isSafeInteger(p.p)||p.p<1||typeof p.r!=='string'||p.r.length>220||
   !/^\d{1,16}$/.test(p.s)||!Number.isSafeInteger(p.e)||p.e<Date.now()||
   p.e>Date.now()+2*60*60*1000||typeof p.k!=='string')throw new ApiError(404,'not_found');
 const valid=await crypto.subtle.verify('HMAC',await macKey(env,p.k),decode(signature),encoder.encode('roteiva/stream-ingest/v1/'+data));
 if(!valid)throw new ApiError(404,'not_found');
 return p;
}
export function streamPreviewEnabled(env:Env){return supported(env);}
async function assetFor(env:Env,uid:string,projectId:number,nodeId:string){
 const lib=await libraryFor(env,uid,projectId),node=await libraryNode(env,lib,nodeId);
 if(node.kind!=='asset')throw new ApiError(404,'source_unavailable');
 const asset=await env.DB.prepare('SELECT a.provider,a.connection_id,a.file_id,a.mime_type,a.source_revision,a.size FROM library_entries e JOIN library_assets a ON a.library_id=e.library_id AND a.id=e.asset_id WHERE e.library_id=? AND e.node_id=?')
  .bind(lib.id,node.id).first<Asset>();
 if(!asset||!asset.mime_type.startsWith('video/'))throw new ApiError(415,'stream_video_only');
 return asset;
}
function args(uid:string,a:Pick<Asset,'provider'|'connection_id'|'file_id'>,revision:string){
 return [uid,a.provider,a.connection_id,a.file_id,revision] as const;
}
async function stored(env:Env,uid:string,a:Asset,revision:string){
 return env.DB.prepare('SELECT * FROM optimized_media_previews WHERE owner_uid=? AND provider=? AND connection_id=? AND file_id=? AND source_revision=?')
  .bind(...args(uid,a,revision)).first<Row>();
}
function playbackOrigin(video:Video){
 const v=video.preview||video.hlsPlaybackUrl;
 if(!v)throw new ApiError(503,'stream_playback_not_ready');
 const u=new URL(v);
 if(u.protocol!=='https:'||!/^customer-[a-z0-9-]+\.cloudflarestream\.com$/.test(u.hostname))throw new ApiError(503,'stream_playback_unavailable');
 return u.origin;
}
function publicState(status:Row['status']){return status==='creating'||status==='processing'?'processing':status;}
const FAILED_RETRY_DELAY=30*60*1000;
async function state(env:Env,row:Row):Promise<Response>{
 // A failed import must not be billed again on every modal reopening. After
 // cooling down a GET offers one new attempt through the existing atomic POST.
 if(row.status==='failed')return Response.json(
  {state:Date.now()-row.updated_at>=FAILED_RETRY_DELAY?'absent':'unavailable'},
  {headers:{'Cache-Control':'no-store'}});
 if(!row.stream_uid){
  if(row.status==='creating'&&Date.now()-row.created_at>5*60*1000){
   await env.DB.prepare("UPDATE optimized_media_previews SET status='failed',updated_at=? WHERE owner_uid=? AND provider=? AND connection_id=? AND file_id=? AND source_revision=?")
    .bind(Date.now(),...args(row.owner_uid,row,row.source_revision)).run();
   return Response.json({state:'unavailable'},{headers:{'Cache-Control':'no-store'}});
  }
  return Response.json({state:publicState(row.status)},{headers:{'Cache-Control':'no-store'}});
 }
 const handle=stream(env).video(row.stream_uid);
 if(row.status!=='ready'){
  // Avoid repeated Stream metadata calls while the provider is downloading/encoding.
  if(Date.now()-row.updated_at<3500)return Response.json({state:'processing'},{headers:{'Cache-Control':'no-store'}});
  let video:Video;
  try{video=await handle.details();}
  catch{return Response.json({state:'processing'},{headers:{'Cache-Control':'no-store'}});}
  if(video.status?.state==='error'){
   await env.DB.prepare("UPDATE optimized_media_previews SET status='failed',updated_at=? WHERE owner_uid=? AND provider=? AND connection_id=? AND file_id=? AND source_revision=?").bind(Date.now(),...args(row.owner_uid,row,row.source_revision)).run();
   return Response.json({state:'failed'});
  }
  if(!video.readyToStream){
   await env.DB.prepare('UPDATE optimized_media_previews SET updated_at=? WHERE owner_uid=? AND provider=? AND connection_id=? AND file_id=? AND source_revision=?').bind(Date.now(),...args(row.owner_uid,row,row.source_revision)).run();
   return Response.json({state:'processing'},{headers:{'Cache-Control':'no-store'}});
  }
  const origin=playbackOrigin(video);
  await env.DB.prepare("UPDATE optimized_media_previews SET status='ready',playback_origin=?,updated_at=? WHERE owner_uid=? AND provider=? AND connection_id=? AND file_id=? AND source_revision=?")
   .bind(origin,Date.now(),...args(row.owner_uid,row,row.source_revision)).run();
  row={...row,status:'ready',playback_origin:origin};
 }
 if(!row.playback_origin)return Response.json({state:'processing'});
 const token=await handle.generateToken();
 if(!/^[A-Za-z0-9_.-]{40,3000}$/.test(token))throw new ApiError(503,'stream_playback_unavailable');
 return Response.json({state:'ready',embedUrl:row.playback_origin+'/'+encodeURIComponent(token)+'/iframe?autoplay=true&muted=true&preload=auto'},{headers:{'Cache-Control':'private, no-store'}});
}
export async function previewRequest(request:Request,env:Env,uid:string,projectId:number,nodeId:string){
 stream(env);
 if(request.method!=='GET'&&request.method!=='POST')throw new ApiError(405,'method_not_allowed');
 const a=await assetFor(env,uid,projectId,nodeId);
 // The saved revision is the content identity. No additional bytes or token
 // exchange is needed for an already prepared copy.
 if(!a.source_revision||!a.size)throw new ApiError(409,'stream_source_not_versioned');
 let row=await stored(env,uid,a,a.source_revision);
 if(request.method==='GET')return row?state(env,row):Response.json({state:'absent'});
 if(row&&(row.status==='ready'||row.status==='processing'||row.status==='creating'&&Date.now()-row.created_at<5*60*1000||row.status==='failed'&&Date.now()-row.updated_at<FAILED_RETRY_DELAY))return state(env,row);
 // Preparing a new video costs Stream storage/encoding. Only explicit owner POST.
 const meta=await readLibrarySource(env,uid,{provider:a.provider,connectionId:a.connection_id,fileId:a.file_id});
 if(meta.mimeType!==a.mime_type||!meta.revision||!meta.size)throw new ApiError(409,'source_changed');
 const actual={...a,source_revision:meta.revision,size:meta.size};
 row=await stored(env,uid,actual,meta.revision);
 if(row&&(row.status==='ready'||row.status==='processing'||row.status==='creating'&&Date.now()-row.created_at<5*60*1000||row.status==='failed'&&Date.now()-row.updated_at<FAILED_RETRY_DELAY))return state(env,row);
 const now=Date.now();
 if(!row){
  const insert=await env.DB.prepare("INSERT OR IGNORE INTO optimized_media_previews(owner_uid,provider,connection_id,file_id,source_revision,source_size,status,created_at,updated_at) VALUES(?,?,?,?,?,?,'creating',?,?)")
   .bind(...args(uid,actual,meta.revision),meta.size,now,now).run();
  if(insert.meta.changes!==1)return Response.json({state:'processing'});
 }else{
  await env.DB.prepare("UPDATE optimized_media_previews SET status='creating',stream_uid=NULL,playback_origin=NULL,created_at=?,updated_at=? WHERE owner_uid=? AND provider=? AND connection_id=? AND file_id=? AND source_revision=?")
   .bind(now,now,...args(uid,actual,meta.revision)).run();
 }
 try{
  const ticket=await mintStreamIngestTicket(env,{u:uid,p:projectId,n:nodeId,r:meta.revision,s:meta.size,e:Date.now()+90*60*1000});
  const input=apiOrigin(env)+'/stream/ingest/'+ticket;
  const video=await stream(env).upload(input,{
   requireSignedURLs:true,allowedOrigins:[new URL(env.FRONTEND_ORIGIN).hostname],
   meta:{name:meta.name.slice(0,100),source:'roteiva-dev',revision:meta.revision.slice(0,90)}
  });
  if(!uidPattern.test(video.id))throw new ApiError(503,'stream_upload_unavailable');
  await env.DB.prepare("UPDATE optimized_media_previews SET status='processing',stream_uid=?,updated_at=? WHERE owner_uid=? AND provider=? AND connection_id=? AND file_id=? AND source_revision=?")
   .bind(video.id,Date.now(),...args(uid,actual,meta.revision)).run();
  return Response.json({state:'processing'},{status:202});
 }catch(error){
  await env.DB.prepare("UPDATE optimized_media_previews SET status='failed',updated_at=? WHERE owner_uid=? AND provider=? AND connection_id=? AND file_id=? AND source_revision=?")
   .bind(Date.now(),...args(uid,actual,meta.revision)).run();
  // Never send upstream account or API diagnostics to the client.
  const providerCategory=error instanceof Error&&
   ['BadRequestError','QuotaReachedError','MaxFileSizeError','RateLimitedError','AlreadyUploadedError','InternalError'].includes(error.name)
    ?error.name:'provider_unavailable';
  console.warn(JSON.stringify({event:'stream_upload_failed',type:error instanceof ApiError?error.code:providerCategory}));
  throw new ApiError(503,'stream_upload_unavailable');
 }
}
/** Read-only, short-lived private ingestion gateway. The signed URL is only
 * passed server-to-server to Cloudflare Stream, never to the end user's UI.
 * No credentials for Google or Dropbox leave our Worker.
 */
export async function streamIngest(request:Request,env:Env,token:string){
 stream(env);
 if(request.method!=='GET'&&request.method!=='HEAD')throw new ApiError(405,'method_not_allowed');
 const ticket=await verifyStreamIngestTicket(env,token);
 const a=await assetFor(env,ticket.u,ticket.p,ticket.n);
 if(a.source_revision!==ticket.r||a.size!==ticket.s)throw new ApiError(409,'source_changed');
 const media=await libraryContent(request,env,ticket.u,ticket.p,ticket.n);
 if(media.status!==206)return media;
 // Cloudflare Stream can use HEAD to discover the file size and GET with Range.
 // A full GET without Range is a 200 body; a requested Range stays 206.
 if(request.headers.has('Range'))return media;
 const headers=new Headers(media.headers);
 // Stream's URL importer probes HEAD and later downloads a complete GET.
 // Advertising 200 with a partial Content-Range or incorrect Content-Length
 // makes the ingestion fail before adaptive playback can ever start.
 if(headers.get('Content-Length')!==ticket.s){
  await media.body?.cancel();
  throw new ApiError(502,'stream_ingest_length_mismatch');
 }
 headers.delete('Content-Range');
 headers.set('Content-Length',ticket.s);
 return new Response(request.method==='HEAD'?null:media.body,{status:200,headers});
}
