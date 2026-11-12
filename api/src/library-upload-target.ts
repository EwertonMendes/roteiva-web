import {ApiError,type Env} from './types.ts';
import {authorizeLibraryProject,libraryFor,libraryNode} from './library-core.ts';
import {connection} from './repository.ts';
import {accessCredential} from './google.ts';
import {driveJson} from './drive-client.ts';
import {dropboxConnection,dropboxAccess,dropboxMetadata} from './dropbox.ts';
import {isStorageProvider,validConnectionId,type StorageProviderId} from './storage.ts';

type Target={reserved_id:string;file_id:string|null;state:'reserved'|'ready'};
async function targetMetadata(env:Env,uid:string,provider:StorageProviderId,connectionId:string,id:string,fetcher:typeof fetch){
 if(provider==='dropbox'){
  const account=await dropboxConnection(env,uid,connectionId);
  if(account.status!=='connected')throw new ApiError(409,'dropbox_reconnect_required');
  let item;
  if(id.startsWith('id:'))item=await dropboxMetadata(env,uid,connectionId,id,fetcher);
  else{
   if(!/^\/Roteiva - [0-9a-f-]{36}$/.test(id))throw new ApiError(400,'library_upload_target_denied');
   const token=await dropboxAccess(env,account,fetcher);
   const response=await fetcher('https://api.dropboxapi.com/2/files/get_metadata',{method:'POST',redirect:'manual',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({path:id}),signal:AbortSignal.timeout(12000)});
   if(!response.ok){await response.body?.cancel();throw new ApiError(response.status===409?404:response.status===429?429:503,'library_upload_target_missing');}
   item=await response.json() as {'.tag'?:string;id?:string;path_display?:string};
  }
  if(item['.tag']!=='folder'||!item.path_display||!item.id)throw new ApiError(404,'library_upload_target_missing');
  return {id:item.id,path:item.path_display};
 }
 const account=await connection(env,uid,connectionId);
 if(account.status!=='connected')throw new ApiError(409,'reconnect_required');
 const url=new URL('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(id));
 url.searchParams.set('fields','id,mimeType,trashed,isAppAuthorized,capabilities(canAddChildren)');
 url.searchParams.set('supportsAllDrives','true');
 const item=await driveJson(env,account,url,fetcher,'library_upload_target_missing');
 if(item.trashed===true)throw new ApiError(410,'library_upload_target_missing');
 if(item.mimeType!=='application/vnd.google-apps.folder'||item.isAppAuthorized!==true||
   (item.capabilities as {canAddChildren?:boolean}|undefined)?.canAddChildren!==true)throw new ApiError(403,'library_upload_target_restricted');
 return {id:String(item.id),path:''};
}
async function authorize(request:Request,env:Env,uid:string,projectId:number,nodeId:string,fetcher:typeof fetch){
 await authorizeLibraryProject(request,env,uid,projectId,fetcher);
 const library=await libraryFor(env,uid,projectId),node=await libraryNode(env,library,nodeId);
 if(node.kind!=='folder')throw new ApiError(400,'library_parent_denied');
 return library;
}
export async function authorizeVirtualUpload(request:Request,env:Env,uid:string,provider:StorageProviderId,
 connectionId:string,projectId:number,nodeId:string,targetId:string,fetcher:typeof fetch=fetch){
 const library=await authorize(request,env,uid,projectId,nodeId,fetcher);
 const row=await env.DB.prepare("SELECT file_id FROM library_upload_targets WHERE library_id=? AND provider=? AND connection_id=? AND state='ready'")
  .bind(library.id,provider,connectionId).first<{file_id:string}>();
 if(!row||row.file_id!==targetId)throw new ApiError(403,'library_upload_target_denied');
 const target=await targetMetadata(env,uid,provider,connectionId,targetId,fetcher);
 await libraryNode(env,library,nodeId);
 return target;
}
/** A managed provider folder is independent of the virtual tree. Reserve identity before creating it. */
export async function prepareLibraryUploadTarget(request:Request,env:Env,uid:string,projectId:number,input:unknown,fetcher:typeof fetch=fetch){
 const data=input as {provider?:unknown;connectionId?:unknown;nodeId?:unknown}|null;
 if(!data||!isStorageProvider(data.provider)||typeof data.connectionId!=='string'||!validConnectionId(data.connectionId)||typeof data.nodeId!=='string')throw new ApiError(400,'invalid_upload');
 const {provider,connectionId,nodeId}=data,library=await authorize(request,env,uid,projectId,nodeId,fetcher);
 // Validate the selected account before reserving or issuing any provider write.
 const account=provider==='google_drive'?await connection(env,uid,connectionId):await dropboxConnection(env,uid,connectionId);
 if(account.status!=='connected')throw new ApiError(409,'reconnect_required');
 const query=()=>env.DB.prepare('SELECT reserved_id,file_id,state FROM library_upload_targets WHERE library_id=? AND provider=? AND connection_id=?').bind(library.id,provider,connectionId).first<Target>();
 let current=await query();
 if(current?.state==='ready'){
  try{await targetMetadata(env,uid,provider,connectionId,current.file_id!,fetcher);return Response.json({targetFolderId:current.file_id});}
  catch(error){if(!(error instanceof ApiError)||![404,410].includes(error.status))throw error;}
 }
 if(!current||current.state==='ready'){
  let reserved='/Roteiva - '+crypto.randomUUID();
  if(provider==='google_drive'){
   const row=await connection(env,uid,connectionId),ids=await driveJson(env,row,new URL('https://www.googleapis.com/drive/v3/files/generateIds?count=1&space=drive&type=files'),fetcher);
   if(!Array.isArray(ids.ids)||typeof ids.ids[0]!=='string'||!/^[A-Za-z0-9_-]{10,200}$/.test(ids.ids[0]))throw new ApiError(502,'invalid_google_response');
   reserved=ids.ids[0];
  }
  if(current)await env.DB.prepare("UPDATE library_upload_targets SET reserved_id=?,file_id=NULL,state='reserved' WHERE library_id=? AND provider=? AND connection_id=? AND state='ready' AND file_id=?")
   .bind(reserved,library.id,provider,connectionId,current.file_id).run();
  else await env.DB.prepare("INSERT OR IGNORE INTO library_upload_targets(library_id,provider,connection_id,reserved_id,state,created_at) VALUES(?,?,?,?,'reserved',?)")
   .bind(library.id,provider,connectionId,reserved,Date.now()).run();
  current=await query();
 }
 if(!current)throw new ApiError(409,'library_changed');
 if(current.state==='ready')return Response.json({targetFolderId:current.file_id});
 let target;
 try{target=await targetMetadata(env,uid,provider,connectionId,current.reserved_id,fetcher);}
 catch(error){
  if(!(error instanceof ApiError)||error.status!==404)throw error;
  let response:Response;
  if(provider==='google_drive'){
   const token=await accessCredential(env,await connection(env,uid,connectionId),fetcher);
   response=await fetcher('https://www.googleapis.com/drive/v3/files',{method:'POST',redirect:'manual',headers:{Authorization:'Bearer '+token.value,'Content-Type':'application/json'},body:JSON.stringify({id:current.reserved_id,name:'Roteiva - projeto '+projectId,mimeType:'application/vnd.google-apps.folder'}),signal:AbortSignal.timeout(12000)});
  }else{
   const token=await dropboxAccess(env,await dropboxConnection(env,uid,connectionId),fetcher);
   response=await fetcher('https://api.dropboxapi.com/2/files/create_folder_v2',{method:'POST',redirect:'manual',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({path:current.reserved_id,autorename:false}),signal:AbortSignal.timeout(12000)});
  }
  const status=response.status;await response.body?.cancel();
  if(!response.ok&&status!==409)throw new ApiError(status===429?429:503,'library_upload_target_unavailable');
  target=await targetMetadata(env,uid,provider,connectionId,current.reserved_id,fetcher);
 }
 await libraryNode(env,library,nodeId);
 const saved=await env.DB.prepare("UPDATE library_upload_targets SET file_id=?,state='ready' WHERE library_id=? AND provider=? AND connection_id=? AND reserved_id=?")
  .bind(target.id,library.id,provider,connectionId,current.reserved_id).run();
 if(saved.meta.changes!==1)throw new ApiError(409,'library_changed');
 return Response.json({targetFolderId:target.id});
}
