import {ApiError,type Env} from './types.ts';
import {uploadBody} from './uploads.ts';
import {importLibraryAssets} from './library-assets.ts';
import {connection} from './repository.ts';
import {libraryContent} from './library-content.ts';
import {prepareLibraryUploadTarget} from './library-upload-target.ts';
import {createLibraryStructure} from './library-structure.ts';
import {authorizeLibraryProject,libraryFor,nodeId,listLibrary,mutateLibrary,type LibraryNode} from './library-core.ts';
export {authorizeLibraryProject,libraryFor,libraryNode,listLibrary,mutateLibrary} from './library-core.ts';

export async function libraryRouter(request:Request,env:Env,uid:string,url:URL,fetcher:typeof fetch=fetch){
 const structure=/^\/library\/projects\/([1-9][0-9]{0,14})\/structure$/.exec(url.pathname);
 if(structure&&request.method==='POST'){
  await authorizeLibraryProject(request,env,uid,Number(structure[1]),fetcher);
  return createLibraryStructure(env,uid,Number(structure[1]),await uploadBody(request,32768));
 }
 const upload=/^\/library\/projects\/([1-9][0-9]{0,14})\/uploads\/destination$/.exec(url.pathname);
 if(upload&&request.method==='POST')return prepareLibraryUploadTarget(request,env,uid,Number(upload[1]),await uploadBody(request),fetcher);
 const content=/^\/library\/projects\/([1-9][0-9]{0,14})\/nodes\/([0-9a-f-]{36})\/content$/.exec(url.pathname);
 if(content&&(request.method==='GET'||request.method==='HEAD')){
 await authorizeLibraryProject(request,env,uid,Number(content[1]),fetcher);
 return libraryContent(request,env,uid,Number(content[1]),content[2],fetcher);
 }
 const picker=/^\/library\/projects\/([1-9][0-9]{0,14})\/picker\/([0-9a-f-]{36})$/.exec(url.pathname);
 if(picker&&request.method==='GET'){
 await authorizeLibraryProject(request,env,uid,Number(picker[1]),fetcher);
 const row=await connection(env,uid,picker[2]);
 if(row.status!=='connected')throw new ApiError(409,'reconnect_required');
 const appId=env.GOOGLE_CLIENT_ID?.split('-')[0];
 if(!appId||!/^\d+$/.test(appId)||!env.GOOGLE_PICKER_API_KEY)throw new ApiError(503,'picker_not_configured');
 return Response.json({authorized:false,clientId:env.GOOGLE_CLIENT_ID,appId,developerKey:env.GOOGLE_PICKER_API_KEY,accountId:row.google_account_id});
 }
 const match=/^\/library\/projects\/([1-9][0-9]{0,14})\/(nodes|imports)(?:\/([0-9a-f-]{36}|root))?$/.exec(url.pathname);
 if(!match)throw new ApiError(404,'not_found');
 await authorizeLibraryProject(request,env,uid,Number(match[1]),fetcher);
 const lib=await libraryFor(env,uid,Number(match[1]));
 if(match[2]==='imports'&&request.method==='POST'&&!match[3])return importLibraryAssets(env,uid,Number(match[1]),await uploadBody(request),fetcher);
 if(match[2]==='nodes'&&request.method==='GET'&&!match[3]){
 if(url.searchParams.get('trash')==='1'){
 const after=url.searchParams.get('after');if(after)nodeId(after);
 const data=await env.DB.prepare("SELECT id,parent_id,kind,name,state,revision FROM library_nodes WHERE library_id=? AND state='trashed' AND id>? ORDER BY id LIMIT 51").bind(lib.id,after||'').all<LibraryNode>();
 const nodes=data.results.slice(0,50);return Response.json({libraryId:lib.id,trail:[{id:'root',name:'Lixeira'}],nodes,nextPage:data.results.length>50?nodes.at(-1)!.id:null});
 }
 return listLibrary(env,lib,nodeId(url.searchParams.get('parent')||'root'),url.searchParams.get('after'),url.searchParams.get('q')||'');
 }
 if(match[2]==='nodes'&&request.method==='POST')return mutateLibrary(env,lib,match[3]||null,await uploadBody(request));
 throw new ApiError(405,'method_not_allowed');
}
