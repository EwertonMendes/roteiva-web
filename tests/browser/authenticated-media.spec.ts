import {test,expect} from '@playwright/test';
import {withMediaServer} from './media-fixture';
const origin='http://127.0.0.1:4173';
test('native media transport binds the URL to its tab and forwards authenticated ranges',async({page,context})=>{
 await withMediaServer(async received=>{
 await page.goto(origin+'/sobre.html');
 const url=await page.evaluate(async()=>{
 await navigator.serviceWorker.register('/roteiva-media-sw.js',{scope:'/'});
 await navigator.serviceWorker.ready;
 if(!navigator.serviceWorker.controller)await new Promise<void>(resolve=>navigator.serviceWorker.addEventListener('controllerchange',()=>resolve(),{once:true}));
 navigator.serviceWorker.addEventListener('message',event=>{if(event.data?.type==='media-authorization')event.ports[0].postMessage({authorization:'Bearer browser-synthetic'});});
 const id=crypto.randomUUID(),channel=new MessageChannel();
 const ready=new Promise<void>((resolve,reject)=>{channel.port1.onmessage=e=>{channel.port1.close();e.data.ok?resolve():reject(new Error('binding failed'));};});
 navigator.serviceWorker.controller!.postMessage({type:'bind-media',id,url:'http://127.0.0.1:8787/library/projects/17/nodes/aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa/content'},[channel.port2]);
 await ready;return '/__roteiva_media/'+id;
 });
 const first=await page.evaluate(async url=>{const r=await fetch(url,{headers:{Range:'bytes=0-3'}});return {status:r.status,body:await r.text(),range:r.headers.get('Content-Range')};},url);
 expect(first).toEqual({status:206,body:'test',range:'bytes 0-3/4'});expect(received).toHaveLength(1);
 const other=await context.newPage();await other.goto(origin+'/sobre.html');
 const denied=await other.evaluate(async url=>(await fetch(url)).status,url);expect(denied).toBe(403);expect(received).toHaveLength(1);
 await page.evaluate(async url=>{
 const channel=new MessageChannel();const done=new Promise<void>(resolve=>{channel.port1.onmessage=()=>{channel.port1.close();resolve();};});
 navigator.serviceWorker.controller!.postMessage({type:'revoke-media',id:url.split('/').at(-1)},[channel.port2]);await done;
 },url);
 expect(await page.evaluate(async url=>(await fetch(url)).status,url)).toBe(403);
 });
});
