import {sealThumbnailTicket} from './thumbnails.ts';
import {ApiError,type Env} from './types.ts';
import {connection} from './repository.ts';
import {DRIVE_READ_SCOPE,accessCredential} from './google.ts';
import {driveJson} from './drive-client.ts';
import {dropboxConnection,dropboxMetadata,dropboxMedia} from './dropbox.ts';
import {validStorageFileId} from './storage.ts';

export const COVER_TYPES=['image/jpeg','image/png','image/webp','image/avif'];
export const MAX_COVER_BYTES=8*1024*1024;
const ID=/^[A-Za-z0-9_-]{10,200}$/;
async function authorized(env:Env,uid:string,id:string){
 const row=await connection(env,uid,id);
 if(row.status!=='connected')throw new ApiError(409,'reconnect_required');
 if(!row.scopes.split(' ').includes(DRIVE_READ_SCOPE))throw new ApiError(409,'drive_read_permission_missing');
 return row;
}
/** Paginated image/folder browsing using the account's existing read grant.
 * Keep filtering on the server; never expose arbitrary Drive metadata or files
 * outside the permitted image types. Child folders are shown at the current level.
 * Search can match names across accessible Drive content.
 */
export async function listCoverImages(env:Env,uid:string,id:string,params:URLSearchParams,fetcher:typeof fetch=fetch){
 const row=await authorized(env,uid,id);
 const term=(params.get('search')||'').trim();
 const page=params.get('pageToken')||'';
 const parent=params.get('parentId')||'root';
 if(term.length>100||/[\x00-\x1f\x7f]/.test(term)||
    page.length>2048||/[\x00-\x20\x7f]/.test(page)||
    (parent!=='root'&&!ID.test(parent)))throw new ApiError(400,'invalid_search');
 const quote=(v:string)=>v.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
 const allowed=`(mimeType = 'application/vnd.google-apps.folder' or ${COVER_TYPES.map(t=>`mimeType = '${t}'`).join(' or ')})`;
 const query=[`trashed = false`,allowed];
 if(term)query.push(`name contains '${quote(term)}'`);
 else query.push(`'${parent}' in parents`);
 const files:Record<string,unknown>[]=[];
 let nextPageToken:string|null=page||null,incompleteSearch=false;
 // A Drive page can consist solely of oversized images. Try a bounded number
 // of pages for useful entries, while preserving an explicit continuation token.
 for(let attempt=0;attempt<3;attempt++){
  const url=new URL('https://www.googleapis.com/drive/v3/files');
  url.searchParams.set('q',query.join(' and '));
  url.searchParams.set('fields','nextPageToken,incompleteSearch,files(id,name,mimeType,size,modifiedTime,thumbnailLink)');
  url.searchParams.set('pageSize','60');
  url.searchParams.set('orderBy',term?'modifiedTime desc':'folder,name');
  url.searchParams.set('supportsAllDrives','true');
  url.searchParams.set('includeItemsFromAllDrives','true');
  if(nextPageToken)url.searchParams.set('pageToken',nextPageToken);
  const data=await driveJson(env,row,url,fetcher,'drive_unavailable');
  if(!Array.isArray(data.files))throw new ApiError(502,'invalid_google_response');
  for(const file of data.files as Record<string,unknown>[]){
   const mime=String(file.mimeType);
   if(typeof file.id!=='string'||!ID.test(file.id)||typeof file.name!=='string')continue;
   if(mime==='application/vnd.google-apps.folder'||
     (COVER_TYPES.includes(mime)&&Number.isSafeInteger(Number(file.size))&&Number(file.size)>0&&Number(file.size)<=MAX_COVER_BYTES)){
      files.push(file);
   }
  }
  incompleteSearch||=data.incompleteSearch===true;
  nextPageToken=typeof data.nextPageToken==='string'?data.nextPageToken:null;
  if(files.length||!nextPageToken)break;
 }
 // The signed thumbnail ticket is only generated for valid images, not folders.
 const safe=await Promise.all(files.map(async file=>{
  const mime=String(file.mimeType);
  return {id:file.id,name:String(file.name).slice(0,250),mimeType:mime,
   ...(mime==='application/vnd.google-apps.folder'?{}:{
     size:String(file.size),
     ...(typeof file.modifiedTime==='string'?{modifiedTime:file.modifiedTime}:{}),
     thumbnailTicket:typeof file.thumbnailLink==='string'
       ?await sealThumbnailTicket(env,uid,id,row.revision,String(file.id),file.thumbnailLink):undefined
   })};
 }));
 return Response.json({browserVersion:2,files:safe,nextPageToken,incompleteSearch});
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

/** Private Dropbox original, specifically for an authenticated account's image UI.
 * No public sharing link, persistent access ticket, or copy into Firestore. */
export async function dropboxCoverImage(env:Env,uid:string,id:string,fileId:string){
 if(!validStorageFileId('dropbox',fileId))throw new ApiError(400,'dropbox_invalid_file');
 const row=await dropboxConnection(env,uid,id);
 if(row.status!=='connected')throw new ApiError(409,'dropbox_reconnect_required');
 const meta=await dropboxMetadata(env,uid,id,fileId);
 const extension=(meta.name||'').toLowerCase().split('.').pop();
 const mime=extension==='jpg'||extension==='jpeg'?'image/jpeg':extension==='png'?'image/png':extension==='webp'?'image/webp':'';
 const size=meta.size;
 if(meta['.tag']!=='file'||!mime||!Number.isSafeInteger(size)||size!<=0||size!>MAX_COVER_BYTES)
   throw new ApiError(400,'invalid_cover_image');
 const response=await dropboxMedia(env,uid,id,fileId);
 const reader=response.body?.getReader();
 if(!reader)throw new ApiError(502,'cover_unavailable');
 const chunks:Uint8Array[]=[];let received=0;
 try{
   for(;;){
     const {done,value}=await reader.read();if(done)break;
     received+=value.byteLength;
     if(received>size!||received>MAX_COVER_BYTES)throw new ApiError(502,'cover_unavailable');
     chunks.push(value);
   }
 }catch(error){await reader.cancel().catch(()=>undefined);throw error;}
 if(received!==size)throw new ApiError(502,'cover_unavailable');
 const bytes=new Uint8Array(received);let cursor=0;
 for(const part of chunks){bytes.set(part,cursor);cursor+=part.byteLength;}
 const valid=mime==='image/jpeg'?bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff
  :mime==='image/png'?bytes.slice(0,8).every((v,i)=>v===[137,80,78,71,13,10,26,10][i])
  :String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP';
 if(!valid)throw new ApiError(400,'invalid_cover_image');
 const current=await dropboxConnection(env,uid,id);
 if(current.status!=='connected'||current.revision!==row.revision)throw new ApiError(409,'dropbox_connection_changed');
 return new Response(bytes,{headers:{'Content-Type':mime,'Content-Length':String(received),'Cache-Control':'private, no-store',
   'Content-Disposition':'inline','X-Content-Type-Options':'nosniff'}});
}
