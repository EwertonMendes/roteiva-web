import {ApiError,type Env} from './types.ts';
import type {StorageProviderId} from './storage.ts';
type Source={node_id:string;provider:StorageProviderId;connection_id:string;file_id:string};
/** One owner/project-scoped query authorizes every selected node and its complete active ancestry. */
export async function reviewLibrarySelection(env:Env,uid:string,projectId:number,nodeIds:string[]):Promise<Source[]>{
 if(!nodeIds.length||nodeIds.length>8||nodeIds.some(id=>!(/^[0-9a-f-]{36}$/i.test(id))))throw new ApiError(400,'review_invalid_input');
 const placeholders=nodeIds.map(()=>'?').join(',');
 const result=await env.DB.prepare(`WITH RECURSIVE chosen AS (
 SELECT n.library_id,n.id,n.parent_id,n.state,a.provider,a.connection_id,a.file_id
 FROM libraries l JOIN library_nodes n ON n.library_id=l.id AND n.kind='asset'
 JOIN library_entries e ON e.library_id=n.library_id AND e.node_id=n.id
 JOIN library_assets a ON a.library_id=e.library_id AND a.id=e.asset_id
 WHERE l.owner_uid=? AND l.project_id=? AND l.state='active' AND n.id IN (${placeholders})
 ),chain(node_id,library_id,id,parent_id,state,depth) AS (
 SELECT id,library_id,id,parent_id,state,0 FROM chosen
 UNION ALL SELECT c.node_id,c.library_id,n.id,n.parent_id,n.state,c.depth+1
 FROM chain c JOIN library_nodes n ON n.library_id=c.library_id AND n.id=c.parent_id WHERE c.depth<17
 ) SELECT s.id AS node_id,s.provider,s.connection_id,s.file_id FROM chosen s
 WHERE EXISTS(SELECT 1 FROM chain c WHERE c.node_id=s.id AND c.id='root')
 AND NOT EXISTS(SELECT 1 FROM chain c WHERE c.node_id=s.id AND (c.state!='active' OR c.depth>16))`)
 .bind(uid,projectId,...nodeIds).all<Source>();
 if(result.results.length!==nodeIds.length)throw new ApiError(403,'review_file_denied');
 return nodeIds.map(id=>result.results.find(row=>row.node_id===id)!);
}
