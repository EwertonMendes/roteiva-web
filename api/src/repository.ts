import { ApiError, type Connection, type Env } from './types.ts';
export async function connection(env: Env, uid: string, id: string): Promise<Connection> {
  const row = await env.DB.prepare('SELECT * FROM drive_connections WHERE id = ? AND owner_uid = ?').bind(id, uid).first<Connection>();
  if (!row) throw new ApiError(404, 'connection_not_found');
  return row;
}
export async function invalidate(env: Env, row: Connection): Promise<void> {
  await env.DB.prepare("UPDATE drive_connections SET status='reconnect_required', encrypted_refresh_token=NULL, revision=revision+1, updated_at=? WHERE id=? AND owner_uid=? AND revision=?")
    .bind(Date.now(), row.id, row.owner_uid, row.revision).run();
}
export async function consumeState(env: Env, state: string, browser: string): Promise<{owner_uid:string; encrypted_verifier:string; nonce:string;scope_mode?:string} | null> {
  return env.DB.prepare('DELETE FROM oauth_transactions WHERE state_hash=? AND browser_hash=? AND expires_at>? RETURNING owner_uid, encrypted_verifier, nonce, scope_mode')
    .bind(state, browser, Date.now()).first();
}
