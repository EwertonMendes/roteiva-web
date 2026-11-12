import {ApiError,type Env} from './types.ts';
import {readLibrarySource} from './library-assets.ts';
import {revisionEndpoint,sourceRange,type SourceVersion} from './library-source.ts';
import {connection} from './repository.ts';
import {accessCredential} from './google.ts';
import {dropboxConnection,dropboxAccess} from './dropbox.ts';
export type PublishedSource={provider:'google_drive'|'dropbox';connection_id:string;file_id:string;mime_type:string;source_revision?:string|null;source_size?:string|null};
/** Current availability is checked, but bytes always come from the published revision. */
export async function readPublishedSource(request:Request,env:Env,uid:string,asset:PublishedSource,probe=false,fetcher:typeof fetch=fetch):Promise<Response>{
 if(!asset.source_revision||!asset.source_size)throw new ApiError(409,'review_source_version_unsupported');
 await readLibrarySource(env,uid,{provider:asset.provider,connectionId:asset.connection_id,fileId:asset.file_id},fetcher);
 const source:SourceVersion={provider:asset.provider,fileId:asset.file_id,revision:asset.source_revision,size:asset.source_size,mimeType:asset.mime_type};
 const target=revisionEndpoint(source);sourceRange(null,source.size);
 const full=!probe&&!request.headers.has('Range')&&(source.mimeType.startsWith('image/')||source.mimeType==='application/pdf');
 if(full&&Number(source.size)>(source.mimeType.startsWith('image/')?24:64)*1024*1024)throw new ApiError(413,'library_preview_too_large');
 const range=probe?'bytes=0-0':full?'bytes=0-'+(Number(source.size)-1):sourceRange(request.headers.get('Range'),source.size);
 const token=source.provider==='google_drive'?(await accessCredential(env,await connection(env,uid,asset.connection_id),fetcher)).value:
 await dropboxAccess(env,await dropboxConnection(env,uid,asset.connection_id),fetcher);
 let response:Response;
 try{response=await fetcher(target.url,{method:target.method,headers:{...target.headers,Authorization:'Bearer '+token,Range:range},redirect:'manual',signal:AbortSignal.timeout(24000)});}
 catch{throw new ApiError(503,'provider_temporary_failure');}
 if(!response.ok){await response.body?.cancel();throw new ApiError(response.status===429?429:response.status===404?409:503,response.status===429?'provider_rate_limited':response.status===404?'review_source_revision_unavailable':'provider_temporary_failure');}
 const match=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('Content-Range')||'');
 if(response.status!==206||!match||'bytes='+match[1]+'-'+match[2]!==range||match[3]!==source.size){await response.body?.cancel();throw new ApiError(502,'media_range_unsupported');}
 if(probe){await response.body?.cancel();return new Response(null,{status:204});}
 const expected=Number(match[2])-Number(match[1])+1;let received=0;
 const headers=new Headers({'Content-Type':asset.mime_type,'Content-Length':String(expected),'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Accept-Ranges':'bytes','Access-Control-Expose-Headers':'Content-Length, Content-Range, Accept-Ranges'});
 if(!full)headers.set('Content-Range',response.headers.get('Content-Range')!);
 if(request.method==='HEAD'){await response.body?.cancel();return new Response(null,{status:full?200:206,headers});}
 const body=response.body?.pipeThrough(new TransformStream<Uint8Array,Uint8Array>({transform(chunk,c){received+=chunk.byteLength;if(received>expected){c.error(new Error('source_size_changed'));return;}c.enqueue(chunk);},flush(c){if(received!==expected)c.error(new Error('source_size_changed'));}}));
 if(asset.mime_type==='image/svg+xml')headers.set('Content-Security-Policy',"sandbox; default-src 'none'");
 return new Response(body,{status:full?200:206,headers});
}
