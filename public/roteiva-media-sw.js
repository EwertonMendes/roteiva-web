/* Authenticated streaming only. No caching, offline behavior, credentials in URLs, or generic proxy. */
const media=new Map();
const origins=new Set(['https://api.roteiva.com','https://roteiva-api-dev.roteiva-dev.workers.dev']);
const path=/^\/library\/projects\/[1-9][0-9]{0,14}\/nodes\/[0-9a-f-]{36}\/content$/;
function target(value){
 let url;try{url=new URL(value);}catch{return null;}
 const review=url.pathname==='/reviews/media'&&/^\?ticket=[A-Za-z0-9_.-]{1,750}$/.test(url.search);
 if(!origins.has(url.origin)||(!review&&(!path.test(url.pathname)||url.search))||url.hash||url.username||url.password)return null;
 return {url:url.href,review};
}
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('message',event=>{
 const source=event.source,data=event.data,port=event.ports[0];
 if(!source?.id||!source.url||new URL(source.url).origin!==self.location.origin||!port)return;
 if(data?.type==='revoke-media'&&typeof data.id==='string'){
 const entry=media.get(data.id);if(entry?.client===source.id)media.delete(data.id);port.postMessage({ok:true});return;
 }
 if(data?.type!=='bind-media'||!/^[-0-9a-f]{36}$/.test(data.id)||typeof data.url!=='string')return;
 const sourceURL=target(data.url);if(!sourceURL)return;
 for(const [id,entry] of media)if(entry.expires<Date.now())media.delete(id);
 if(media.size>=200){port.postMessage({ok:false});return;}
 media.set(data.id,{client:source.id,...sourceURL,expires:Date.now()+20*60*1000});port.postMessage({ok:true});
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
 const range=event.request.headers.get('Range');if(range)headers.set('Range',range);
 try{
 const upstream=await fetch(current.url,{method:event.request.method,headers,credentials:'omit',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(30000)});
 const responseHeaders=new Headers(upstream.headers);responseHeaders.set('Cache-Control','no-store');
 return new Response(upstream.body,{status:upstream.status,headers:responseHeaders});
 }catch{return new Response('O provedor não respondeu. Tente novamente.',{status:503,headers:{'Cache-Control':'no-store'}});}
 })());
});
