import { ApiError, type Connection, type Env } from './types.ts';
import { context, decrypt, encrypt } from './crypto.ts';
import { invalidate } from './repository.ts';
import { acquireRefresh, loadTokenConnection, publishToken, releaseRefresh, type TokenConnection } from './token-store.ts';
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const DRIVE_READ_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
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
  // Google's OAuth error code is a finite vocabulary. Never log provider bodies,
  // token URLs, headers, credentials, or descriptions from untrusted responses.
  const result = await response.json().catch(()=>null) as (Tokens & {error?:string}) | null;
  if (!response.ok) {
    const reason = typeof result?.error === 'string' ? result.error : '';
    if (reason === 'invalid_grant' || reason === 'invalid_rapt') throw new ApiError(409,'reconnect_required');
    if (reason === 'invalid_client' || reason === 'unauthorized_client') throw new ApiError(503,'google_oauth_client_invalid');
    if (reason === 'invalid_scope' || reason === 'unsupported_grant_type' || reason === 'invalid_request')
      throw new ApiError(503,'google_oauth_request_invalid');
    if (response.status === 429 || response.status === 503 || response.status === 502 || response.status === 500)
      throw new ApiError(503,'google_temporarily_unavailable');
    if (response.status >= 400 && response.status < 500) throw new ApiError(503,'google_oauth_rejected');
    throw new ApiError(502,'google_unavailable');
  }
  if (!result || typeof result.access_token !== 'string' || !result.access_token ||
      result.token_type?.toLowerCase() !== 'bearer' || !Number.isFinite(result.expires_in) ||
      result.expires_in <= 0 || result.expires_in > 86400 ||
      (result.refresh_token !== undefined && (typeof result.refresh_token !== 'string' || !result.refresh_token))) {
    throw new ApiError(502,'invalid_google_response');
  }
  return result;
}

export interface AccessCredential { value: string; version: string; expiresAt: number; }
const MARGIN_MS = 60000;
const WAIT_MS = 8000;
function metric(outcome: string, started: number): void {
  console.info(JSON.stringify({event:'drive_token_cache',outcome,durationMs:Date.now()-started}));
}
function accessContext(env: Env, row: Connection, version: string): string {
  return context(env,row.owner_uid,row.google_account_id,'access:'+row.id+':'+row.revision+':'+version);
}
async function cached(env: Env, row: TokenConnection): Promise<AccessCredential | null> {
  if (!row.encrypted_access_token || !row.access_token_version || row.access_token_expires_at <= Date.now()+MARGIN_MS) return null;
  return {
    value:await decrypt(env,row.encrypted_access_token,accessContext(env,row,row.access_token_version)),
    version:row.access_token_version,expiresAt:row.access_token_expires_at,
  };
}

export async function accessCredential(env: Env, input: Connection, fetcher: typeof fetch = fetch): Promise<AccessCredential> {
  const started = Date.now();
  let attempt = 0;
  while (true) {
    // Reload even if caller supplied a stale row: status/revision are authoritative in D1.
    const row = await loadTokenConnection(env,input.owner_uid,input.id);
    const hit = await cached(env,row);
    if (hit) { metric(attempt ? 'hit_after_wait' : 'hit',started); return hit; }
    if (row.refresh_retry_after > Date.now()) throw new ApiError(503,'token_refresh_retry_later');
    const lease = crypto.randomUUID();
    if (row.refresh_lease_until <= Date.now() && await acquireRefresh(env,row,lease)) {
      // The conditional write fences concurrent disconnect/reconnect and expired leases.
      metric('refresh_started',started);
      let rotated = false;
      let published = false;
      try {
        const requestStarted = Date.now();
        const token = await tokenRequest(env,{
          grant_type:'refresh_token',
          refresh_token:await decrypt(env,row.encrypted_refresh_token!,context(env,row.owner_uid,row.google_account_id)),
        },fetcher);
        const version = crypto.randomUUID();
        rotated = Boolean(token.refresh_token);
        const revision = row.revision+(rotated ? 1 : 0);
        const expiry = requestStarted+Math.floor(token.expires_in*1000);
        // Extremely short-lived or delayed tokens cannot satisfy the caller's safety margin.
        if (expiry <= Date.now()+MARGIN_MS) throw new ApiError(502,'invalid_google_response');
        const encryptedAccess = await encrypt(env,token.access_token,accessContext(env,{...row,revision},version));
        const encryptedRefresh = token.refresh_token
          ? await encrypt(env,token.refresh_token,context(env,row.owner_uid,row.google_account_id)) : null;
        published = await publishToken(env,row,lease,encryptedAccess,expiry,version,encryptedRefresh);
        if (!published) throw new ApiError(409,'connection_changed');
        metric('refresh_succeeded',started);
        return {value:token.access_token,version,expiresAt:expiry};
      } catch (error) {
        metric('refresh_failed',started);
        if (error instanceof ApiError && error.code === 'reconnect_required') {
          // Revision guard prevents an old invalid_grant invalidating a new consent.
          if (!await invalidate(env,row,lease)) {
            const current = await loadTokenConnection(env,input.owner_uid,input.id);
            const replacement = await cached(env,current);
            if (replacement) { metric('hit_after_race',started); return replacement; }
            throw new ApiError(409,'connection_changed');
          }
        }
        throw error;
      } finally {
        // Never release a successor's lease. A lost publish does not restore old credentials.
        if (!published) await releaseRefresh(env,row,lease,rotated ? 5 : 2);
      }
    }
    if (Date.now()-started >= WAIT_MS) {
      metric('wait_timeout',started);
      throw new ApiError(503,'token_refresh_busy');
    }
    // Bounded polling, no dependency on isolate-local state and no work after response.
    await new Promise(resolve=>setTimeout(resolve,Math.min(100*2**attempt++,1000)));
  }
}

/** Compatibility helper for backend-only consumers; HTTP routes use driveJson(). */
export async function accessToken(env: Env, row: Connection, fetcher: typeof fetch = fetch): Promise<string> {
  return (await accessCredential(env,row,fetcher)).value;
}
