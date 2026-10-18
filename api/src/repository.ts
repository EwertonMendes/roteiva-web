import { ApiError, type Connection, type Env } from './types.ts';
export async function connection(env: Env, uid: string, id: string): Promise<Connection> {
  const row = await env.DB.prepare('SELECT * FROM drive_connections WHERE id = ? AND owner_uid = ?').bind(id, uid).first<Connection>();
  if (!row) throw new ApiError(404, 'connection_not_found');
  return row;
}
export async function invalidate(env: Env, row: Connection, lease: string): Promise<void> {
  await env.DB.prepare("UPDATE drive_connections SET status='reconnect_required', encrypted_refresh_token=NULL, encrypted_access_token=NULL, access_token_expires_at=0, access_token_version=NULL, refresh_lease_id=NULL, refresh_lease_until=0, refresh_retry_after=0, revision=revision+1, updated_at=? WHERE id=? AND owner_uid=? AND revision=? AND refresh_lease_id=? AND refresh_lease_until>unixepoch()*1000")
    .bind(Date.now(), row.id, row.owner_uid, row.revision, lease).run();
}
export async function consumeState(env: Env, state: string, browser: string): Promise<{owner_uid:string; encrypted_verifier:string; nonce:string} | null> {
  return env.DB.prepare('DELETE FROM oauth_transactions WHERE state_hash=? AND browser_hash=? AND expires_at>? RETURNING owner_uid, encrypted_verifier, nonce')
    .bind(state, browser, Date.now()).first();
}
