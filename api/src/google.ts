import { ApiError, type Connection, type Env } from './types.ts';
import { context, decrypt, encrypt } from './crypto.ts';
import { invalidate } from './repository.ts';
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export interface Tokens { access_token: string; refresh_token?: string; id_token?: string; scope?: string; token_type:string; expires_in:number; }
export async function tokenRequest(env: Env, fields: Record<string,string>, fetcher: typeof fetch = fetch): Promise<Tokens> {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) throw new ApiError(503,'oauth_not_configured');
  let response: Response;
  try {
    response = await fetcher('https://oauth2.googleapis.com/token', {
      method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({...fields, client_id:env.GOOGLE_CLIENT_ID, client_secret:env.GOOGLE_CLIENT_SECRET}),
      signal:AbortSignal.timeout(10000),
    });
  } catch { throw new ApiError(502,'google_unavailable'); }
  const result = await response.json() as Tokens & {error?:string};
  if (!response.ok) throw new ApiError(result.error === 'invalid_grant' ? 409 : 502, result.error === 'invalid_grant' ? 'reconnect_required' : 'google_unavailable');
  if (!result.access_token || result.token_type?.toLowerCase() !== 'bearer' || !Number.isFinite(result.expires_in) || result.expires_in <= 0) throw new ApiError(502,'invalid_google_response');
  return result;
}
export async function accessToken(env: Env, row: Connection, fetcher: typeof fetch = fetch): Promise<string> {
  if (row.status !== 'connected' || !row.encrypted_refresh_token) throw new ApiError(409,'reconnect_required');
  const aad = context(env, row.owner_uid, row.google_account_id);
  try {
    const token = await tokenRequest(env, {grant_type:'refresh_token',refresh_token:await decrypt(env,row.encrypted_refresh_token,aad)}, fetcher);
    if (token.refresh_token) {
      const encrypted = await encrypt(env, token.refresh_token, aad);
      const update = await env.DB.prepare('UPDATE drive_connections SET encrypted_refresh_token=?, revision=revision+1, updated_at=? WHERE id=? AND owner_uid=? AND revision=? AND status=\'connected\'')
        .bind(encrypted, Date.now(), row.id, row.owner_uid, row.revision).run();
      if (update.meta.changes !== 1) throw new ApiError(409,'connection_changed');
    }
    // Never persist or return this token to a public HTTP caller.
    return token.access_token;
  } catch (error) {
    if (error instanceof ApiError && error.code === 'reconnect_required') await invalidate(env,row);
    throw error;
  }
}
