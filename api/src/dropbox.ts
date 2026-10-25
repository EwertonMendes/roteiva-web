import {ApiError,type Env} from './types.ts';
import {context,decrypt,encrypt,hash,random} from './crypto.ts';
import {assertActiveAccess} from './access.ts';
import {beginExchange,rememberGrant,finishExchange} from './oauth-guard.ts';
import {assertNoConnectionReviews} from './reviews.ts';
import {validConnectionId,validStorageFileId,validStorageFolderId} from './storage.ts';

type DbxToken={access_token:string;refresh_token?:string;expires_in:number;token_type:string;scope?:string;account_id?:string};
export type DropboxConnection={
 id:string;owner_uid:string;dropbox_account_id:string;dropbox_email:string;scopes:string;
 encrypted_refresh_token:string|null;encrypted_access_token:string|null;
 access_token_expires_at:number;revision:number;status:'connected'|'reconnect_required'|'revocation_pending';
 refresh_lease_id:string|null;refresh_lease_until:number;refresh_retry_after:number;
};
type DropboxMeta={'.tag':'file'|'folder'|'deleted';id?:string;name?:string;size?:number;
 path_display?:string;path_lower?:string;server_modified?:string;is_downloadable?:boolean};
type DropboxAccount={account_id:string;email:string;email_verified:boolean;disabled?:boolean};
export const DROPBOX_SCOPE=['account_info.read','files.metadata.read','files.content.read','files.content.write'];
const CALLBACK='/oauth/dropbox/callback';
const COOKIE='__Host-roteiva-dropbox-oauth';
const ENDPOINT='https://api.dropboxapi.com/2/';
const CONTENT='https://content.dropboxapi.com/2/';
const MAX_PAGE=100;

export function dropboxEnabled(env:Env):void {
 if(env.DROPBOX_ENABLED!=='true'||!env.DROPBOX_APP_KEY||!env.DROPBOX_APP_SECRET||
  !env.DROPBOX_OAUTH_REDIRECT_URI||!env.TOKEN_KEYS||
  new URL(env.DROPBOX_OAUTH_REDIRECT_URI).pathname!==CALLBACK)throw new ApiError(503,'dropbox_not_configured');
}
function positiveSeconds(value:unknown):number {
 return typeof value==='number'&&Number.isFinite(value)&&value>=60&&value<=86400?value:0;
}
/**
 * Dropbox PKCE exchanges authenticate with client_id + code_verifier, not
 * client_secret. The same PKCE grant permits refresh using client_id only.
 * Supplying the confidential-client secret here can select a different OAuth
 * authentication mode (and surface a misleading reconnect_required on the
 * first callback). Never send the secret to Dropbox for this PKCE grant.
 */
async function tokenRequest(env:Env,body:Record<string,string>,fetcher:typeof fetch=fetch):Promise<DbxToken>{
 if(!env.DROPBOX_APP_KEY)throw new ApiError(503,'dropbox_not_configured');
 const operation=body.grant_type==='authorization_code'?'exchange':'refresh';
 let response:Response;
 try{response=await fetcher('https://api.dropboxapi.com/oauth2/token',{
   method:'POST',redirect:'manual',signal:AbortSignal.timeout(12000),
   headers:{'Content-Type':'application/x-www-form-urlencoded'},
   body:new URLSearchParams({...body,client_id:env.DROPBOX_APP_KEY})
 });}catch{throw new ApiError(502,'dropbox_token_unavailable');}
 if(response.status>=300&&response.status<400){await response.body?.cancel();throw new ApiError(502,'dropbox_token_unavailable');}
 const data=await response.json().catch(()=>null) as (DbxToken & {error?:string|{'.tag'?:string}})|null;
 if(!response.ok){
   const providerCode=typeof data?.error==='string'?data.error:
     data?.error&&typeof data.error==='object'?data.error['.tag']:'';
   // Safe metadata only: never log tokens, authorization codes or error_description.
   console.warn(JSON.stringify({event:'dropbox_oauth_token_error',operation,status:response.status,
     category:providerCode==='invalid_client'?'invalid_client':
       providerCode==='invalid_grant'?'invalid_grant':
       providerCode==='invalid_request'?'invalid_request':'other'}));
   if(providerCode==='invalid_client')throw new ApiError(503,'dropbox_app_credentials_invalid');
   if(operation==='exchange'){
     if(providerCode==='invalid_grant')throw new ApiError(409,'dropbox_oauth_code_invalid');
     if(providerCode==='invalid_request')throw new ApiError(502,'dropbox_oauth_exchange_invalid');
     throw new ApiError(502,'dropbox_oauth_exchange_failed');
   }
   if((response.status===400||response.status===401)&&providerCode==='invalid_grant')
     throw new ApiError(409,'dropbox_reconnect_required');
   throw new ApiError(503,'dropbox_token_unavailable');
 }
 if(!data||typeof data.access_token!=='string'||!data.access_token||
   data.token_type?.toLowerCase()!=='bearer'||!positiveSeconds(data.expires_in)||
   (data.refresh_token!==undefined&&(!data.refresh_token||typeof data.refresh_token!=='string')))
  throw new ApiError(502,'dropbox_invalid_response');
 return data;
}
export async function dropboxConnection(env:Env,uid:string,id:string):Promise<DropboxConnection>{
 if(!validConnectionId(id))throw new ApiError(404,'dropbox_connection_not_found');
 const row=await env.DB.prepare('SELECT * FROM dropbox_connections WHERE owner_uid=? AND id=?').bind(uid,id).first<DropboxConnection>();
 if(!row)throw new ApiError(404,'dropbox_connection_not_found');
 return row;
}
function refreshContext(env:Env,row:DropboxConnection):string {
 return context(env,row.owner_uid,row.dropbox_account_id,'dropbox-refresh');
}
function accessContext(env:Env,row:DropboxConnection):string {
 return context(env,row.owner_uid,row.dropbox_account_id,'dropbox-access:'+row.id+':'+row.revision);
}
async function requestDropbox(env:Env,credential:string,action:string,body:unknown=null,fetcher:typeof fetch=fetch):Promise<Response>{
 let response:Response;
 try{response=await fetcher(ENDPOINT+action,{
   method:'POST',redirect:'manual',signal:AbortSignal.timeout(15000),
   headers:{Authorization:'Bearer '+credential,'Content-Type':'application/json'},
   body:JSON.stringify(body)
 });}catch{throw new ApiError(502,'dropbox_unavailable');}
 if(response.status>=300&&response.status<400){await response.body?.cancel();throw new ApiError(502,'dropbox_unavailable');}
 return response;
}
async function jsonDropbox(env:Env,row:DropboxConnection,action:string,body:unknown=null,fetcher:typeof fetch=fetch):Promise<Record<string,unknown>>{
 const credential=await dropboxAccess(env,row,fetcher);
 const response=await requestDropbox(env,credential,action,body,fetcher);
 if(!response.ok){
   const status=response.status;await response.body?.cancel();
   if(status===401)throw new ApiError(409,'dropbox_reconnect_required');
   if(status===403)throw new ApiError(403,'dropbox_access_denied');
   if(status===409)throw new ApiError(404,'dropbox_file_not_found');
   if(status===429)throw new ApiError(429,'dropbox_rate_limited');
   throw new ApiError(502,'dropbox_unavailable');
 }
 const data=await response.json().catch(()=>null);
 if(!data||typeof data!=='object'||Array.isArray(data))throw new ApiError(502,'dropbox_invalid_response');
 return data as Record<string,unknown>;
}
async function rememberConnection(env:Env,uid:string,token:DbxToken,account:DropboxAccount):Promise<void>{
 if(!account.email_verified||account.disabled===true||!/^dbid:[A-Za-z0-9_-]+$/.test(account.account_id)||
  typeof account.email!=='string'||account.email.length>254)throw new ApiError(409,'dropbox_identity_unverified');
 if(!token.scope||DROPBOX_SCOPE.some(s=>!token.scope!.split(' ').includes(s)))throw new ApiError(409,'dropbox_scope_missing');
 const old=await env.DB.prepare('SELECT * FROM dropbox_connections WHERE owner_uid=? AND dropbox_account_id=?')
   .bind(uid,account.account_id).first<DropboxConnection>();
 const previous=old?.status==='connected'?old.encrypted_refresh_token:null;
 if(!token.refresh_token&&!previous)throw new ApiError(409,'dropbox_offline_required');
 const refresh=token.refresh_token?await encrypt(env,token.refresh_token,context(env,uid,account.account_id,'dropbox-refresh')):previous!;
 const ts=Date.now();
 const row:DropboxConnection={id:old?.id||crypto.randomUUID(),owner_uid:uid,dropbox_account_id:account.account_id,
  dropbox_email:account.email,scopes:token.scope,encrypted_refresh_token:refresh,encrypted_access_token:null,
  access_token_expires_at:0,revision:(old?.revision||0)+1,status:'connected',refresh_lease_id:null,refresh_lease_until:0,refresh_retry_after:0};
 const access=await encrypt(env,token.access_token,accessContext(env,row));
 const result=await env.DB.prepare(
  "INSERT INTO dropbox_connections(id,owner_uid,dropbox_account_id,dropbox_email,scopes,encrypted_refresh_token,encrypted_access_token,access_token_expires_at,status,revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,'connected',?,?,?) "+
  "ON CONFLICT(owner_uid,dropbox_account_id) DO UPDATE SET dropbox_email=excluded.dropbox_email,scopes=excluded.scopes,encrypted_refresh_token=excluded.encrypted_refresh_token,encrypted_access_token=excluded.encrypted_access_token,access_token_expires_at=excluded.access_token_expires_at,status='connected',revision=dropbox_connections.revision+1,refresh_lease_id=NULL,refresh_lease_until=0,refresh_retry_after=0,updated_at=excluded.updated_at WHERE dropbox_connections.status!='revocation_pending'"
 ).bind(row.id,uid,account.account_id,account.email,token.scope,refresh,access,ts+token.expires_in*1000,row.revision,ts,ts).run();
 if(result.meta.changes!==1)throw new ApiError(409,'dropbox_connection_changed');
}
/** Short lived cached access credentials, with D1 fenced single-flight refresh. */
export async function dropboxAccess(env:Env,input:DropboxConnection,fetcher:typeof fetch=fetch):Promise<string>{
 const started=Date.now();
 while(Date.now()-started<9000){
  const row=await dropboxConnection(env,input.owner_uid,input.id);
  if(row.status!=='connected'||!row.encrypted_refresh_token)throw new ApiError(409,'dropbox_reconnect_required');
  if(row.encrypted_access_token&&row.access_token_expires_at>Date.now()+60000)
   return decrypt(env,row.encrypted_access_token,accessContext(env,row));
  if(row.refresh_retry_after>Date.now())throw new ApiError(503,'dropbox_refresh_later');
  const lease=crypto.randomUUID(),ts=Date.now();
  const acquired=await env.DB.prepare(
    "UPDATE dropbox_connections SET refresh_lease_id=?,refresh_lease_until=? WHERE owner_uid=? AND id=? AND revision=? AND status='connected' AND refresh_lease_until<?"
  ).bind(lease,ts+15000,row.owner_uid,row.id,row.revision,ts).run();
  if(acquired.meta.changes!==1){await new Promise(resolve=>setTimeout(resolve,130));continue;}
  try{
   const token=await tokenRequest(env,{grant_type:'refresh_token',
      refresh_token:await decrypt(env,row.encrypted_refresh_token,refreshContext(env,row))},fetcher);
   const encrypted=await encrypt(env,token.access_token,accessContext(env,row));
   const update=await env.DB.prepare(
     "UPDATE dropbox_connections SET encrypted_access_token=?,access_token_expires_at=?,refresh_lease_id=NULL,refresh_lease_until=0,refresh_retry_after=0 WHERE owner_uid=? AND id=? AND revision=? AND refresh_lease_id=? AND status='connected'"
   ).bind(encrypted,Date.now()+token.expires_in*1000,row.owner_uid,row.id,row.revision,lease).run();
   if(update.meta.changes!==1)throw new ApiError(409,'dropbox_connection_changed');
   return token.access_token;
  }catch(error){
   const reconnect=error instanceof ApiError&&error.code==='dropbox_reconnect_required';
   await env.DB.prepare(
      "UPDATE dropbox_connections SET refresh_lease_id=NULL,refresh_lease_until=0,refresh_retry_after=?,status=CASE WHEN ? THEN 'reconnect_required' ELSE status END,encrypted_access_token=NULL WHERE owner_uid=? AND id=? AND refresh_lease_id=? AND revision=?"
   ).bind(Date.now()+(reconnect?0:3000),reconnect?1:0,row.owner_uid,row.id,lease,row.revision).run();
   throw error;
  }
 }
 throw new ApiError(503,'dropbox_refresh_busy');
}
export async function dropboxStart(env:Env,uid:string):Promise<Response>{
 dropboxEnabled(env);
 const ts=Date.now();await env.DB.prepare('DELETE FROM dropbox_oauth_transactions WHERE expires_at<?').bind(ts).run();
 const state=random(),ticket=random(),verifier=random(),stateHash=await hash(state);
 const count=await env.DB.prepare('SELECT COUNT(*) AS n FROM dropbox_oauth_transactions WHERE owner_uid=? AND created_at>?')
  .bind(uid,ts-600000).first<{n:number}>();
 if((count?.n||0)>=5)throw new ApiError(429,'oauth_rate_limited');
 await env.DB.prepare('INSERT INTO dropbox_oauth_transactions(state_hash,owner_uid,browser_hash,encrypted_verifier,encrypted_state,launch_hash,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?)')
  .bind(stateHash,uid,'',await encrypt(env,verifier,context(env,uid,stateHash,'dropbox-pkce')),
   await encrypt(env,state,context(env,uid,stateHash,'dropbox-state')),await hash(ticket),ts+600000,ts).run();
 const target=new URL('/oauth/dropbox/launch',env.DROPBOX_OAUTH_REDIRECT_URI);
 target.searchParams.set('ticket',ticket);return Response.json({launchUrl:target.href});
}
export async function dropboxLaunch(request:Request,env:Env):Promise<Response>{
 dropboxEnabled(env);
 const ticket=new URL(request.url).searchParams.get('ticket')||'';
 if(!/^[A-Za-z0-9_-]{43}$/.test(ticket))throw new ApiError(400,'invalid_launch_ticket');
 const browser=random(),ts=Date.now();
 const row=await env.DB.prepare('UPDATE dropbox_oauth_transactions SET browser_hash=?,launch_hash=NULL,launched_at=? WHERE launch_hash=? AND launched_at IS NULL AND expires_at>? RETURNING owner_uid,state_hash,encrypted_state,encrypted_verifier')
  .bind(await hash(browser),ts,await hash(ticket),ts)
  .first<{owner_uid:string;state_hash:string;encrypted_state:string;encrypted_verifier:string}>();
 if(!row)throw new ApiError(400,'expired_or_used_launch');
 await assertActiveAccess(env,row.owner_uid);
 const state=await decrypt(env,row.encrypted_state,context(env,row.owner_uid,row.state_hash,'dropbox-state'));
 const verifier=await decrypt(env,row.encrypted_verifier,context(env,row.owner_uid,row.state_hash,'dropbox-pkce'));
 const target=new URL('https://www.dropbox.com/oauth2/authorize');
 target.search=new URLSearchParams({client_id:env.DROPBOX_APP_KEY!,redirect_uri:env.DROPBOX_OAUTH_REDIRECT_URI!,
  response_type:'code',token_access_type:'offline',state,code_challenge:await hash(verifier),
  code_challenge_method:'S256',scope:DROPBOX_SCOPE.join(' ')}).toString();
 return new Response(null,{status:303,headers:{Location:target.href,
  'Set-Cookie':COOKIE+'='+browser+'; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600'}});
}
function finish(env:Env,status:string):Response{
 return new Response(null,{status:303,headers:{Location:env.FRONTEND_ORIGIN+'/biblioteca?dropbox='+encodeURIComponent(status),
  'Set-Cookie':COOKIE+'=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0'}});
}
export async function dropboxCallback(request:Request,env:Env):Promise<Response>{
 dropboxEnabled(env);
 const url=new URL(request.url),state=url.searchParams.get('state')||'';
 const browser=request.headers.get('Cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);
 if(!/^[A-Za-z0-9_-]{43}$/.test(state)||!browser||!/^[A-Za-z0-9_-]{43}$/.test(browser))throw new ApiError(400,'invalid_oauth_state');
 const stateHash=await hash(state);
 const row=await env.DB.prepare('DELETE FROM dropbox_oauth_transactions WHERE state_hash=? AND browser_hash=? AND expires_at>? RETURNING owner_uid,encrypted_verifier')
  .bind(stateHash,await hash(browser),Date.now()).first<{owner_uid:string;encrypted_verifier:string}>();
 if(!row)throw new ApiError(400,'expired_or_used_state');
 await assertActiveAccess(env,row.owner_uid);
 if(url.searchParams.has('error'))return finish(env,'cancelled');
 const code=url.searchParams.get('code')||'';
 if(!code||code.length>4096)throw new ApiError(400,'invalid_oauth_code');
 let exchangeId:string|undefined;
 try{
  const verifier=await decrypt(env,row.encrypted_verifier,context(env,row.owner_uid,stateHash,'dropbox-pkce'));
  exchangeId=await beginExchange(env,row.owner_uid,'dropbox');
  const tokens=await tokenRequest(env,{grant_type:'authorization_code',code,redirect_uri:env.DROPBOX_OAUTH_REDIRECT_URI!,code_verifier:verifier});
  // Revoke with short-lived bearer; Dropbox also revokes its associated refresh credential.
  await rememberGrant(env,row.owner_uid,exchangeId,tokens.access_token);
  if(!tokens.refresh_token)throw new ApiError(409,'dropbox_offline_required');
  const userResponse=await requestDropbox(env,tokens.access_token,'users/get_current_account',{});
  if(!userResponse.ok)throw new ApiError(409,'dropbox_identity_unverified');
  const account=await userResponse.json().catch(()=>null) as DropboxAccount|null;
  if(!account||tokens.account_id&&tokens.account_id!==account.account_id)throw new ApiError(409,'dropbox_identity_unverified');
  await assertActiveAccess(env,row.owner_uid);
  await rememberConnection(env,row.owner_uid,tokens,account);
  await finishExchange(env,row.owner_uid,exchangeId);
  return finish(env,'connected');
 }catch(error){
  const allowed=new Set(['dropbox_scope_missing','dropbox_offline_required','dropbox_identity_unverified','dropbox_reconnect_required',
   'dropbox_oauth_code_invalid','dropbox_oauth_exchange_invalid','dropbox_oauth_exchange_failed','dropbox_app_credentials_invalid']);
  return finish(env,error instanceof ApiError&&allowed.has(error.code)?error.code:'connection_failed');
 }
}
export async function dropboxConnections(env:Env,uid:string):Promise<Response>{
 const rows=await env.DB.prepare('SELECT id,dropbox_email AS email,status,scopes,updated_at FROM dropbox_connections WHERE owner_uid=? ORDER BY created_at LIMIT 20').bind(uid).all();
 return Response.json({connections:rows.results});
}
export async function dropboxRevoke(env:Env,uid:string,id:string,accountDeletion=false):Promise<Response>{
 const row=await dropboxConnection(env,uid,id);
 await assertNoConnectionReviews(env,uid,id);
 // Do not invalidate credentials until the remote revocation has a chance to run.
 let access:string;
 try{
  if(row.status==='connected'&&!accountDeletion)access=await dropboxAccess(env,row);
  else access=(await tokenRequest(env,{grant_type:'refresh_token',refresh_token:await decrypt(env,row.encrypted_refresh_token!,refreshContext(env,row))})).access_token;
 }catch(error){
  if(error instanceof ApiError&&error.code==='dropbox_reconnect_required')access='';
  else throw error;
 }
 await env.DB.prepare("UPDATE dropbox_connections SET status='revocation_pending',encrypted_access_token=NULL,access_token_expires_at=0,revision=revision+1,updated_at=? WHERE owner_uid=? AND id=?").bind(Date.now(),uid,id).run();
 if(access){
  const response=await requestDropbox(env,access,'auth/token/revoke',{});
  if(!response.ok&&response.status!==401)throw new ApiError(503,'dropbox_revocation_unavailable');
 }
 await env.DB.prepare('DELETE FROM dropbox_upload_attempts WHERE owner_uid=? AND connection_id=?').bind(uid,id).run();
 await env.DB.prepare('DELETE FROM dropbox_connections WHERE owner_uid=? AND id=?').bind(uid,id).run();
 return Response.json({disconnected:true});
}
function mime(name:string):string{
 const ext=name.toLowerCase().split('.').pop();
 const map:Record<string,string>={
  png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',gif:'image/gif',bmp:'image/bmp',svg:'image/svg+xml',
  mp4:'video/mp4',webm:'video/webm',mov:'video/quicktime',m4v:'video/x-m4v',mkv:'video/x-matroska',
  mp3:'audio/mpeg',wav:'audio/wav',ogg:'audio/ogg',flac:'audio/flac',m4a:'audio/mp4',pdf:'application/pdf',
  ppt:'application/vnd.ms-powerpoint',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  pps:'application/vnd.ms-powerpoint',ppsx:'application/vnd.openxmlformats-officedocument.presentationml.slideshow',
  doc:'application/msword',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  odt:'application/vnd.oasis.opendocument.text',odp:'application/vnd.oasis.opendocument.presentation',
  rtf:'application/rtf'
 };
 return map[ext||'']||'application/octet-stream';
}
export function dropboxNormalize(meta:DropboxMeta){
 if(!meta.id||typeof meta.name!=='string'||!validStorageFileId('dropbox',meta.id))return null;
 const folder=meta['.tag']==='folder';
 if(!folder&&meta['.tag']!=='file')return null;
 return {id:meta.id,name:meta.name,mimeType:folder?'application/vnd.roteiva.folder':mime(meta.name),
   isFolder:folder,size:folder?undefined:String(meta.size||0),modifiedTime:meta.server_modified,
   pathDisplay:meta.path_display,pathLower:meta.path_lower,thumbnailFallback:!folder&&/\.(jpe?g|png|gif|webp|bmp|tiff?|pdf)$/i.test(meta.name)};
}
export async function dropboxMetadata(env:Env,uid:string,connectionId:string,fileId:string):Promise<DropboxMeta>{
 if(!validStorageFileId('dropbox',fileId))throw new ApiError(400,'dropbox_invalid_file');
 const row=await dropboxConnection(env,uid,connectionId);
 return await jsonDropbox(env,row,'files/get_metadata',{path:fileId}) as DropboxMeta;
}
/**
 * A final Dropbox list_folder cursor is reusable for future changes. The cursor
 * during pagination is NOT a complete snapshot, so callers must never use it as
 * a synchronization cursor until has_more becomes false.
 */
export async function dropboxList(env:Env,uid:string,connectionId:string,folderId:string,
 page:string|null,search:string|null,changesCursor:string|null=null):Promise<Response>{
 if(!validStorageFolderId('dropbox',folderId,true))throw new ApiError(400,'dropbox_invalid_folder');
 const validCursor=(value:string)=>value.length<=2048&&/^[A-Za-z0-9_-]+$/.test(value);
 if(page&&!validCursor(page)||changesCursor&&!validCursor(changesCursor))
   throw new ApiError(400,'dropbox_invalid_cursor');
 if(search&&(search.length>100||/[\x00-\x1f]/.test(search)))throw new ApiError(400,'invalid_search');
 if(changesCursor&&(page||search))throw new ApiError(400,'dropbox_invalid_cursor');
 const row=await dropboxConnection(env,uid,connectionId);
 if(row.status!=='connected')throw new ApiError(409,'dropbox_reconnect_required');

 if(changesCursor){
   // Only one bounded delta page per request. Never use longpoll or background
   // polling: navigation initiates changes when the short-lived cache is stale.
   const credential=await dropboxAccess(env,row);
   const upstream=await requestDropbox(env,credential,'files/list_folder/continue',{cursor:changesCursor});
   if(!upstream.ok){
     if(upstream.status===409){
       const payload=await upstream.json().catch(()=>null) as
         {error?:{'.tag'?:string};error_summary?:string}|null;
       if(payload?.error?.['.tag']==='reset'||payload?.error_summary?.startsWith('reset/'))
         return Response.json({reset:true});
       if(payload?.error?.['.tag']==='path')throw new ApiError(404,'dropbox_file_not_found');
     }else await upstream.body?.cancel();
     if(upstream.status===401)throw new ApiError(409,'dropbox_reconnect_required');
     if(upstream.status===429)throw new ApiError(429,'dropbox_rate_limited');
     throw new ApiError(502,'dropbox_unavailable');
   }
   const data=await upstream.json().catch(()=>null) as
     {entries?:DropboxMeta[];cursor?:string;has_more?:boolean}|null;
   if(!data||!Array.isArray(data.entries)||typeof data.cursor!=='string'||
      !validCursor(data.cursor)||typeof data.has_more!=='boolean')
      throw new ApiError(502,'dropbox_invalid_response');
   const changes=data.entries.map(entry=>
     entry['.tag']==='deleted'&&typeof entry.path_lower==='string'?
       {deleted:true,pathLower:entry.path_lower}:
       dropboxNormalize(entry)).filter(Boolean);
   return Response.json({reset:false,changes,syncCursor:data.cursor,hasMore:data.has_more});
 }

 const root=folderId==='root';
 // Metadata ownership/type verification and listing are independent Dropbox
 // calls. Execute concurrently to remove one round-trip without skipping checks.
 const metaPromise=root?Promise.resolve(null):
   jsonDropbox(env,row,'files/get_metadata',{path:folderId}) as Promise<DropboxMeta|null>;
 let dataPromise:Promise<Record<string,unknown>>;
 if(search&&search.trim().length>=2){
   dataPromise=page?jsonDropbox(env,row,'files/search/continue_v2',{cursor:page}):
     jsonDropbox(env,row,'files/search_v2',{query:search.trim(),
       options:{path:root?'':folderId,max_results:MAX_PAGE,filename_only:true,file_status:'active'}});
 }else{
   dataPromise=page?jsonDropbox(env,row,'files/list_folder/continue',{cursor:page}):
     jsonDropbox(env,row,'files/list_folder',{path:root?'':folderId,recursive:false,limit:MAX_PAGE,
       include_mounted_folders:true,include_non_downloadable_files:false});
 }
 const [meta,data]=await Promise.all([metaPromise,dataPromise]);
 if(meta&&(meta['.tag']!=='folder'||meta.id!==folderId))
   throw new ApiError(404,'dropbox_file_not_found');
 const folder=root?{id:'root',name:'Meu Dropbox'}:{id:meta!.id!,name:meta!.name!};
 if(search&&search.trim().length>=2){
   const matches=Array.isArray(data.matches)?data.matches as {metadata?:{metadata?:DropboxMeta}}[]:[];
   return Response.json({folder,files:matches.map(a=>dropboxNormalize(a.metadata?.metadata as DropboxMeta)).filter(Boolean),
     nextPageToken:data.has_more===true&&typeof data.cursor==='string'?data.cursor:null,
     syncCursor:null});
 }
 const entries=Array.isArray(data.entries)?data.entries as DropboxMeta[]:[];
 const more=data.has_more===true;
 return Response.json({folder,files:entries.map(dropboxNormalize).filter(Boolean),
   nextPageToken:more&&typeof data.cursor==='string'?data.cursor:null,
   syncCursor:!more&&typeof data.cursor==='string'?data.cursor:null});
}

/** Dropbox content-download uses POST with Dropbox-API-Arg; never expose OAuth bearer. */
export async function dropboxMedia(env:Env,uid:string,connectionId:string,fileId:string,range?:string,fetcher:typeof fetch=fetch):Promise<Response>{
 if(!validStorageFileId('dropbox',fileId))throw new ApiError(404,'dropbox_file_not_found');
 const row=await dropboxConnection(env,uid,connectionId);
 const bearer=await dropboxAccess(env,row,fetcher);
 let response:Response;
 try{response=await fetcher(CONTENT+'files/download',{method:'POST',redirect:'manual',
    signal:AbortSignal.timeout(24000),
    headers:{Authorization:'Bearer '+bearer,'Dropbox-API-Arg':JSON.stringify({path:fileId}),
      ...(range?{Range:range}:{})}});}
 catch{throw new ApiError(502,'media_unavailable');}
 if(response.status>=300&&response.status<400){await response.body?.cancel();throw new ApiError(502,'media_unavailable');}
 if(!response.ok){const st=response.status;await response.body?.cancel();
  throw new ApiError(st===416?416:st===404||st===409?404:502,'media_unavailable');}
 return response;
}

/** Official Dropbox document conversion: produces a PDF for supported Office
 * and presentation formats. Unlike get_thumbnail_v2 (images only), this API
 * is designed for documents. The owner-only signed ticket is checked upstream. */
export async function dropboxDocumentPreview(env:Env,uid:string,connectionId:string,fileId:string,fetcher:typeof fetch=fetch):Promise<Response>{
 if(!validStorageFileId('dropbox',fileId))throw new ApiError(404,'dropbox_file_not_found');
 const row=await dropboxConnection(env,uid,connectionId);
 const bearer=await dropboxAccess(env,row,fetcher);
 let response:Response;
 try{response=await fetcher(CONTENT+'files/get_preview',{
  method:'POST',redirect:'manual',signal:AbortSignal.timeout(30000),
  headers:{Authorization:'Bearer '+bearer,'Dropbox-API-Arg':JSON.stringify({path:fileId})}
 });}catch{throw new ApiError(502,'document_preview_unavailable')}
 if(!response.ok||response.status>=300&&response.status<400){
  const status=response.status;await response.body?.cancel();
  throw new ApiError(status===409||status===415?415:502,'document_preview_unavailable');
 }
 return response;
}

/** Authenticated thumbnails. Dropbox supports only some formats/sizes; never treat a 409 as a fatal file error. */
export async function dropboxThumbnail(env:Env,uid:string,connectionId:string,fileId:string,fetcher:typeof fetch=fetch):Promise<Response>{
 if(!validStorageFileId('dropbox',fileId))throw new ApiError(404,'dropbox_file_not_found');
 const row=await dropboxConnection(env,uid,connectionId);
 const bearer=await dropboxAccess(env,row,fetcher);
 let upstream:Response;
 try{upstream=await fetcher(CONTENT+'files/get_thumbnail_v2',{method:'POST',redirect:'manual',
  signal:AbortSignal.timeout(12000),headers:{
   Authorization:'Bearer '+bearer,
   'Dropbox-API-Arg':JSON.stringify({resource:{'.tag':'path',path:fileId},format:{'.tag':'jpeg'},size:{'.tag':'w256h256'}})
  }});
 }catch{throw new ApiError(502,'dropbox_thumbnail_unavailable')}
 if(!upstream.ok||upstream.status>=300&&upstream.status<400){
  const status=upstream.status;await upstream.body?.cancel();
  if(status===404||status===409||status===415)return new Response(null,{status:204});
  throw new ApiError(502,'dropbox_thumbnail_unavailable');
 }
 const reported=Number(upstream.headers.get('Content-Length')||0);
 if(reported>2*1024*1024){await upstream.body?.cancel();throw new ApiError(413,'dropbox_thumbnail_too_large')}
 let count=0;
 const bounded=upstream.body?.pipeThrough(new TransformStream<Uint8Array,Uint8Array>({
   transform(bytes,controller){count+=bytes.length;if(count>2*1024*1024)throw Error('thumbnail too large');controller.enqueue(bytes)}
 }));
 return new Response(bounded||null,{status:200,headers:{
  'Content-Type':'image/jpeg','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff',
  'Content-Disposition':'inline','Referrer-Policy':'no-referrer'
 }});
}
