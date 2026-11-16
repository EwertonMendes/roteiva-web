import {ApiError,type Env} from './types.ts';
import {libraryFor,libraryNode} from './library-core.ts';
import {readLibrarySource} from './library-assets.ts';
import {connection} from './repository.ts';
import {accessCredential} from './google.ts';
import {dropboxConnection,dropboxAccess} from './dropbox.ts';
import {sourceRange,playbackRange} from './library-source.ts';
import {streamHeaders} from './media-fetch.ts';
import {driveResourceHeaders,storedDriveResourceKey} from './drive-resource-keys.ts';
type Asset={id:string;provider:'google_drive'|'dropbox';connection_id:string;file_id:string;mime_type:string;source_name:string;size:string|null;source_revision:string|null;observed_at:number;state:string};
// The original provider remains authoritative for bytes and revocation. Reuse
// recently verified metadata only for adjacent player/PDF range requests.
const MEDIA_METADATA_FRESH_MS=90000;
/** Identity/project are verified by the router; the reference and origin are checked on every read. */
export async function libraryContent(request:Request,env:Env,uid:string,projectId:number,nodeId:string,fetcher:typeof fetch=fetch){
 const observationStarted=Date.now();
 const lib=await libraryFor(env,uid,projectId);
 // Two independent D1 reads may resolve together. Neither may bypass the
 // existing ancestor/state authorization before bytes are returned.
 const [node,asset]=await Promise.all([
  libraryNode(env,lib,nodeId),
  env.DB.prepare('SELECT a.* FROM library_entries e JOIN library_assets a ON a.library_id=e.library_id AND a.id=e.asset_id WHERE e.library_id=? AND e.node_id=?').bind(lib.id,nodeId).first<Asset>()
 ]);
 if(node.kind!=='asset')throw new ApiError(404,'source_unavailable');
 if(!asset)throw new ApiError(404,'source_unavailable');
 // A recently verified image observation is reusable for the first image
 // request, not just for Range requests. The provider remains authoritative
 // for its bytes and revocation; an old observation is never authoritative.
 const recentImage=!request.headers.has('Range')&&request.method==='GET'&&asset.mime_type.startsWith('image/');
 const reuse=(!!request.headers.get('Range')||recentImage)&&asset.state==='available'&&
  typeof asset.size==='string'&&asset.size.length>0&&typeof asset.source_name==='string'&&
  Number.isFinite(asset.observed_at)&&observationStarted>=asset.observed_at&&
  observationStarted-asset.observed_at<MEDIA_METADATA_FRESH_MS;
 const startMetadata=performance.now();
 let source;
 try{source=reuse?
  {name:asset.source_name,mimeType:asset.mime_type,size:asset.size,revision:asset.source_revision,
   resourceKey:asset.provider==='google_drive'?await storedDriveResourceKey(env,uid,asset.connection_id,asset.file_id):undefined}:
  await readLibrarySource(env,uid,{provider:asset.provider,connectionId:asset.connection_id,fileId:asset.file_id},fetcher);}
 catch(error){
 if(error instanceof ApiError){
 const state=error.code==='source_trashed'?'source_trashed':error.status===403?'restricted':error.status===404?'unavailable':null;
 if(state)await env.DB.prepare('UPDATE library_assets SET state=?,observed_at=? WHERE library_id=? AND id=? AND observed_at<=?').bind(state,observationStarted,lib.id,asset.id,observationStarted).run();
 }throw error;
 }
 if(!source.size||!/^(image\/(jpeg|png|webp|avif|gif|bmp|tiff|svg\+xml)|video\/(mp4|webm|quicktime|x-m4v|x-matroska)|audio\/(mpeg|wav|ogg|flac|mp4|aac)|application\/pdf)$/.test(source.mimeType))throw new ApiError(415,'library_preview_unsupported');
 sourceRange(null,source.size); // validate provider size even for a full PDF/image stream
 const full=!request.headers.has('Range')&&(source.mimeType.startsWith('image/')||source.mimeType==='application/pdf');
 if(full&&Number(source.size)>(source.mimeType.startsWith('image/')?24:64)*1024*1024)throw new ApiError(413,'library_preview_too_large');
 const range=full?'bytes=0-'+(Number(source.size)-1):
    /^(video|audio)\//.test(source.mimeType)?playbackRange(request.headers.get('Range'),source.size):sourceRange(request.headers.get('Range'),source.size);
 const metadataMs=Math.round(performance.now()-startMetadata);
 const startOrigin=performance.now();
 let readRange:(requested:string,signal?:AbortSignal)=>Promise<Response>;
 if(asset.provider==='google_drive'){
 const row=await connection(env,uid,asset.connection_id),credential=await accessCredential(env,row,fetcher);
 readRange=(requested,signal)=>streamHeaders(fetcher,'https://www.googleapis.com/drive/v3/files/'+asset.file_id+'?alt=media&supportsAllDrives=true',{
 method:'GET',headers:{Authorization:'Bearer '+credential.value,...driveResourceHeaders(asset.file_id,source.resourceKey),Range:requested},redirect:'manual',signal});
 }else{
 const row=await dropboxConnection(env,uid,asset.connection_id),credential=await dropboxAccess(env,row,fetcher);
 readRange=(requested,signal)=>streamHeaders(fetcher,'https://content.dropboxapi.com/2/files/download',{
 method:'POST',headers:{Authorization:'Bearer '+credential,'Dropbox-API-Arg':JSON.stringify({path:asset.file_id}),Range:requested},redirect:'manual',signal});
 }
 // A single provider range is handed to the runtime as an opaque stream.
 // NEVER read, re-chunk or transform native media bytes in JavaScript:
 // the free-tier CPU budget is cumulative over the entire streaming response.
 const upstream=await readRange(range,request.signal);
 if(!upstream.ok){await upstream.body?.cancel();throw new ApiError(upstream.status===429?429:502,upstream.status===429?'provider_rate_limited':'source_unavailable');}
 const originMs=Math.round(performance.now()-startOrigin);
 if(metadataMs+originMs>750)console.info(JSON.stringify({event:'media_origin_timing',kind:'library',provider:asset.provider,
  metadataMs,originMs,reusedMetadata:reuse}));
 const match=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(upstream.headers.get('Content-Range')||'');
 const matchingPartial=upstream.status===206&&!!match&&'bytes='+match[1]+'-'+match[2]===range&&match[3]===source.size&&
   (!upstream.headers.has('Content-Length')||upstream.headers.get('Content-Length')===String(Number(match[2])-Number(match[1])+1));
 // Some providers answer a complete download with 200 despite our
 // upstream bytes=0-EOF request. Accept it only if no Range was requested
 // by the browser and the source's expected total size is verified.
 const wholeObject=full||(!request.headers.has('Range')&&/^(video|audio)\//.test(source.mimeType));
 const matchingFull=wholeObject&&upstream.status===200&&
   (!upstream.headers.has('Content-Length')||upstream.headers.get('Content-Length')===source.size);
 if(!matchingPartial&&!matchingFull){await upstream.body?.cancel();throw new ApiError(502,'media_range_unsupported');}
 // The node and provider connection were already checked on this request.
 // Do not repeat two D1 round trips after receiving each media chunk's headers.
 if(!reuse)await env.DB.prepare("UPDATE library_assets SET source_name=?,mime_type=?,size=?,source_revision=?,state='available',observed_at=? WHERE library_id=? AND id=? AND observed_at<=?")
 .bind(source.name,source.mimeType,source.size,source.revision,observationStarted,lib.id,asset.id,observationStarted).run();
 const headers=new Headers({'Content-Type':source.mimeType,'Accept-Ranges':'bytes',
 'Content-Length':String(matchingFull?Number(source.size):Number(match![2])-Number(match![1])+1),'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
 'Access-Control-Expose-Headers':'Content-Length, Content-Range, Accept-Ranges, X-Roteiva-Media-Transport, X-Roteiva-Metadata-Ms, X-Roteiva-Origin-Headers-Ms'});
 if(!full&&!matchingFull)headers.set('Content-Range',upstream.headers.get('Content-Range')!);
 if(source.mimeType==='image/svg+xml')headers.set('Content-Security-Policy',"sandbox; default-src 'none'");
 if(env.ENVIRONMENT==='dev'){
  headers.set('X-Roteiva-Metadata-Ms',String(metadataMs));
  headers.set('X-Roteiva-Origin-Headers-Ms',String(originMs));
 }
 if(request.method==='HEAD'){await upstream.body?.cancel();return new Response(null,{status:full||matchingFull?200:206,headers});}
 const trustedImageLength=source.mimeType.startsWith('image/')&&upstream.headers.has('Content-Length')&&
  upstream.headers.get('Content-Length')===headers.get('Content-Length');
 if(/^(video|audio)\//.test(source.mimeType)||trustedImageLength){
  // Forward verified origin streams as-is. Video remains unchanged. Small
  // full-image responses with a matching declared length can progressively
  // decode in <img> without exhausting the free-tier CPU budget per chunk.
  headers.set('X-Roteiva-Media-Transport','origin-pass-through');
  if(env.ENVIRONMENT==='dev')console.info(JSON.stringify({
   event:'media_proxy_headers',provider:asset.provider,
   kind:source.mimeType.startsWith('video/')?'video':source.mimeType.startsWith('audio/')?'audio':'image',
   status:matchingFull?200:206,metadataMs,originMs,
   bytes:Number(headers.get('Content-Length')),mode:'pass_through'
  }));
  return new Response(upstream.body,{status:matchingFull?200:206,headers});
 }
 // Bounded images/PDF retain the pre-existing body length verification.
 const expected=matchingFull?Number(source.size):Number(match![2])-Number(match![1])+1;let received=0;
 const body=upstream.body?.pipeThrough(new TransformStream<Uint8Array,Uint8Array>({
 transform(chunk,controller){received+=chunk.byteLength;if(received>expected){controller.error(new Error('source_size_changed'));return;}controller.enqueue(chunk);},
 flush(controller){if(received!==expected)controller.error(new Error('source_size_changed'));}
 }));
 return new Response(body,{status:full||matchingFull?200:206,headers});
}
