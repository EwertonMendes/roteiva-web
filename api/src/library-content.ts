import {ApiError,type Env} from './types.ts';
import {libraryFor,libraryNode} from './library-core.ts';
import {readLibrarySource} from './library-assets.ts';
import {connection} from './repository.ts';
import {accessCredential} from './google.ts';
import {dropboxConnection,dropboxAccess} from './dropbox.ts';
import {sourceRange} from './library-source.ts';
import {driveResourceHeaders} from './drive-resource-keys.ts';
type Asset={id:string;provider:'google_drive'|'dropbox';connection_id:string;file_id:string;mime_type:string};
/** Identity/project are verified by the router; the reference and origin are checked on every read. */
export async function libraryContent(request:Request,env:Env,uid:string,projectId:number,nodeId:string,fetcher:typeof fetch=fetch){
 const observationStarted=Date.now();
 const lib=await libraryFor(env,uid,projectId),node=await libraryNode(env,lib,nodeId);
 if(node.kind!=='asset')throw new ApiError(404,'source_unavailable');
 const asset=await env.DB.prepare('SELECT a.* FROM library_entries e JOIN library_assets a ON a.library_id=e.library_id AND a.id=e.asset_id WHERE e.library_id=? AND e.node_id=?').bind(lib.id,node.id).first<Asset>();
 if(!asset)throw new ApiError(404,'source_unavailable');
 let source;
 try{source=await readLibrarySource(env,uid,{provider:asset.provider,connectionId:asset.connection_id,fileId:asset.file_id},fetcher);}
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
 const range=full?'bytes=0-'+(Number(source.size)-1):sourceRange(request.headers.get('Range'),source.size);
 let upstream:Response;
 if(asset.provider==='google_drive'){
 const row=await connection(env,uid,asset.connection_id),credential=await accessCredential(env,row,fetcher);
 upstream=await fetcher('https://www.googleapis.com/drive/v3/files/'+asset.file_id+'?alt=media&supportsAllDrives=true',{
 method:'GET',headers:{Authorization:'Bearer '+credential.value,...driveResourceHeaders(asset.file_id,source.resourceKey),Range:range},redirect:'manual',signal:AbortSignal.timeout(24000)});
 }else{
 const row=await dropboxConnection(env,uid,asset.connection_id),credential=await dropboxAccess(env,row,fetcher);
 upstream=await fetcher('https://content.dropboxapi.com/2/files/download',{
 method:'POST',headers:{Authorization:'Bearer '+credential,'Dropbox-API-Arg':JSON.stringify({path:asset.file_id}),Range:range},redirect:'manual',signal:AbortSignal.timeout(24000)});
 }
 if(!upstream.ok){await upstream.body?.cancel();throw new ApiError(upstream.status===429?429:502,upstream.status===429?'provider_rate_limited':'source_unavailable');}
 const match=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(upstream.headers.get('Content-Range')||'');
 if(upstream.status!==206||!match||'bytes='+match[1]+'-'+match[2]!==range||match[3]!==source.size){await upstream.body?.cancel();throw new ApiError(502,'media_range_unsupported');}
 try{
 await libraryNode(env,lib,nodeId); // revoke a reference removed while origin I/O was in progress
 const current=asset.provider==='google_drive'?await connection(env,uid,asset.connection_id):await dropboxConnection(env,uid,asset.connection_id);
 if(current.status!=='connected')throw new ApiError(409,'reconnect_required');
 }catch(error){await upstream.body?.cancel();throw error;}
 await env.DB.prepare("UPDATE library_assets SET source_name=?,mime_type=?,size=?,source_revision=?,state='available',observed_at=? WHERE library_id=? AND id=? AND observed_at<=?")
 .bind(source.name,source.mimeType,source.size,source.revision,observationStarted,lib.id,asset.id,observationStarted).run();
 const headers=new Headers({'Content-Type':source.mimeType,'Accept-Ranges':'bytes',
 'Content-Length':String(Number(match[2])-Number(match[1])+1),'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
 'Access-Control-Expose-Headers':'Content-Length, Content-Range, Accept-Ranges'});
 if(!full)headers.set('Content-Range',upstream.headers.get('Content-Range')!);
 if(source.mimeType==='image/svg+xml')headers.set('Content-Security-Policy',"sandbox; default-src 'none'");
 if(request.method==='HEAD'){await upstream.body?.cancel();return new Response(null,{status:full?200:206,headers});}
 const expected=Number(match[2])-Number(match[1])+1;let received=0;
 const body=upstream.body?.pipeThrough(new TransformStream<Uint8Array,Uint8Array>({
 transform(chunk,controller){received+=chunk.byteLength;if(received>expected){controller.error(new Error('source_size_changed'));return;}controller.enqueue(chunk);},
 flush(controller){if(received!==expected)controller.error(new Error('source_size_changed'));}
 }));
 return new Response(body,{status:full?200:206,headers});
}
