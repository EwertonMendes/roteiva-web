import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {environments} from '../shared/environments.ts';
const source=readFileSync(new URL('../public/roteiva-media-sw.js',import.meta.url),'utf8');
const origin='https://roteiva.com',id='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
test('media worker origin allowlist matches the environment contract',()=>{
 for(const env of Object.values(environments))assert.ok(source.includes(env.apiOrigin));
});
function fixture(){
 const events={},requests=[],state={claims:0,tasks:[]};
 const client={id:'alice-tab',url:origin+'/biblioteca',sourceURL:undefined,reviewSession:undefined,postMessage(data,ports){ports[0].postMessage({authorization:'Bearer synthetic-identity',reviewSession:this.reviewSession,url:this.sourceURL});ports[0].close();}};
 const self={location:{origin},addEventListener:(kind,handler)=>events[kind]=handler,clients:{get:async key=>key===client.id?client:null,claim:async()=>{state.claims++;}},skipWaiting:async()=>{}};
 vm.runInNewContext(source,{self,URL,Response,Headers,Map,Set,Date,MessageChannel,setTimeout,clearTimeout,AbortSignal,AbortController,
 fetch:async(url,options)=>{requests.push({url,options});return new Response('test',{status:206,headers:{'Content-Range':'bytes 0-3/4','Content-Length':'4'}});}});
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
 assert.ok(app.includes('mediaProtocol=3'));
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
