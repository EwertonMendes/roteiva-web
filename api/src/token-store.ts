import { ApiError, type Connection, type Env } from './types.ts';

export interface TokenConnection extends Connection {
  encrypted_access_token: string | null;
  access_token_expires_at: number;
  access_token_version: string | null;
  refresh_lease_id: string | null;
  refresh_lease_until: number;
  refresh_retry_after: number;
}
const CLOCK = "unixepoch()*1000";

export async function loadTokenConnection(env: Env, owner: string, id: string): Promise<TokenConnection> {
  const row = await env.DB.prepare('SELECT * FROM drive_connections WHERE id=? AND owner_uid=?')
    .bind(id,owner).first<TokenConnection>();
  if (!row) throw new ApiError(404,'connection_not_found');
  if (row.status !== 'connected' || !row.encrypted_refresh_token) throw new ApiError(409,'reconnect_required');
  return row;
}

export async function acquireRefresh(env: Env, row: TokenConnection, lease: string): Promise<boolean> {
  const result = await env.DB.prepare(
    `UPDATE drive_connections SET refresh_lease_id=?,refresh_lease_until=${CLOCK}+20000
     WHERE id=? AND owner_uid=? AND revision=? AND status='connected'
       AND refresh_lease_until<=${CLOCK} AND refresh_retry_after<=${CLOCK}`
  ).bind(lease,row.id,row.owner_uid,row.revision).run();
  return result.meta.changes === 1;
}

export async function publishToken(env: Env, row: TokenConnection, lease: string,
  encryptedAccess: string, expiry: number, version: string, encryptedRefresh: string | null): Promise<boolean> {
  const result = await env.DB.prepare(
    `UPDATE drive_connections SET encrypted_access_token=?,access_token_expires_at=?,access_token_version=?,
       encrypted_refresh_token=COALESCE(?,encrypted_refresh_token),revision=revision+?,
       refresh_lease_id=NULL,refresh_lease_until=0,refresh_retry_after=0,updated_at=?
     WHERE id=? AND owner_uid=? AND revision=? AND status='connected'
       AND refresh_lease_id=? AND refresh_lease_until>${CLOCK}`
  ).bind(encryptedAccess,expiry,version,encryptedRefresh,encryptedRefresh ? 1 : 0,Date.now(),
    row.id,row.owner_uid,row.revision,lease).run();
  return result.meta.changes === 1;
}

export async function releaseRefresh(env: Env, row: TokenConnection, lease: string, cooldownSeconds = 0): Promise<void> {
  await env.DB.prepare(
    `UPDATE drive_connections SET refresh_lease_id=NULL,refresh_lease_until=0,
       refresh_retry_after=CASE WHEN ?>0 THEN ${CLOCK}+?*1000 ELSE 0 END
     WHERE id=? AND owner_uid=? AND revision=? AND refresh_lease_id=?`
  ).bind(cooldownSeconds,cooldownSeconds,row.id,row.owner_uid,row.revision,lease).run();
}

export async function rejectCachedToken(env: Env, row: Connection, version: string): Promise<void> {
  // A late 401 for token A must never evict replacement token B.
  await env.DB.prepare(
    'UPDATE drive_connections SET encrypted_access_token=NULL,access_token_expires_at=0,access_token_version=NULL WHERE id=? AND owner_uid=? AND access_token_version=?'
  ).bind(row.id,row.owner_uid,version).run();
}
