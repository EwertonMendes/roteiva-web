import { ApiError, type Env } from './types.ts';
import { context, encrypt } from './crypto.ts';
import { DRIVE_SCOPE, type Tokens } from './google.ts';

export interface GoogleAccount {
  sub: string;
  email: string;
}

/**
 * Validate the granted Drive access with Google's API before persisting an
 * offline credential. Some token responses omit the optional scope field:
 * absence is not proof that the user denied Drive access.
 */
export async function persistDriveConsent(
  env: Env,
  ownerUid: string,
  tokens: Tokens,
  account: GoogleAccount,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  if (typeof tokens.scope === 'string' && tokens.scope.trim() &&
      !tokens.scope.split(/\s+/).includes(DRIVE_SCOPE)) {
    throw new ApiError(409, 'drive_permission_missing');
  }

  const endpoint = new URL('https://www.googleapis.com/drive/v3/about');
  endpoint.searchParams.set('fields', 'user(emailAddress)');
  let response: Response;
  try {
    response = await fetcher(endpoint, {
      headers: {Authorization: 'Bearer ' + tokens.access_token},
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new ApiError(502, 'drive_verification_unavailable');
  }
  if (response.status === 401 || response.status === 403) {
    throw new ApiError(409, 'drive_permission_missing');
  }
  if (!response.ok) throw new ApiError(502, 'drive_verification_unavailable');
  let data: {user?: {emailAddress?: string}};
  try { data = await response.json() as typeof data; }
  catch { throw new ApiError(502, 'drive_verification_unavailable'); }
  if (!data?.user || typeof data.user.emailAddress !== 'string') {
    throw new ApiError(502, 'drive_verification_unavailable');
  }

  // Re-authorization may return no new refresh_token. Preserve an existing
  // connection's encrypted token only for the *same owner and Google account*.
  const old = await env.DB.prepare(
    'SELECT encrypted_refresh_token,status FROM drive_connections WHERE owner_uid=? AND google_account_id=?'
  ).bind(ownerUid, account.sub).first<{
    encrypted_refresh_token: string | null;
    status: string;
  }>();
  const previous = old?.status === 'connected' ? old.encrypted_refresh_token : null;
  if (!tokens.refresh_token && !previous) throw new ApiError(409, 'offline_access_unavailable');

  const encrypted = tokens.refresh_token
    ? await encrypt(env, tokens.refresh_token, context(env, ownerUid, account.sub))
    : previous!;
  const now = Date.now();
  const result = await env.DB.prepare(
    "INSERT INTO drive_connections (id,owner_uid,google_account_id,google_email,encrypted_refresh_token,status,scopes,created_at,updated_at) VALUES (?,?,?,?,?,'connected',?,?,?) " +
    "ON CONFLICT(owner_uid,google_account_id) DO UPDATE SET google_email=excluded.google_email,encrypted_refresh_token=excluded.encrypted_refresh_token,status='connected',scopes=excluded.scopes,revision=drive_connections.revision+1,updated_at=excluded.updated_at " +
    "WHERE drive_connections.status!='revocation_pending'"
  ).bind(
    crypto.randomUUID(), ownerUid, account.sub, account.email, encrypted,
    DRIVE_SCOPE, now, now,
  ).run();
  if (result.meta.changes !== 1) throw new ApiError(409, 'connection_changed');
}
