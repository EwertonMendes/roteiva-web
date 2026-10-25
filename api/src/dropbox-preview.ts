import {ApiError,type Env} from './types.ts';
import {base64url,decode} from './crypto.ts';
import {dropboxConnection,dropboxMedia} from './dropbox.ts';
import {assertDropboxFolderLinked,verifyDropboxFile} from './dropbox-uploads.ts';
import {validConnectionId,validStorageFileId,validStorageFolderId} from './storage.ts';
const encoder=new TextEncoder(),decoder=new TextDecoder();
const TTL=12*60*1000;
const CHUNK=8*1024*1024;
type Ticket={u:string;c:string;f:string;l:string;p:number;r:number;e:number;k:string};
async function hmac(env:Env,version:string):Promise<CryptoKey>{
 let secrets:Record<string,string>;
 try{secrets=JSON.parse(env.TOKEN_KEYS||'{}') as Record<string,string>}catch{throw new ApiError(503,'key_unavailable')}
 if(typeof secrets[version]!=='string')throw new ApiError(503,'key_unavailable');
 const raw=decode(secrets[version]);
 if(raw.length!==32)throw new ApiError(503,'key_unavailable');
 return crypto.subtle.importKey('raw',raw,{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
}
function valid(value:unknown):value is Ticket{
 if(!value||typeof value!=='object')return false;
 const p=value as Partial<Ticket>;
 return typeof p.u==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(p.u)&&
 typeof p.c==='string'&&validConnectionId(p.c)&&
 typeof p.f==='string'&&validStorageFileId('dropbox',p.f)&&
 typeof p.l==='string'&&validStorageFolderId('dropbox',p.l,true)&&
 Number.isSafeInteger(p.p)&&p.p!>0&&Number.isSafeInteger(p.r)&&p.r!>0&&
 typeof p.e==='number'&&p.e>Date.now()&&p.e<=Date.now()+TTL+5000&&
 typeof p.k==='string'&&/^[A-Za-z0-9_-]{1,50}$/.test(p.k);
}
async function sign(env:Env,p:Ticket):Promise<string>{
 const data=base64url(encoder.encode(JSON.stringify(p)));
 const sig=await crypto.subtle.sign('HMAC',await hmac(env,p.k),encoder.encode('roteiva/dropbox-owner-media/v1/'+data));
 return data+'.'+base64url(new Uint8Array(sig));
}
async function verify(env:Env,raw:string):Promise<Ticket>{
 if(raw.length>1100||!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(raw))throw new ApiError(404,'media_unavailable');
 const [payload,mac]=raw.split('.');
 // Reject noncanonical base64url aliases: changes to unused pad bits must not
 // produce a second valid spelling for the same signed media ticket.
 let p:unknown,signature:Uint8Array;
 try{
  const data=decode(payload);signature=decode(mac);
  if(base64url(data)!==payload||base64url(signature)!==mac)throw new Error('noncanonical');
  p=JSON.parse(decoder.decode(data));
 }catch{throw new ApiError(404,'media_unavailable')}
 if(!valid(p))throw new ApiError(404,'media_unavailable');
 const ok=await crypto.subtle.verify('HMAC',await hmac(env,p.k),signature,encoder.encode('roteiva/dropbox-owner-media/v1/'+payload)).catch(()=>false);
 if(!ok)throw new ApiError(404,'media_unavailable');
 return p;
}
export async function issueDropboxPreview(env:Env,uid:string,conn:string,request:Request):Promise<Response>{
 const data=await request.json().catch(()=>null) as {fileId?:unknown;projectId?:unknown;linkedFolderId?:unknown}|null;
 if(!data||typeof data.fileId!=='string'||!validStorageFileId('dropbox',data.fileId)||
 typeof data.linkedFolderId!=='string'||!validStorageFolderId('dropbox',data.linkedFolderId,true)||
 !Number.isSafeInteger(data.projectId)||!(Number(data.projectId)>0))
  throw new ApiError(400,'dropbox_invalid_preview');
 const bearer=request.headers.get('Authorization')?.slice(7)||'';
 await assertDropboxFolderLinked(env,uid,bearer,conn,Number(data.projectId),data.linkedFolderId);
 const meta=await verifyDropboxFile(env,uid,conn,data.linkedFolderId,data.fileId);
 if(meta.mimeType.startsWith('image/')&&meta.size>24*1024*1024)
  throw new ApiError(413,'dropbox_preview_too_large');
 const row=await dropboxConnection(env,uid,conn);
 if(row.status!=='connected')throw new ApiError(409,'dropbox_reconnect_required');
 const expiresAt=Date.now()+TTL;
 const token=await sign(env,{u:uid,c:conn,f:data.fileId,l:data.linkedFolderId,p:Number(data.projectId),
  r:row.revision,e:expiresAt,k:env.TOKEN_KEY_VERSION});
 return Response.json({url:'https://roteiva-api-dev.ewertonmendes9.workers.dev/integrations/dropbox/media?ticket='+token,
   expiresAt,mimeType:meta.mimeType,size:meta.size});
}
function parseRange(range:string|null,size:number,partialOnNoRange:boolean):string|undefined{
 if(!range)return partialOnNoRange&&size>CHUNK?'bytes=0-'+(CHUNK-1):undefined;
 if(range.length>55)throw new ApiError(416,'media_invalid_range');
 const startEnd=/^bytes=(\d+)-(\d*)$/.exec(range);
 if(startEnd){
  const start=Number(startEnd[1]),end=startEnd[2]?Number(startEnd[2]):start+CHUNK-1;
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||end<start||start>=size)
   throw new ApiError(416,'media_invalid_range');
  return 'bytes='+start+'-'+Math.min(end,start+CHUNK-1,size-1);
 }
 const suffix=/^bytes=-(\d+)$/.exec(range);
 if(suffix){
  const count=Number(suffix[1]);
  if(!Number.isSafeInteger(count)||count<1)throw new ApiError(416,'media_invalid_range');
  return 'bytes=-'+Math.min(count,CHUNK,size);
 }
 throw new ApiError(416,'media_invalid_range');
}
export async function streamDropboxPreview(env:Env,request:Request,url:URL):Promise<Response>{
 if(request.method!=='GET'&&request.method!=='HEAD')throw new ApiError(405,'method_not_allowed');
 if(request.headers.get('Sec-Fetch-Mode')==='navigate'&&request.headers.get('Sec-Fetch-Dest')==='document')
  throw new ApiError(404,'media_unavailable');
 const ticket=await verify(env,url.searchParams.get('ticket')||'');
 const connection=await dropboxConnection(env,ticket.u,ticket.c);
 if(connection.status!=='connected'||connection.revision!==ticket.r)throw new ApiError(404,'media_unavailable');
 const meta=await verifyDropboxFile(env,ticket.u,ticket.c,ticket.l,ticket.f);
 const range=parseRange(request.headers.get('Range'),meta.size,
  meta.mimeType.startsWith('video/')||meta.mimeType.startsWith('audio/')||meta.mimeType==='application/pdf');
 const response=await dropboxMedia(env,ticket.u,ticket.c,ticket.f,range);
 if(range&&response.status!==206){await response.body?.cancel();throw new ApiError(502,'media_range_unsupported')}
 const headers=new Headers({'Content-Type':meta.mimeType,'Accept-Ranges':'bytes',
   'Cache-Control':'private, no-store','Content-Disposition':'inline',
   'Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff',
   'Cross-Origin-Resource-Policy':'cross-origin'});
 if(meta.mimeType==='image/svg+xml')headers.set('Content-Security-Policy',"sandbox; default-src 'none'");
 for(const key of ['Content-Length','Content-Range','ETag','Last-Modified']){
  const x=response.headers.get(key);if(x)headers.set(key,x);
 }
 headers.set('Access-Control-Expose-Headers','Content-Length, Content-Range, Accept-Ranges');
 if(request.method==='HEAD'){await response.body?.cancel();return new Response(null,{status:response.status,headers})}
 return new Response(response.body,{status:response.status,headers});
}
