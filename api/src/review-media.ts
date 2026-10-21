import {ApiError,type Env} from './types.ts';
import {connection} from './repository.ts';
import {accessCredential} from './google.ts';
import {base64url,decode} from './crypto.ts';

type Ticket={r:string;f:string;v:number;e:number;k:string};
const idPattern=/^[0-9a-f-]{36}$/i;
const filePattern=/^[A-Za-z0-9_-]{10,200}$/;
const encoder=new TextEncoder();
const decoder=new TextDecoder();
const MEDIA_MAX_AGE=12*60*1000;
const GOOGLE='https://www.googleapis.com';

/** Domain-separated HMAC, using the existing encrypted-token keyring (no new secret). */
async function key(env:Env,version:string):Promise<CryptoKey>{
  const keys=JSON.parse(env.TOKEN_KEYS||'{}') as Record<string,string>;
  const material=keys[version];
  if(!material)throw new ApiError(503,'key_unavailable');
  const raw=decode(material);
  if(raw.length!==32)throw new ApiError(503,'invalid_key');
  return crypto.subtle.importKey('raw',raw,{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
}
export async function mintReviewMediaTicket(env:Env,reviewId:string,fileId:string,version:number,expiry:number):Promise<string>{
  const p:Ticket={r:reviewId,f:fileId,v:version,e:Math.min(expiry,Date.now()+MEDIA_MAX_AGE),k:env.TOKEN_KEY_VERSION};
  const payload=base64url(encoder.encode(JSON.stringify(p)));
  const mac=await crypto.subtle.sign('HMAC',await key(env,p.k),encoder.encode('roteiva/review-media/v1/'+payload));
  return payload+'.'+base64url(new Uint8Array(mac));
}
export async function verifyReviewMediaTicket(env:Env,token:string):Promise<Ticket>{
  if(token.length>750||!/^[-_A-Za-z0-9]+\.[-_A-Za-z0-9]+$/.test(token))throw new ApiError(404,'review_not_found');
  const [part,mac]=token.split('.');
  let p:Ticket;
  try{p=JSON.parse(decoder.decode(decode(part))) as Ticket;}catch{throw new ApiError(404,'review_not_found');}
  if(!p||typeof p!=='object'||!idPattern.test(p.r)||!filePattern.test(p.f)||
     !Number.isSafeInteger(p.v)||p.v<1||typeof p.e!=='number'||!Number.isFinite(p.e)||
     p.e<=Date.now()||p.e>Date.now()+MEDIA_MAX_AGE+5000||typeof p.k!=='string'||
     !/^[A-Za-z0-9_-]{1,50}$/.test(p.k))throw new ApiError(404,'review_not_found');
  let verified=false;
  try{verified=await crypto.subtle.verify('HMAC',await key(env,p.k),decode(mac),
    encoder.encode('roteiva/review-media/v1/'+part));}
  catch{throw new ApiError(404,'review_not_found');}
  if(!verified)throw new ApiError(404,'review_not_found');
  return p;
}
/** Stream only an authorized selected video, with single-range access for HTML5 seek.
 * The media ticket is ephemeral; every range request revalidates the review in D1.
 * Never forward Google OAuth credentials on redirects or expose them to the browser.
 */
export async function streamReviewMedia(request:Request,env:Env,url:URL):Promise<Response>{
  if(request.method!=='GET'&&request.method!=='HEAD')throw new ApiError(405,'method_not_allowed');
  const p=await verifyReviewMediaTicket(env,url.searchParams.get('ticket')||'');
  const r=await env.DB.prepare("SELECT id,owner_uid,status,current_version,expires_at FROM review_requests WHERE id=?")
    .bind(p.r).first<{id:string;owner_uid:string;status:string;current_version:number;expires_at:number}>();
  if(!r||r.expires_at<=Date.now()||r.current_version!==p.v||
     !['pending','changes','approved'].includes(r.status))throw new ApiError(404,'review_not_found');
  const asset=await env.DB.prepare("SELECT file_id,connection_id,mime_type FROM review_assets WHERE review_id=? AND version=? AND file_id=? AND grant_state='granted'")
    .bind(p.r,p.v,p.f).first<{file_id:string;connection_id:string;mime_type:string}>();
  if(!asset||!asset.mime_type.startsWith('video/'))throw new ApiError(404,'review_not_found');
  const range=request.headers.get('Range');
  // Single bounded chunks avoid turning a paused preview into a full large-file
  // download through Workers. HTML5 players request more ranges as needed.
  const chunk=8*1024*1024;
  let upstreamRange:string|undefined;
  if(range){
    if(range.length>55)throw new ApiError(416,'media_invalid_range');
    const parsed=/^bytes=(\d+)-(\d*)$/.exec(range);
    const suffix=/^bytes=-(\d+)$/.exec(range);
    if(parsed){
      const start=Number(parsed[1]);
      const requestedEnd=parsed[2]?Number(parsed[2]):start+chunk-1;
      if(!Number.isSafeInteger(start)||!Number.isSafeInteger(requestedEnd)||requestedEnd<start)
        throw new ApiError(416,'media_invalid_range');
      upstreamRange='bytes='+start+'-'+Math.min(requestedEnd,start+chunk-1);
    }else if(suffix){
      const tail=Number(suffix[1]);
      if(!Number.isSafeInteger(tail)||tail<1)throw new ApiError(416,'media_invalid_range');
      upstreamRange='bytes=-'+Math.min(tail,chunk);
    }else throw new ApiError(416,'media_invalid_range');
  }else if(request.method==='GET')upstreamRange='bytes=0-'+(chunk-1);
  const row=await connection(env,r.owner_uid,asset.connection_id);
  const token=await accessCredential(env,row);
  const endpoint=new URL(GOOGLE+'/drive/v3/files/'+encodeURIComponent(asset.file_id));
  endpoint.searchParams.set('alt','media');
  endpoint.searchParams.set('supportsAllDrives','true');
  let upstream:Response;
  try{
    upstream=await fetch(endpoint,{method:request.method,redirect:'manual',signal:AbortSignal.timeout(24000),
      headers:{Authorization:'Bearer '+token.value,...(upstreamRange?{'Range':upstreamRange}:{})}});
  }catch{throw new ApiError(502,'media_unavailable');}
  // No automatic redirects with OAuth bearer: a redirected response can leak
  // tokens to a non-Drive origin. Fall back to the Google Drive iframe instead.
  if(upstream.status>=300&&upstream.status<400){await upstream.body?.cancel();throw new ApiError(502,'media_unavailable');}
  if(!upstream.ok){
    const status=upstream.status;
    await upstream.body?.cancel();
    if(status===401||status===403||status===404)throw new ApiError(404,'media_unavailable');
    throw new ApiError(status===416?416:502,'media_unavailable');
  }
  if(upstreamRange&&upstream.status!==206){await upstream.body?.cancel();throw new ApiError(502,'media_range_unsupported');}
  const headers=new Headers({
    'Content-Type':asset.mime_type,
    'Cache-Control':'private, no-store',
    'X-Content-Type-Options':'nosniff',
    'Accept-Ranges':'bytes',
    'Referrer-Policy':'no-referrer',
    'Cross-Origin-Resource-Policy':'cross-origin',
  });
  for(const header of ['Content-Length','Content-Range','ETag','Last-Modified']){
    const value=upstream.headers.get(header);if(value)headers.set(header,value);
  }
  headers.set('Access-Control-Expose-Headers','Content-Length, Content-Range, Accept-Ranges');
  return new Response(request.method==='HEAD'?null:upstream.body,
    {status:upstream.status,headers});
}
