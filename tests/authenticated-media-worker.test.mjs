import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {environments} from '../shared/environments.ts';
const source=readFileSync(new URL('../public/roteiva-media-sw.js',import.meta.url),'utf8');
const origin='https://app.roteiva.com',id='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
test('media worker origin allowlist matches the environment contract',()=>{
 for(const env of Object.values(environments))assert.ok(source.includes(env.apiOrigin));
});
function fixture(fetchImpl){
 const events={},requests=[],state={claims:0,tasks:[]};
 const client={id:'alice-tab',url:origin+'/biblioteca',sourceURL:undefined,reviewSession:undefined,postMessage(data,ports){ports[0].postMessage({authorization:'Bearer synthetic-identity',reviewSession:this.reviewSession,url:this.sourceURL});ports[0].close();}};
 const self={location:{origin},addEventListener:(kind,handler)=>events[kind]=handler,clients:{get:async key=>key===client.id?client:null,claim:async()=>{state.claims++;}},skipWaiting:async()=>{}};
 vm.runInNewContext(source,{self,URL,Response,Headers,Map,Set,Date,MessageChannel,setTimeout,clearTimeout,AbortSignal,AbortController,
 fetch:async(url,options)=>{requests.push({url,options});return fetchImpl?fetchImpl(url,options):new Response('test',{status:206,headers:{'Content-Range':'bytes 0-3/4','Content-Length':'4'}});}});
 const bind=(data,who=client)=>{let ack;events.message({source:who,data,ports:[{postMessage:value=>ack=value}]});return ack;};
 const read=async(who='alice-tab',options={})=>{let pending;events.fetch({clientId:who,request:{url:origin+'/__roteiva_media/'+id,method:'GET',mode:'cors',headers:new Headers({Range:'bytes=0-3'}),...options},respondWith:p=>pending=p,waitUntil:p=>state.tasks.push(p)});return pending;};
 return {events,requests,bind,read,client,state};
}
test('media streaming forwards range and identity only for the binding tab',async()=>{
 const f=fixture();assert.equal(f.bind({type:'bind-media',id,url:'https://api.roteiva.com/library/projects/17/nodes/'+id+'/content'}).ok,true);
 assert.equal((await f.read('other-tab')).status,403);assert.equal(f.requests.length,0);
 const r=await f.read();assert.equal(r.status,206);assert.equal(await r.text(),'test');
 assert.equal(f.requests[0].options.headers.get('Authorization'),'Bearer synthetic-identity');
 assert.equal(f.requests[0].options.headers.get('Range'),'bytes=0-3');
 assert.equal(f.requests[0].options.credentials,'omit');assert.equal(f.requests[0].options.redirect,'error');
 assert.equal(r.headers.get('Cache-Control'),'no-store');
 f.bind({type:'revoke-media',id});assert.equal((await f.read()).status,403);
});
test('worker rejects arbitrary URLs, missing mappings and document navigation',async()=>{
 const f=fixture();
 for(const url of ['https://evil.example/library/projects/17/nodes/'+id+'/content','https://api.roteiva.com/access/ensure','https://api.roteiva.com/library/projects/17/nodes/'+id+'/content?token=secret'])
 assert.equal(f.bind({type:'bind-media',id,url}),undefined);
 assert.equal((await f.read()).status,403);
 f.bind({type:'bind-media',id,url:'https://api.roteiva.com/library/projects/17/nodes/'+id+'/content'});
 assert.equal((await f.read('alice-tab',{mode:'navigate'})).status,403);
 assert.equal((await f.read('alice-tab',{method:'POST'})).status,403);assert.equal(f.requests.length,0);
 let intercepted=false;f.events.fetch({request:{url:origin+'/assets/app.js'},respondWith:()=>intercepted=true});assert.equal(intercepted,false);
});
test('an idle worker can recover a binding only from its live requesting tab',async()=>{
 const f=fixture();f.client.sourceURL='https://api.roteiva.com/library/projects/17/nodes/'+id+'/content';
 const response=await f.read();assert.equal(response.status,206);assert.equal(await response.text(),'test');
 assert.equal((await f.read('other-tab')).status,403);assert.equal(f.requests.length,1);
 f.client.sourceURL=undefined;assert.equal((await f.read()).status,403);
});
test('review streaming requires the live tab session as well as the signed ticket',async()=>{
 const f=fixture(),url='https://api.roteiva.com/reviews/media?ticket=synthetic.ticket';
 f.client.sourceURL=url;f.bind({type:'bind-media',id,url});
 assert.equal((await f.read()).status,403);assert.equal(f.requests.length,0);
 f.client.reviewSession='a'.repeat(43);
 assert.equal((await f.read()).status,206);
 assert.equal(f.requests[0].options.headers.get('X-Review-Session'),'a'.repeat(43));
 assert.equal((await f.read('other-tab')).status,403);
});

test('a cold active worker can explicitly claim its same-origin page before media is bound',async()=>{
 const f=fixture();
 let result,pending;
 f.events.message({
  source:f.client,
  data:{type:'claim-media-clients'},
  ports:[{postMessage:value=>result=value}],
  waitUntil:value=>{pending=value;}
 });
 assert.ok(pending,'the claim must remain alive through the service worker event');
 await pending;
 assert.equal(result?.ok,true);
 assert.equal(f.state.claims,1);
 assert.equal(f.requests.length,0,'claim must not fetch protected bytes or mint credentials');
});

test('the playback transport exposes only friendly messages to end users',()=>{
 const app=readFileSync(new URL('../src/features/drive/authenticated-media.ts',import.meta.url),'utf8');
 assert.ok(app.includes('Não foi possível abrir este arquivo agora. Tente novamente.'));
 assert.equal(app.includes('Verifique se os Service Workers estão habilitados'),false);
 assert.ok(app.includes('mediaProtocol=5'));
});

test('completed ranges are reused on reopen without another provider call, then cleared at logout',async()=>{
 const f=fixture(),url='https://api.roteiva.com/library/projects/17/nodes/'+id+'/content';
 const first='bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
 assert.equal(f.bind({type:'bind-media',id,url,scope:'uid-alice'}).ok,true);
 const original=await f.read();assert.equal(original.status,206);assert.equal(await original.text(),'test');
 await Promise.all(f.state.tasks);
 assert.equal(f.requests.length,1);
 // Closing a modal revokes only its binding, not the short-lived private chunks.
 f.bind({type:'revoke-media',id});
 assert.equal(f.bind({type:'bind-media',id,url,scope:'uid-alice'}).ok,true);
 const cached=await f.read();assert.equal(cached.status,206);assert.equal(await cached.text(),'test');
 assert.equal(f.requests.length,1,'a replayed range should not repeat the network request');
 assert.equal(f.bind({type:'clear-media-cache'}).ok,true);
 const again=await f.read();assert.equal(await again.text(),'test');
 assert.equal(f.requests.length,2,'logout must force a fresh download');
 await Promise.all(f.state.tasks);
});

test('in-memory chunks never cross client IDs or account scopes',async()=>{
 const f=fixture(),url='https://api.roteiva.com/library/projects/17/nodes/'+id+'/content';
 f.bind({type:'bind-media',id,url,scope:'first-owner'});
 assert.equal(await (await f.read()).text(),'test');await Promise.all(f.state.tasks);
 f.bind({type:'revoke-media',id});f.bind({type:'bind-media',id,url,scope:'other-owner'});
 assert.equal(await (await f.read()).text(),'test');
 assert.equal(f.requests.length,2,'a different signed-in owner must not receive cached bytes');
 assert.equal((await f.read('other-tab')).status,403);
});

test('a large progressive movie must NEVER clone an unconsumed response stream',async()=>{
 // An unconsumed clone is an unbounded tee branch and can OOM an idle worker.
 // Test the actual fetch handler, not merely a source-code string.
 const large=16*1024*1024,first=8*1024*1024;
 let cloneAttempts=0;
 const f=fixture(async()=>{
  const response=new Response(new ReadableStream({
   start(controller){controller.enqueue(new TextEncoder().encode('streamed'));controller.close();}
  }),{status:206,headers:{
   'Content-Length':String(large),
   'Content-Range':'bytes '+first+'-'+(first+large-1)+'/'+(first+large)
  }});
  response.clone=()=>{cloneAttempts++;throw new Error('large stream was cloned');};
  return response;
 });
 const url='https://api.roteiva.com/library/projects/17/nodes/'+id+'/content';
 assert.equal(f.bind({type:'bind-media',id,url,scope:'alice'}).ok,true);
 const response=await f.read();
 assert.equal(response.status,206);
 assert.equal(await response.text(),'streamed');
 assert.equal(cloneAttempts,0,'never tee a large body that cannot be cached');
 assert.equal(f.requests.length,1);
});

test('Biblioteca native preview never triggers paid Stream uploads or embeds',()=>{
 const preview=readFileSync(new URL('../src/features/drive/LibraryAssetPreview.tsx',import.meta.url),'utf8');
 assert.equal(preview.includes('/stream'),false);
 assert.equal(preview.includes('cloudflarestream.com'),false);
 assert.equal(preview.includes('Preparar reprodução otimizada'),false);
 assert.ok(preview.includes('authenticatedMedia('),'the private native media transport remains active');
});

test('small original images stream via the authorized tab and reopen from private memory only',async()=>{
 let upstreamReads=0;
 const pixels=new Uint8Array([137,80,78,71,13,10,26,10]);
 const f=fixture(async()=>{
  upstreamReads++;
  return new Response(pixels,{status:200,headers:{'Content-Type':'image/png','Content-Length':String(pixels.byteLength)}});
 });
 const url='https://api.roteiva.com/library/projects/17/nodes/'+id+'/content';
 assert.equal(f.bind({type:'bind-media',id,url,scope:'userA|rev1'}).ok,true);
 const noRange={headers:new Headers()};
 const first=await f.read('alice-tab',noRange);
 assert.equal(first.status,200);
 assert.deepEqual(new Uint8Array(await first.arrayBuffer()),pixels);
 await Promise.all(f.state.tasks);
 assert.equal(upstreamReads,1);
 f.bind({type:'revoke-media',id});
 assert.equal(f.bind({type:'bind-media',id,url,scope:'userA|rev1'}).ok,true);
 const reused=await f.read('alice-tab',noRange);
 assert.equal(reused.status,200,'original images must never be mislabeled 206');
 assert.deepEqual(new Uint8Array(await reused.arrayBuffer()),pixels);
 assert.equal(upstreamReads,1,'reopening a small image must avoid a second provider read');
 f.bind({type:'revoke-media',id});
 assert.equal(f.bind({type:'bind-media',id,url,scope:'userB|rev1'}).ok,true);
 await (await f.read('alice-tab',noRange)).arrayBuffer();
 assert.equal(upstreamReads,2,'a different user scope must not receive prior private bytes');
 assert.equal(f.bind({type:'clear-media-cache'}).ok,true);
 await (await f.read('alice-tab',noRange)).arrayBuffer();
 assert.equal(upstreamReads,3,'session cleanup must invalidate the private memory image');
});

test('non-image 200 and oversized images are never cloned or cached',async()=>{
 let clones=0,requests=0;
 const huge=new Uint8Array([1,2,3]);
 const f=fixture(async()=>{
  requests++;
  const response=new Response(huge,{status:200,headers:{
   'Content-Type':'image/jpeg','Content-Length':String(9*1024*1024),
  }});
  response.clone=()=>{clones++;throw new Error('oversized image unexpectedly cloned');};
  return response;
 });
 const url='https://api.roteiva.com/library/projects/17/nodes/'+id+'/content';
 f.bind({type:'bind-media',id,url,scope:'userA'});
 const noRange={headers:new Headers()};
 assert.equal((await f.read('alice-tab',noRange)).status,200);
 assert.equal((await f.read('alice-tab',noRange)).status,200);
 assert.equal(clones,0);
 assert.equal(requests,2);
});
