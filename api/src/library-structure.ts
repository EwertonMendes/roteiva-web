import {ApiError,type Env} from './types.ts';
import {libraryFor,libraryNode} from './library-core.ts';
import {hash} from './crypto.ts';
type Folder={key:string;parentKey:string|null;name:string};
type Planned=Folder&{id:string;parentId:string};
function plan(input:unknown){
 const data=input as {attemptId?:unknown;parentId?:unknown;folders?:unknown}|null;
 if(!data||typeof data.attemptId!=='string'||!/^[-0-9a-f]{36}$/.test(data.attemptId)||typeof data.parentId!=='string'||!Array.isArray(data.folders)||!data.folders.length||data.folders.length>80)throw new ApiError(400,'invalid_library_structure');
 const pending=new Map<string,Folder>();
 for(const raw of data.folders){
  const x=raw as Partial<Folder>|null;
  if(!x||typeof x.key!=='string'||!/^[-_a-zA-Z0-9]{1,80}$/.test(x.key)||pending.has(x.key)||
   x.parentKey!==null&&(typeof x.parentKey!=='string'||!/^[-_a-zA-Z0-9]{1,80}$/.test(x.parentKey))||typeof x.name!=='string')throw new ApiError(400,'invalid_library_structure');
  const name=x.name.normalize('NFC').trim();if(!name||name.length>120||/[\x00-\x1f\x7f/\\]/.test(name))throw new ApiError(400,'invalid_library_name');
  pending.set(x.key,{key:x.key,parentKey:x.parentKey as string|null,name});
 }
 const ordered:Folder[]=[];
 while(pending.size){
  let progressed=false;
  for(const [key,folder] of pending){if(folder.parentKey===null||ordered.some(x=>x.key===folder.parentKey)){ordered.push(folder);pending.delete(key);progressed=true;}}
  if(!progressed)throw new ApiError(400,'invalid_library_structure');
 }
 return {attemptId:data.attemptId,parentId:data.parentId,folders:ordered};
}
/** One idempotent transaction; a failed hierarchy never leaves half a template. */
export async function createLibraryStructure(env:Env,uid:string,projectId:number,input:unknown){
 const data=plan(input),library=await libraryFor(env,uid,projectId),parent=await libraryNode(env,library,data.parentId);
 if(parent.kind!=='folder')throw new ApiError(400,'library_parent_denied');
 const fingerprint=await hash(JSON.stringify({parentId:data.parentId,folders:data.folders}));
 const mapping:Planned[]=[];
 for(const folder of data.folders)mapping.push({...folder,id:crypto.randomUUID(),parentId:folder.parentKey===null?parent.id:mapping.find(x=>x.key===folder.parentKey)!.id});
 await env.DB.prepare("INSERT OR IGNORE INTO library_structure_attempts(library_id,id,request_hash,mapping,state,created_at) VALUES(?,?,?,?,'applying',?)")
  .bind(library.id,data.attemptId,fingerprint,JSON.stringify(mapping),Date.now()).run();
 const attempt=await env.DB.prepare('SELECT request_hash,mapping,state FROM library_structure_attempts WHERE library_id=? AND id=?').bind(library.id,data.attemptId).first<{request_hash:string;mapping:string;state:string}>();
 if(!attempt||attempt.request_hash!==fingerprint)throw new ApiError(409,'library_structure_mismatch');
 const saved=JSON.parse(attempt.mapping) as Planned[];
 if(attempt.state==='complete')return Response.json({created:saved.map(x=>({key:x.key,id:x.id})),completed:true});
 await libraryNode(env,library,parent.id);
 try{
  await env.DB.batch([
   ...saved.map(folder=>env.DB.prepare(`INSERT OR IGNORE INTO library_nodes(library_id,id,parent_id,kind,name)
    SELECT ?,?,?,'folder',? WHERE NOT EXISTS(WITH RECURSIVE c(id,parent_id,state) AS (
      SELECT id,parent_id,state FROM library_nodes WHERE library_id=? AND id=?
      UNION ALL SELECT n.id,n.parent_id,n.state FROM library_nodes n JOIN c ON n.id=c.parent_id WHERE n.library_id=?
    ) SELECT 1 FROM c WHERE state!='active')`).bind(library.id,folder.id,folder.parentId,folder.name,library.id,parent.id,library.id)),
   env.DB.prepare("UPDATE library_structure_attempts SET state='complete' WHERE library_id=? AND id=? AND NOT EXISTS(SELECT 1 FROM json_each(mapping) p WHERE NOT EXISTS(SELECT 1 FROM library_nodes n WHERE n.library_id=? AND n.id=json_extract(p.value,'$.id')))")
    .bind(library.id,data.attemptId,library.id),
  ]);
 }catch(error){
  if(String(error).includes('library_depth_exceeded'))throw new ApiError(409,'library_depth_exceeded');
  if(String(error).includes('library_parent_denied'))throw new ApiError(409,'library_parent_denied');
  throw error;
 }
 const complete=await env.DB.prepare("SELECT 1 FROM library_structure_attempts WHERE library_id=? AND id=? AND state='complete'").bind(library.id,data.attemptId).first();
 if(!complete)throw new ApiError(409,'library_changed');
 return Response.json({created:saved.map(x=>({key:x.key,id:x.id})),completed:true});
}
