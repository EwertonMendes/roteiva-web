import { ApiError, type Env } from './types.ts';
import { connection } from './repository.ts';
import { driveJson } from './drive-client.ts';
import { context, decrypt } from './crypto.ts';
export async function metadata(env: Env, uid: string, connectionId: string, fileId: string): Promise<Response> {
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(fileId)) throw new ApiError(400,'invalid_file_id');
  const row = await connection(env,uid,connectionId);
  const target = new URL('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(fileId));
  target.searchParams.set('fields','id,name,mimeType,size,modifiedTime');
  return Response.json({file:await driveJson(env,row,target,fetch,'file_unavailable')});
}
export async function disconnect(env: Env, uid: string, connectionId: string): Promise<Response> {
  const row = await connection(env,uid,connectionId);
  // Block future refresh before revocation. Preserve ciphertext only for a bounded manual retry.
  const result = await env.DB.prepare("UPDATE drive_connections SET status='revocation_pending',encrypted_access_token=NULL,access_token_expires_at=0,access_token_version=NULL,refresh_lease_id=NULL,refresh_lease_until=0,refresh_retry_after=0,revision=revision+1,updated_at=? WHERE id=? AND owner_uid=? AND revision=?")
    .bind(Date.now(),row.id,uid,row.revision).run();
  if (result.meta.changes !== 1) throw new ApiError(409,'connection_changed');
  if (row.encrypted_refresh_token) {
    const token = await decrypt(env,row.encrypted_refresh_token,context(env,uid,row.google_account_id));
    const response = await fetch('https://oauth2.googleapis.com/revoke',{
      method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({token}),signal:AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      // Google invalid_token means the credential is already revoked.
      const body = await response.json().catch(()=>({})) as {error?:string};
      if (body.error !== 'invalid_token') throw new ApiError(502,'revocation_pending');
    }
  }
  await env.DB.prepare('DELETE FROM drive_connections WHERE id=? AND owner_uid=? AND revision=?')
    .bind(row.id,uid,row.revision+1).run();
  return Response.json({status:'disconnected'});
}

/** Minimal account-level Drive read for the OAuth PoC. No file contents. */
export async function about(env: Env, uid: string, connectionId: string, fetcher: typeof fetch = fetch): Promise<Response> {
  const row = await connection(env,uid,connectionId);
  const target = new URL('https://www.googleapis.com/drive/v3/about');
  target.searchParams.set('fields','user(displayName,emailAddress)');
  const details = await driveJson(env,row,target,fetcher) as {user?:{displayName?:string;emailAddress?:string}};
  return Response.json({user:{
    displayName:typeof details.user?.displayName==='string'?details.user.displayName:'',
    emailAddress:typeof details.user?.emailAddress==='string'?details.user.emailAddress:'',
  }});
}
