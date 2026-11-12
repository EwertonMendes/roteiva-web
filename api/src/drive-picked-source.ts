import {ApiError,type Env,type Connection} from './types.ts';
import {driveJson} from './drive-client.ts';
import {validDriveResourceKey,decodeDriveResourceKey,retainDriveResourceKey} from './drive-resource-keys.ts';
/** A resource key supplements access; it never replaces OAuth, ownership or the explicit Picker grant. */
export async function pickedDriveResource(env:Env,uid:string,connectionId:string,fileId:string,incomingKey?:string,fetcher:typeof fetch=fetch):Promise<Record<string,unknown>&{resourceKey?:string}>{
 const started=Date.now(),row=await env.DB.prepare(`SELECT c.*,k.encrypted_key FROM drive_connections c LEFT JOIN drive_resource_keys k ON k.connection_id=c.id AND k.owner_uid=c.owner_uid AND k.file_id=? WHERE c.owner_uid=? AND c.id=?`).bind(fileId,uid,connectionId).first<Connection&{encrypted_key:string|null}>();
 if(!row)throw new ApiError(404,'connection_not_found');
 if(row.status!=='connected')throw new ApiError(409,'reconnect_required');
 if(!/^[A-Za-z0-9_-]{10,200}$/.test(fileId)||incomingKey!==undefined&&!validDriveResourceKey(incomingKey))throw new ApiError(400,'invalid_library_asset');
 const stored=await decodeDriveResourceKey(env,uid,connectionId,fileId,row.encrypted_key),resourceKey=incomingKey||stored;
 const url=new URL('https://www.googleapis.com/drive/v3/files/'+fileId);
 url.searchParams.set('fields','id,name,mimeType,size,modifiedTime,headRevisionId,md5Checksum,resourceKey,parents,thumbnailLink,trashed,isAppAuthorized,capabilities(canDownload),imageMediaMetadata(width,height)');
 url.searchParams.set('supportsAllDrives','true');
 const metadata=await driveJson(env,row,url,fetcher,'source_unavailable',resourceKey);
 if(metadata.id!==fileId||metadata.isAppAuthorized!==true)throw new ApiError(403,'library_picker_required');
 if(metadata.trashed===true)throw new ApiError(410,'source_trashed');
 if(metadata.mimeType!=='application/vnd.google-apps.folder'&&(metadata.capabilities as {canDownload?:boolean}|undefined)?.canDownload===false)throw new ApiError(403,'source_restricted');
 const key=validDriveResourceKey(metadata.resourceKey)?metadata.resourceKey:resourceKey;
 if(key&&key!==stored)await retainDriveResourceKey(env,uid,connectionId,fileId,key,started);
 return {...metadata,resourceKey:key};
}
