/* Authenticated streaming only. No caching, offline behavior, credentials in URLs, or generic proxy. */
const media=new Map();
// Small, short-lived, tab-scoped memory cache for completed video/audio ranges.
// Never writes private bytes to CacheStorage, disk, IndexedDB or CDN. Closing
// a preview preserves a recent chunk; logout/account switch clears everything.
const chunks=new Map();
const CHUNK_TTL=3*60*1000,MAX_CHUNK=8*1024*1024,MAX_CACHED=48*1024*1024;
let cachedBytes=0;
function forget(key){
 const value=chunks.get(key);
 if(value){cachedBytes-=value.data.byteLength;chunks.delete(key);}
}
function clearChunks(){chunks.clear();cachedBytes=0;}
function chunkKey(client,scope,url,range){return JSON.stringify([client,scope,url,range]);}
function getChunk(key){
 const v=chunks.get(key);
 if(!v)return null;
 if(v.expires<Date.now()){forget(key);return null;}
 chunks.delete(key);chunks.set(key,v);return v;
}
function saveChunk(key,response){
 const length=Number(response.headers.get('Content-Length')||0);
 if(response.status!==206||!Number.isSafeInteger(length)||length<1||length>MAX_CHUNK||
    !/^bytes \d+-\d+\/\d+$/.test(response.headers.get('Content-Range')||''))return Promise.resolve();
 return response.arrayBuffer().then(data=>{
  if(data.byteLength!==length)return;
  forget(key);
  chunks.set(key,{data,headers:Array.from(response.headers.entries()),expires:Date.now()+CHUNK_TTL});
  cachedBytes+=length;
  while(cachedBytes>MAX_CACHED){
   const old=chunks.keys().next().value;if(!old)break;forget(old);
  }
 }).catch(()=>{});
}

const origins=new Set(['https://api.roteiva.com','https://roteiva-api-dev.roteiva-dev.workers.dev']);
const path=/^\/library\/projects\/[1-9][0-9]{0,14}\/nodes\/[0-9a-f-]{36}\/content$/;
function target(value){
 let url;try{url=new URL(value);}catch{return null;}
 const review=url.pathname==='/reviews/media'&&/^\?ticket=[A-Za-z0-9_.-]{1,750}$/.test(url.search);
 const owner=/^\/reviews\/[0-9a-f-]{36}\/content$/.test(url.pathname)&&/^\?fileId=(?:id%3A)?[A-Za-z0-9_-]{8,200}$/.test(url.search);
 const local=['http://127.0.0.1:4173','http://127.0.0.1:5173'].includes(self.location.origin)&&url.origin==='http://127.0.0.1:8787';
 if(!origins.has(url.origin)&&!local||(!review&&!owner&&(!path.test(url.pathname)||url.search))||url.hash||url.username||url.password)return null;
 return {url:url.href,review};
}
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('message',event=>{
 const source=event.source,data=event.data,port=event.ports[0];
 if(!source?.id||!source.url||new URL(source.url).origin!==self.location.origin||!port)return;
 if(data?.type==='claim-media-clients'){
  // The cold SPA may be open before this worker becomes its controller.
  // Claiming it explicitly does not grant access to any media; every range
  // still requires the requesting live tab's authorization handshake.
  event.waitUntil(self.clients.claim().then(()=>port.postMessage({ok:true}),()=>port.postMessage({ok:false})));
  return;
 }
 if(data?.type==='clear-media-cache'){
  clearChunks();port.postMessage({ok:true});return;
 }
 if(data?.type==='revoke-media'&&typeof data.id==='string'){
 const entry=media.get(data.id);if(entry?.client===source.id)media.delete(data.id);port.postMessage({ok:true});return;
 }
 if(data?.type!=='bind-media'||!/^[-0-9a-f]{36}$/.test(data.id)||typeof data.url!=='string')return;
 const sourceURL=target(data.url);if(!sourceURL)return;
 for(const [id,entry] of media)if(entry.expires<Date.now())media.delete(id);
 if(media.size>=200){port.postMessage({ok:false});return;}
 media.set(data.id,{client:source.id,...sourceURL,scope:typeof data.scope==='string'&&data.scope.length<=180?data.scope:'',expires:Date.now()+20*60*1000});port.postMessage({ok:true});
});
function deny(){return new Response('Prévia indisponível. Abra o arquivo novamente no Roteiva.',{status:403,headers:{'Cache-Control':'no-store','Content-Type':'text/plain; charset=utf-8'}});}
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 if(url.origin!==self.location.origin||!url.pathname.startsWith('/__roteiva_media/'))return;
 event.respondWith((async()=>{
 const id=url.pathname.slice('/__roteiva_media/'.length),entry=media.get(id);
 if(!/^[-0-9a-f]{36}$/.test(id)||(entry&&entry.client!==event.clientId)||url.search||url.hash||
 !['GET','HEAD'].includes(event.request.method)||event.request.mode==='navigate')return deny();
 const client=await self.clients.get(event.clientId);if(!client)return deny();
 const reply=await new Promise(resolve=>{
 const channel=new MessageChannel(),timer=setTimeout(()=>{channel.port1.close();resolve(null);},5000);
 channel.port1.onmessage=reply=>{clearTimeout(timer);channel.port1.close();resolve(reply.data);};
 client.postMessage({type:'media-authorization',id},[channel.port2]);
 });
 // The browser may stop an idle worker. Rehydrate only from the requesting live tab,
 // which still holds the binding and can refuse after logout/revocation.
 const current=target(reply?.url||entry?.url),token=reply?.authorization;
 if(!current||typeof token!=='string'||token.length>8192||(!token.startsWith('Bearer ')&&!(current.review&&token==='')))return deny();
 const headers=new Headers(token?{Authorization:token}:{});
 if(current.review){if(!/^[A-Za-z0-9_-]{43}$/.test(reply?.reviewSession||''))return deny();headers.set('X-Review-Session',reply.reviewSession);}
 const range=event.request.headers.get('Range');if(range)headers.set('Range',range);
 // A token still comes from the active tab on every read. Cache matching
 // ranges only for a known same-user library binding; never cache review links.
 const key=entry?.scope&&!current.review&&range&&event.request.method==='GET'
  ?chunkKey(event.clientId,entry.scope,current.url,range):null;
 const hit=key?getChunk(key):null;
 if(hit)return new Response(hit.data.slice(0),{status:206,headers:new Headers(hit.headers)});
 try{
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),20000);
 let upstream;
 try{
  upstream=await fetch(current.url,{method:event.request.method,headers,credentials:'omit',cache:'no-store',redirect:'error',signal:controller.signal});
 }finally{
  // A timeout on the whole streamed fetch aborts video midway through playback.
  // Limit header establishment only, not an actively delivered chunk.
  clearTimeout(timer);
 }
 const responseHeaders=new Headers(upstream.headers);responseHeaders.set('Cache-Control','no-store');
 if(key&&upstream.ok&&upstream.status===206){
  // Tee the response: the player streams immediately while the completed
  // chunk becomes reusable on a subsequent seek or reopening.
  const snapshot=upstream.clone();
  const task=saveChunk(key,snapshot);
  event.waitUntil?.(task);
 }
 return new Response(upstream.body,{status:upstream.status,headers:responseHeaders});
 }catch{return new Response('O provedor não respondeu. Tente novamente.',{status:503,headers:{'Cache-Control':'no-store'}});}
 })());
});
