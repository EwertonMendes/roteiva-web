import {sealThumbnailTicket} from './thumbnails.ts';
import {ApiError,type Env} from './types.ts';
import {connection} from './repository.ts';
import {DRIVE_READ_SCOPE,accessCredential} from './google.ts';
import {driveJson} from './drive-client.ts';

export const COVER_TYPES=['image/jpeg','image/png','image/webp','image/avif'];
export const MAX_COVER_BYTES=8*1024*1024;
const ID=/^[A-Za-z0-9_-]{10,200}$/;
async function authorized(env:Env,uid:string,id:string){
 const row=await connection(env,uid,id);
 if(row.status!=='connected')throw new ApiError(409,'reconnect_required');
 if(!row.scopes.split(' ').includes(DRIVE_READ_SCOPE))throw new ApiError(409,'drive_read_permission_missing');
 return row;
}
/** Bounded, paginated image search using the account's existing read grant. */
export async function listCoverImages(env:Env,uid:string,id:string,params:URLSearchParams,fetcher:typeof fetch=fetch){
 const row=await authorized(env,uid,id);
 const term=(params.get('search')||'').trim(),page=params.get('pageToken')||'';
 if(term.length>100||/[\x00-\x1f\x7f]/.test(term)||page.length>2048||/[\x00-\x20\x7f]/.test(page))throw new ApiError(400,'invalid_search');
 const quote=(v:string)=>v.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
 const url=new URL('https://www.googleapis.com/drive/v3/files');
 url.searchParams.set('q',`trashed = false and (${COVER_TYPES.map(t=>`mimeType = '${t}'`).join(' or ')})`+(term?` and name contains '${quote(term)}'`:''));
 url.searchParams.set('fields','nextPageToken,incompleteSearch,files(id,name,mimeType,size,thumbnailLink)');
 url.searchParams.set('pageSize','40');url.searchParams.set('orderBy','modifiedTime desc');
 url.searchParams.set('supportsAllDrives','true');url.searchParams.set('includeItemsFromAllDrives','true');
 if(page)url.searchParams.set('pageToken',page);
 const data=await driveJson(env,row,url,fetcher,'drive_unavailable');
 if(!Array.isArray(data.files))throw new ApiError(502,'invalid_google_response');
 const files=await Promise.all(data.files.filter((f:Record<string,unknown>)=>typeof f.id==='string'&&ID.test(f.id)&&COVER_TYPES.includes(String(f.mimeType))&&Number(f.size)>0&&Number(f.size)<=MAX_COVER_BYTES)
 .map(async(f:Record<string,unknown>)=>({id:f.id,name:String(f.name).slice(0,250),mimeType:f.mimeType,thumbnailTicket:await sealThumbnailTicket(env,uid,id,row.revision,String(f.id),f.thumbnailLink)})));
 return Response.json({files,nextPageToken:typeof data.nextPageToken==='string'?data.nextPageToken:null,incompleteSearch:data.incompleteSearch===true});
}
/** Private original image. No arbitrary URL, redirect, public grant or durable media token. */
export async function coverImage(env:Env,uid:string,id:string,fileId:string,fetcher:typeof fetch=fetch){
 if(!ID.test(fileId))throw new ApiError(400,'invalid_file_id');
 const row=await authorized(env,uid,id);
 const target=new URL('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(fileId));
 target.searchParams.set('fields','id,mimeType,size,trashed,imageMediaMetadata(width,height)');target.searchParams.set('supportsAllDrives','true');
 const info=await driveJson(env,row,target,fetcher,'file_unavailable');
 const size=Number(info.size),dimensions=info.imageMediaMetadata as {width?:number;height?:number}|undefined;
 if(info.trashed||!COVER_TYPES.includes(String(info.mimeType))||!Number.isSafeInteger(size)||size<=0||size>MAX_COVER_BYTES||
 (dimensions?.width&&dimensions.height&&dimensions.width*dimensions.height>40_000_000))throw new ApiError(400,'invalid_cover_image');
 const token=await accessCredential(env,row,fetcher);
 target.search='';target.searchParams.set('alt','media');target.searchParams.set('supportsAllDrives','true');
 const response=await fetcher(target,{headers:{Authorization:'Bearer '+token.value},redirect:'manual',signal:AbortSignal.timeout(15000)});
 if(!response.ok||response.status!==200||response.headers.get('Content-Type')?.split(';')[0]!==info.mimeType){await response.body?.cancel();throw new ApiError(502,'cover_unavailable');}
 const reader=response.body?.getReader();if(!reader)throw new ApiError(502,'cover_unavailable');
 const bytes=new Uint8Array(size);let received=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;received+=value.byteLength;if(received>size||received>MAX_COVER_BYTES)throw new ApiError(502,'cover_unavailable');bytes.set(value,received-value.byteLength);}}
 catch(e){await reader.cancel();throw e;}
 if(received!==size)throw new ApiError(502,'cover_unavailable');
 // Recheck the connection after download so a concurrent disconnect cannot release bytes.
 const latest=await authorized(env,uid,id);if(latest.revision!==row.revision)throw new ApiError(409,'connection_changed');
 return new Response(bytes,{headers:{'Content-Type':String(info.mimeType),'Content-Length':String(received),'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
}
