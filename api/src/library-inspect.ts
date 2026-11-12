import {ApiError,type Env} from './types.ts';
import {pickedDriveResource} from './drive-picked-source.ts';
import {validDriveResourceKey} from './drive-resource-keys.ts';
import {dropboxConnection,dropboxMetadata} from './dropbox.ts';
import {isStorageProvider,validConnectionId,validStorageFileId} from './storage.ts';
import type {LibraryInspection} from '../../shared/library-selection.ts';
/** Inspect only explicit selections. A selected folder never authorizes/list its children. */
export async function inspectLibrarySelection(env:Env,uid:string,input:unknown,fetcher:typeof fetch=fetch){
 const data=input as {provider?:unknown;connectionId?:unknown;items?:unknown}|null;
 if(!data||!isStorageProvider(data.provider)||typeof data.connectionId!=='string'||!validConnectionId(data.connectionId)||!Array.isArray(data.items)||!data.items.length||data.items.length>3)throw new ApiError(400,'invalid_library_batch');
 const {provider,connectionId}=data;
 const items=data.items.map(raw=>{
  const value=raw as {fileId?:unknown;resourceKey?:unknown}|null;
  if(!value||typeof value.fileId!=='string'||!validStorageFileId(provider,value.fileId)||value.resourceKey!==undefined&&(provider!=='google_drive'||!validDriveResourceKey(value.resourceKey)))throw new ApiError(400,'invalid_library_asset');
  return {fileId:value.fileId,resourceKey:value.resourceKey as string|undefined};
 });
 const results:LibraryInspection[]=[];
 for(const item of items)try{
  if(provider==='google_drive'){
   const metadata=await pickedDriveResource(env,uid,connectionId,item.fileId,item.resourceKey,fetcher);
   if(typeof metadata.name!=='string'||typeof metadata.mimeType!=='string')throw new ApiError(502,'invalid_google_response');
   if(metadata.mimeType==='application/vnd.google-apps.shortcut')throw new ApiError(415,'library_select_files');
   const parentIds=Array.isArray(metadata.parents)?metadata.parents.filter((x):x is string=>typeof x==='string'&&/^[A-Za-z0-9_-]{10,200}$/.test(x)).slice(0,32):[];
   results.push({fileId:item.fileId,status:'ready',source:{provider,connectionId,fileId:item.fileId,kind:metadata.mimeType==='application/vnd.google-apps.folder'?'folder':'asset',name:metadata.name,parentIds}});
  }else{
   const account=await dropboxConnection(env,uid,connectionId);if(account.status!=='connected')throw new ApiError(409,'dropbox_reconnect_required');
   const metadata=await dropboxMetadata(env,uid,connectionId,item.fileId,fetcher);
   if(!metadata.name||!['folder','file'].includes(metadata['.tag'])||metadata.id!==item.fileId)throw new ApiError(404,'source_unavailable');
   if(metadata['.tag']==='file'&&metadata.is_downloadable===false)throw new ApiError(403,'source_restricted');
   results.push({fileId:item.fileId,status:'ready',source:{provider,connectionId,fileId:item.fileId,kind:metadata['.tag']==='folder'?'folder':'asset',name:metadata.name,parentIds:[],path:metadata.path_lower}});
  }
 }catch(error){if(!(error instanceof ApiError))throw error;results.push({fileId:item.fileId,status:'failed',code:error.code});}
 return Response.json({results});
}
