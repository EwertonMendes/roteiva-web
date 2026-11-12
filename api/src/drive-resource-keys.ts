import {ApiError,type Env} from './types.ts';
import {context,decrypt,encrypt} from './crypto.ts';
export function validDriveResourceKey(value:unknown):value is string{return typeof value==='string'&&/^[A-Za-z0-9_-]{1,256}$/.test(value);}
export function driveResourceHeaders(fileId:string,key?:string|null):Record<string,string>{
 if(!key)return {};
 if(!/^[A-Za-z0-9_-]{10,200}$/.test(fileId)||!validDriveResourceKey(key))throw new ApiError(400,'invalid_drive_resource_key');
 return {'X-Goog-Drive-Resource-Keys':fileId+'/'+key};
}
export async function storedDriveResourceKey(env:Env,uid:string,connectionId:string,fileId:string){
 const row=await env.DB.prepare('SELECT encrypted_key FROM drive_resource_keys WHERE owner_uid=? AND connection_id=? AND file_id=?').bind(uid,connectionId,fileId).first<{encrypted_key:string}>();
 if(!row)return undefined;
 return decrypt(env,row.encrypted_key,context(env,uid,connectionId,'drive-resource-key:'+fileId));
}
export async function decodeDriveResourceKey(env:Env,uid:string,connectionId:string,fileId:string,encryptedKey?:string|null){
 return encryptedKey?decrypt(env,encryptedKey,context(env,uid,connectionId,'drive-resource-key:'+fileId)):undefined;
}
export async function retainDriveResourceKey(env:Env,uid:string,connectionId:string,fileId:string,key:string,observedAt:number){
 driveResourceHeaders(fileId,key);
 const encrypted=await encrypt(env,key,context(env,uid,connectionId,'drive-resource-key:'+fileId));
 await env.DB.prepare(`INSERT INTO drive_resource_keys(connection_id,owner_uid,file_id,encrypted_key,updated_at) VALUES(?,?,?,?,?)
 ON CONFLICT(connection_id,file_id) DO UPDATE SET encrypted_key=excluded.encrypted_key,updated_at=excluded.updated_at WHERE drive_resource_keys.owner_uid=excluded.owner_uid AND drive_resource_keys.updated_at<=excluded.updated_at`)
 .bind(connectionId,uid,fileId,encrypted,observedAt).run();
}
