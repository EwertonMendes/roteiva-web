import {ApiError,type Env} from './types.ts';
import {connection} from './repository.ts';
import {driveJson} from './drive-client.ts';
import {dropboxMetadata} from './dropbox.ts';
import {libraryNode,libraryFor} from './library.ts';
import {validConnectionId,validStorageFileId,isStorageProvider} from './storage.ts';

type Candidate={provider:'google_drive'|'dropbox';connectionId:string;fileId:string};
type Metadata={name:string;mimeType:string;size:string|null;revision:string|null};
async function stableId(value:string){
 const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));
 const s=Array.from(bytes.slice(0,16),x=>x.toString(16).padStart(2,'0')).join('');
 return s.slice(0,8)+'-'+s.slice(8,12)+'-'+s.slice(12,16)+'-'+s.slice(16,20)+'-'+s.slice(20);
}
function candidate(value:unknown):Candidate{
 const x=value as Partial<Candidate>|null;
 if(!x||!isStorageProvider(x.provider)||typeof x.connectionId!=='string'||!validConnectionId(x.connectionId)||
 typeof x.fileId!=='string'||!validStorageFileId(x.provider,x.fileId))throw new ApiError(400,'invalid_library_asset');
 return x as Candidate;
}
export async function readLibrarySource(env:Env,uid:string,x:Candidate,fetcher:typeof fetch=fetch):Promise<Metadata>{
 if(x.provider==='google_drive'){
 const row=await connection(env,uid,x.connectionId);
 if(row.status!=='connected')throw new ApiError(409,'reconnect_required');
 const url=new URL('https://www.googleapis.com/drive/v3/files/'+x.fileId);
 url.searchParams.set('fields','id,name,mimeType,size,headRevisionId,isAppAuthorized,trashed,capabilities(canDownload)');
 url.searchParams.set('supportsAllDrives','true');
 const m=await driveJson(env,row,url,fetcher,'source_unavailable');
 if(m.trashed===true)throw new ApiError(410,'source_trashed');
 if(m.id!==x.fileId||m.isAppAuthorized!==true)throw new ApiError(403,'library_picker_required');
 if(m.mimeType==='application/vnd.google-apps.folder'||m.mimeType==='application/vnd.google-apps.shortcut')throw new ApiError(415,'library_select_files');
 if(typeof m.name!=='string'||typeof m.mimeType!=='string')throw new ApiError(502,'invalid_google_response');
 return {name:m.name,mimeType:m.mimeType,size:typeof m.size==='string'?m.size:null,revision:typeof m.headRevisionId==='string'?m.headRevisionId:null};
 }
 const m=await dropboxMetadata(env,uid,x.connectionId,x.fileId,fetcher);
 if(m['.tag']!=='file'||m.id!==x.fileId||typeof m.name!=='string')throw new ApiError(404,'source_unavailable');
 if(m.is_downloadable===false)throw new ApiError(403,'source_restricted');
 // Keep format discovery explicit; extensions never authorize or enable active content.
 const ext=m.name.split('.').at(-1)?.toLowerCase()||'';
 const types:Record<string,string>={pdf:'application/pdf',mp4:'video/mp4',webm:'video/webm',mov:'video/quicktime',mp3:'audio/mpeg',wav:'audio/wav',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp'};
 return {name:m.name,mimeType:types[ext]||'application/octet-stream',size:typeof m.size==='number'?String(m.size):null,revision:typeof m.rev==='string'?m.rev:null};
}
/** Caller must authorize the project first; each item is then verified with its owner's credential. */
export async function importLibraryAssets(env:Env,uid:string,projectId:number,input:unknown,fetcher:typeof fetch=fetch){
 const x=input as {parentId?:unknown;items?:unknown}|null;
 if(!x||typeof x.parentId!=='string'||!Array.isArray(x.items)||!x.items.length||x.items.length>10)throw new ApiError(400,'invalid_library_batch');
 const items=x.items.map(candidate);const lib=await libraryFor(env,uid,projectId);
 const parent=await libraryNode(env,lib,x.parentId);if(parent.kind!=='folder')throw new ApiError(400,'library_parent_denied');
 const results=[];
 for(const item of items){
 try{
 const metadata=await readLibrarySource(env,uid,item,fetcher);
 // Revalidate destination after provider I/O; a deleted destination never redirects the import.
 await libraryNode(env,lib,parent.id);
 const asset=await stableId(JSON.stringify([lib.id,item.provider,item.connectionId,item.fileId]));
 const id=crypto.randomUUID();
 await env.DB.batch([
 env.DB.prepare(`INSERT INTO library_assets(library_id,id,provider,connection_id,file_id,source_name,mime_type,size,source_revision,observed_at,state)
 VALUES(?,?,?,?,?,?,?,?,?,?,'available') ON CONFLICT(library_id,id) DO UPDATE SET source_name=excluded.source_name,mime_type=excluded.mime_type,size=excluded.size,source_revision=excluded.source_revision,observed_at=excluded.observed_at,state='available'`)
 .bind(lib.id,asset,item.provider,item.connectionId,item.fileId,metadata.name,metadata.mimeType,metadata.size,metadata.revision,Date.now()),
 env.DB.prepare(`INSERT OR IGNORE INTO library_nodes(library_id,id,parent_id,kind,name,asset_id)
 SELECT ?,?,?,'asset',?,? WHERE NOT EXISTS(WITH RECURSIVE c(id,parent_id,state) AS (
 SELECT id,parent_id,state FROM library_nodes WHERE library_id=? AND id=?
 UNION ALL SELECT n.id,n.parent_id,n.state FROM library_nodes n JOIN c ON n.id=c.parent_id WHERE n.library_id=?
 ) SELECT 1 FROM c WHERE state!='active')`).bind(lib.id,id,parent.id,metadata.name.slice(0,120)||'Arquivo',asset,lib.id,parent.id,lib.id),
 env.DB.prepare("INSERT OR IGNORE INTO library_entries(library_id,node_id,asset_id) SELECT library_id,id,asset_id FROM library_nodes WHERE library_id=? AND parent_id=? AND asset_id=? AND state='active'").bind(lib.id,parent.id,asset),
 ]);
 const saved=await env.DB.prepare("SELECT id FROM library_nodes WHERE library_id=? AND parent_id=? AND asset_id=? AND state='active'").bind(lib.id,parent.id,asset).first<{id:string}>();
 if(!saved)throw new ApiError(409,'library_changed');
 await libraryNode(env,lib,saved.id);
 results.push({fileId:item.fileId,id:saved.id,status:'added'});
 }catch(error){if(!(error instanceof ApiError))throw error;results.push({fileId:item.fileId,status:'failed',code:error.code});}
 }
 return Response.json({results});
}
