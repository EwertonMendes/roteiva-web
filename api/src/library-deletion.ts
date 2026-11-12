import type {Env} from './types.ts';
/** Account deletion is fenced before this runs; originals and provider grants are untouched. */
export async function eraseOwnerLibraryChunk(env:Env,uid:string):Promise<boolean>{
 const library=await env.DB.prepare('SELECT id FROM libraries WHERE owner_uid=? LIMIT 1').bind(uid).first<{id:string}>();
 if(!library)return true;
 await env.DB.batch([
  env.DB.prepare("UPDATE libraries SET state='deleting' WHERE id=? AND owner_uid=?").bind(library.id,uid),
  env.DB.prepare('DELETE FROM library_entries WHERE library_id=?').bind(library.id),
  env.DB.prepare('DELETE FROM library_upload_targets WHERE library_id=?').bind(library.id),
  env.DB.prepare('DELETE FROM library_structure_attempts WHERE library_id=?').bind(library.id),
  env.DB.prepare('DELETE FROM library_nodes WHERE library_id=?').bind(library.id),
  env.DB.prepare('DELETE FROM library_assets WHERE library_id=?').bind(library.id),
  env.DB.prepare("DELETE FROM libraries WHERE id=? AND owner_uid=? AND state='deleting'").bind(library.id,uid),
 ]);
 return false;
}
