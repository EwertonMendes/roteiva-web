import { createRemoteJWKSet, jwtVerify } from 'jose';
import { ApiError, type Env } from './types.ts';
import { context, decrypt, encrypt, hash, random } from './crypto.ts';
import { consumeState } from './repository.ts';
import { DRIVE_SCOPE, tokenRequest } from './google.ts';

const googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const COOKIE = '__Host-roteiva-oauth';
const LAUNCH_PATH = '/oauth/drive/launch';

export function enabled(env: Env): void {
  if (env.OAUTH_ENABLED !== 'true' || !env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.TOKEN_KEYS) throw new ApiError(503,'oauth_not_configured');
}

// The authenticated cross-origin fetch only creates an expiring transaction.
// It MUST NOT attempt to set a cookie: browser privacy protections can discard
// cookies delivered by web.app -> workers.dev fetch requests.
export async function start(env: Env, uid: string): Promise<Response> {
  enabled(env);
  const now = Date.now();
  await env.DB.prepare('DELETE FROM oauth_transactions WHERE expires_at<=?').bind(now).run();
  const state = random(), ticket = random(), verifier = random(), nonce = random();
  const stateHash = await hash(state);
  const sealedVerifier = await encrypt(env,verifier,context(env,uid,stateHash,'pkce'));
  const sealedState = await encrypt(env,state,context(env,uid,stateHash,'oauth_state'));
  const insert = await env.DB.prepare(
    "INSERT INTO oauth_transactions (state_hash,owner_uid,browser_hash,encrypted_verifier,nonce,expires_at,created_at,launch_hash,encrypted_state) SELECT ?,?,'',?,?,?,?,?,? WHERE (SELECT count(*) FROM oauth_transactions WHERE owner_uid=? AND created_at>?)<5"
  ).bind(stateHash,uid,sealedVerifier,nonce,now+600000,now,await hash(ticket),sealedState,uid,now-600000).run();
  if (insert.meta.changes !== 1) throw new ApiError(429,'oauth_rate_limited');
  const launchUrl = new URL(LAUNCH_PATH, env.OAUTH_REDIRECT_URI);
  launchUrl.searchParams.set('ticket',ticket);
  return Response.json({launchUrl:launchUrl.toString()});
}

// The browser MUST navigate top-level to this URL (not fetch it or load an
// iframe). Setting a Lax cookie here creates a first-party cookie that is sent
// back on Google's top-level GET callback in browsers blocking third-party cookies.
export async function launch(request: Request, env: Env): Promise<Response> {
  enabled(env);
  const ticket = new URL(request.url).searchParams.get('ticket');
  if (!ticket || !/^[A-Za-z0-9_-]{43}$/.test(ticket)) throw new ApiError(400,'invalid_launch_ticket');
  const browser = random();
  const now = Date.now();
  const tx = await env.DB.prepare(
    'UPDATE oauth_transactions SET browser_hash=?,launch_hash=NULL,launched_at=? WHERE launch_hash=? AND launched_at IS NULL AND expires_at>? RETURNING owner_uid,state_hash,encrypted_state,encrypted_verifier,nonce'
  ).bind(await hash(browser),now,await hash(ticket),now).first<{
    owner_uid:string;state_hash:string;encrypted_state:string;encrypted_verifier:string;nonce:string
  }>();
  if (!tx || !tx.encrypted_state || !tx.encrypted_verifier) throw new ApiError(400,'expired_or_used_launch');
  const state = await decrypt(env,tx.encrypted_state,context(env,tx.owner_uid,tx.state_hash,'oauth_state'));
  const verifier = await decrypt(env,tx.encrypted_verifier,context(env,tx.owner_uid,tx.state_hash,'pkce'));
  const target = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  target.search = new URLSearchParams({
    client_id:env.GOOGLE_CLIENT_ID!, redirect_uri:env.OAUTH_REDIRECT_URI,
    response_type:'code', access_type:'offline', prompt:'consent select_account',
    scope:'openid email ' + DRIVE_SCOPE, state, nonce:tx.nonce,
    code_challenge:await hash(verifier),code_challenge_method:'S256',
  }).toString();
  return new Response(null,{status:303,headers:{
    Location:target.toString(),
    'Set-Cookie':COOKIE+'='+browser+'; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600',
  }});
}

export async function callback(request: Request, env: Env): Promise<Response> {
  enabled(env);
  const url = new URL(request.url);
  const state = url.searchParams.get('state');
  const browser = request.headers.get('Cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);
  if (!state || !/^[A-Za-z0-9_-]{43}$/.test(state) || !browser || !/^[A-Za-z0-9_-]{43}$/.test(browser)) throw new ApiError(400,'invalid_oauth_state');
  const stateHash = await hash(state);
  const tx = await consumeState(env,stateHash,await hash(browser));
  if (!tx) throw new ApiError(400,'expired_or_used_state');
  if (url.searchParams.has('error')) return finish(env,'cancelled');
  const code = url.searchParams.get('code');
  if (!code || code.length > 4096) throw new ApiError(400,'invalid_oauth_code');
  const verifier = await decrypt(env,tx.encrypted_verifier,context(env,tx.owner_uid,stateHash,'pkce'));
  const tokens = await tokenRequest(env,{grant_type:'authorization_code',code,redirect_uri:env.OAUTH_REDIRECT_URI,code_verifier:verifier});
  if (!tokens.refresh_token || !tokens.id_token || !tokens.scope?.split(' ').includes(DRIVE_SCOPE)) throw new ApiError(409,'offline_consent_required');
  const {payload} = await jwtVerify(tokens.id_token,googleKeys,{
    algorithms:['RS256'],issuer:['https://accounts.google.com','accounts.google.com'],
    audience:env.GOOGLE_CLIENT_ID,requiredClaims:['sub','exp','iat','nonce','email'],
  });
  if (payload.nonce !== tx.nonce || !payload.sub || payload.email_verified !== true || typeof payload.email !== 'string') throw new ApiError(400,'invalid_google_identity');
  const encrypted = await encrypt(env,tokens.refresh_token,context(env,tx.owner_uid,payload.sub));
  const now = Date.now();
  await env.DB.prepare("INSERT INTO drive_connections (id,owner_uid,google_account_id,google_email,encrypted_refresh_token,status,scopes,created_at,updated_at) VALUES (?,?,?,?,?,'connected',?,?,?) ON CONFLICT(owner_uid,google_account_id) DO UPDATE SET google_email=excluded.google_email,encrypted_refresh_token=excluded.encrypted_refresh_token,status='connected',scopes=excluded.scopes,revision=drive_connections.revision+1,updated_at=excluded.updated_at")
    .bind(crypto.randomUUID(),tx.owner_uid,payload.sub,payload.email,encrypted,tokens.scope,now,now).run();
  return finish(env,'connected');
}

function finish(env: Env, result: string): Response {
  return new Response(null,{status:303,headers:{
    Location:env.FRONTEND_ORIGIN+'/biblioteca?drive='+result,
    'Set-Cookie':COOKIE+'=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0',
  }});
}
