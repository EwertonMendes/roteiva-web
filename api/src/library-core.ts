import {ApiError,type Env} from './types.ts';

export type Library={id:string;owner_uid:string;project_id:number};
export type LibraryNode={id:string;parent_id:string|null;kind:'folder'|'asset';name:string;state:'active'|'trashed';revision:number};
const identifier=/^(root|[0-9a-f-]{36})$/;
export function nodeId(value:string){if(!identifier.test(value))throw new ApiError(400,'invalid_library_node');return value;}
function label(value:unknown):string{
 if(typeof value!=='string')throw new ApiError(400,'invalid_library_name');
 const name=value.normalize('NFC').trim();
 if(!name||name.length>120||/[\x00-\x1f\x7f/\\]/.test(name))throw new ApiError(400,'invalid_library_name');return name;
}
/** Project authorization uses the caller's Firebase token and Firestore Rules, never an admin bypass. */
export async function authorizeLibraryProject(request:Request,env:Env,uid:string,projectId:number,fetcher:typeof fetch=fetch){
 if(!Number.isSafeInteger(projectId)||projectId<=0)throw new ApiError(400,'invalid_project');
 const auth=request.headers.get('Authorization')||'';
 const url='https://firestore.googleapis.com/v1/projects/'+encodeURIComponent(env.FIREBASE_PROJECT_ID)+
 '/databases/(default)/documents/users/'+encodeURIComponent(uid)+'/projects/'+projectId;
 let response:Response;
 try{response=await fetcher(url,{headers:{Authorization:auth},redirect:'manual',signal:AbortSignal.timeout(10000)});}
 catch{throw new ApiError(503,'library_authorization_unavailable');}
 if([401,403,404].includes(response.status))throw new ApiError(403,'library_project_denied');
 if(!response.ok)throw new ApiError(503,'library_authorization_unavailable');
 const doc=await response.json() as {fields?:{ownerUid?:{stringValue?:string}}};
 if(doc.fields?.ownerUid?.stringValue!==uid)throw new ApiError(403,'library_project_denied');
}
export async function libraryFor(env:Env,uid:string,projectId:number):Promise<Library>{
 await env.DB.prepare("INSERT OR IGNORE INTO libraries(id,owner_uid,project_id,created_at) VALUES(?,?,?,?)")
 .bind(crypto.randomUUID(),uid,projectId,Date.now()).run();
 const library=await env.DB.prepare("SELECT id,owner_uid,project_id FROM libraries WHERE owner_uid=? AND project_id=? AND state='active'").bind(uid,projectId).first<Library>();
 if(!library)throw new ApiError(409,'library_unavailable');
 await env.DB.prepare("INSERT OR IGNORE INTO library_nodes(library_id,id,parent_id,kind,name) VALUES(?,'root',NULL,'folder','Arquivos')").bind(library.id).run();
 return library;
}
export async function libraryNode(env:Env,lib:Library,id:string,allowTrashed=false):Promise<LibraryNode>{
 nodeId(id);
 const n=await env.DB.prepare('SELECT id,parent_id,kind,name,state,revision FROM library_nodes WHERE library_id=? AND id=?').bind(lib.id,id).first<LibraryNode>();
 if(!n||(!allowTrashed&&n.state!=='active'))throw new ApiError(404,'library_node_unavailable');
 const ancestors=await env.DB.prepare(`WITH RECURSIVE chain(id,parent_id,state,depth) AS (
 SELECT id,parent_id,state,0 FROM library_nodes WHERE library_id=? AND id=?
 UNION ALL SELECT n.id,n.parent_id,n.state,c.depth+1 FROM library_nodes n JOIN chain c ON n.id=c.parent_id WHERE n.library_id=? AND c.depth<17)
 SELECT id,state,depth FROM chain`).bind(lib.id,id,lib.id).all<{id:string;state:string;depth:number}>();
 if(!ancestors.results.some(x=>x.id==='root')||ancestors.results.some(x=>x.depth>16||x.state!=='active'&&!(allowTrashed&&x.id===id)))
 throw new ApiError(404,'library_node_unavailable');
 return n;
}
export async function listLibrary(env:Env,lib:Library,parentId:string,after:string|null,search=''){
 const parent=await libraryNode(env,lib,parentId);if(parent.kind!=='folder')throw new ApiError(400,'library_parent_denied');
 if(after)nodeId(after);
 const term=search.normalize('NFC').trim();if(term.length>100||/[\x00-\x1f\x7f]/.test(term))throw new ApiError(400,'invalid_search');
 const pattern='%'+term.replace(/[\\%_]/g,value=>'\\'+value)+'%';
 const rows=await env.DB.prepare("SELECT n.id,n.asset_id,n.parent_id,n.kind,n.name,n.state,n.revision,a.provider,a.source_name,a.mime_type,a.size,a.state AS source_state FROM library_nodes n LEFT JOIN library_entries e ON e.library_id=n.library_id AND e.node_id=n.id LEFT JOIN library_assets a ON a.library_id=e.library_id AND a.id=e.asset_id WHERE n.library_id=? AND n.parent_id=? AND n.state='active' AND n.id>? AND n.name LIKE ? ESCAPE '\\' ORDER BY n.id LIMIT 51")
 .bind(lib.id,parentId,after||'',pattern).all<LibraryNode>();
 const items=rows.results.slice(0,50);
 const chain=await env.DB.prepare(`WITH RECURSIVE c(id,parent_id,name,depth) AS (
 SELECT id,parent_id,name,0 FROM library_nodes WHERE library_id=? AND id=?
 UNION ALL SELECT n.id,n.parent_id,n.name,c.depth+1 FROM library_nodes n JOIN c ON n.id=c.parent_id WHERE n.library_id=? AND c.depth<16)
 SELECT id,name FROM c ORDER BY depth DESC`).bind(lib.id,parentId,lib.id).all<{id:string;name:string}>();
 return Response.json({libraryId:lib.id,parent,trail:chain.results,nodes:items,nextPage:rows.results.length>50?items.at(-1)!.id:null});
}
export async function mutateLibrary(env:Env,lib:Library,id:string|null,data:unknown){
 if(!data||typeof data!=='object'||Array.isArray(data))throw new ApiError(400,'invalid_library_operation');
 const x=data as Record<string,unknown>;
 try{
 if(!id){
   const parent=await libraryNode(env,lib,nodeId(typeof x.parentId==='string'?x.parentId:'root'));
   if(parent.kind!=='folder')throw new ApiError(400,'library_parent_denied');
   const created=crypto.randomUUID();
   // Atomic ancestor test closes the race with a concurrent trash operation.
   const result=await env.DB.prepare(`INSERT INTO library_nodes(library_id,id,parent_id,kind,name)
   SELECT ?,?,?,'folder',? WHERE NOT EXISTS(WITH RECURSIVE c(id,parent_id,state) AS (
   SELECT id,parent_id,state FROM library_nodes WHERE library_id=? AND id=?
   UNION ALL SELECT n.id,n.parent_id,n.state FROM library_nodes n JOIN c ON n.id=c.parent_id WHERE n.library_id=?
   ) SELECT 1 FROM c WHERE state!='active')`).bind(lib.id,created,parent.id,label(x.name),lib.id,parent.id,lib.id).run();
   if(result.meta.changes!==1)throw new ApiError(409,'library_changed');
   return Response.json({id:created},{status:201});
 }
 if(id==='root')throw new ApiError(400,'library_root_immutable');
 const current=await libraryNode(env,lib,id,x.action==='restore');
 if(!Number.isSafeInteger(x.revision)||x.revision!==current.revision)throw new ApiError(409,'library_changed');
 let query:string,args:unknown[];
 if(x.action==='rename'){query='name=?';args=[label(x.name)];}
 else if(x.action==='move'){
   const parent=await libraryNode(env,lib,nodeId(String(x.parentId||'')));
   if(parent.kind!=='folder')throw new ApiError(400,'library_parent_denied');
   query='parent_id=?';args=[parent.id];
 }else if(x.action==='trash'||x.action==='restore'){query='state=?';args=[x.action==='trash'?'trashed':'active'];}
 else throw new ApiError(400,'invalid_library_operation');
 const target=x.action==='move'?String(x.parentId):id;
 const result=await env.DB.prepare('UPDATE library_nodes SET '+query+`,revision=revision+1 WHERE library_id=? AND id=? AND revision=?
 AND NOT EXISTS(WITH RECURSIVE c(id,parent_id,state,depth) AS (
 SELECT id,parent_id,state,0 FROM library_nodes WHERE library_id=? AND id IN (?,?)
 UNION ALL SELECT n.id,n.parent_id,n.state,c.depth+1 FROM library_nodes n JOIN c ON n.id=c.parent_id WHERE n.library_id=? AND c.depth<17
 ) SELECT 1 FROM c WHERE state!='active' AND id!=?)`)
 .bind(...args,lib.id,id,current.revision,lib.id,id,target,lib.id,id).run();
 if(result.meta.changes!==1)throw new ApiError(409,'library_changed');
 return Response.json({updated:true,revision:current.revision+1});
 }catch(error){
 if(error instanceof ApiError)throw error;
 const cause=String(error);
 if(cause.includes('UNIQUE constraint failed: library_nodes.library_id, library_nodes.parent_id, library_nodes.asset_id'))throw new ApiError(409,'library_asset_exists');
 for(const code of ['library_cycle','library_depth_exceeded','library_parent_denied','library_root_immutable'])if(cause.includes(code))throw new ApiError(409,code);
 throw error;
 }
}
