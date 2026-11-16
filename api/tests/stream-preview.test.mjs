import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mintStreamIngestTicket,verifyStreamIngestTicket,streamPreviewEnabled} from '../src/stream-preview.ts';
const secret=Buffer.alloc(32,5).toString('base64url');
const env={ENVIRONMENT:'dev',STREAM_PREVIEW_ENABLED:'true',STREAM:{},TOKEN_KEYS:JSON.stringify({v1:secret}),TOKEN_KEY_VERSION:'v1'};
const claims=()=>({u:'dev-user-1',p:314,n:'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',r:'rev42',s:'12345678',e:Date.now()+60000});
test('Stream proof of concept is enabled only in DEV with native binding',()=>{
 assert.equal(streamPreviewEnabled(env),true);
 assert.equal(streamPreviewEnabled({...env,ENVIRONMENT:'prod'}),false);
 assert.equal(streamPreviewEnabled({...env,STREAM:undefined}),false);
 assert.equal(streamPreviewEnabled({...env,STREAM_PREVIEW_ENABLED:'false'}),false);
});
test('private ingest URL requires valid signed, scoped and unexpired payload',async()=>{
 const token=await mintStreamIngestTicket(env,claims());
 const verified=await verifyStreamIngestTicket(env,token);
 assert.equal(verified.u,'dev-user-1');
 assert.equal(verified.p,314);
 assert.equal(verified.s,'12345678');
 await assert.rejects(verifyStreamIngestTicket({...env,TOKEN_KEYS:JSON.stringify({v1:Buffer.alloc(32,7).toString('base64url')})},token));
 const [body,signature]=token.split('.');
 const changed=body.slice(0,-1)+(body.at(-1)==='A'?'B':'A');
 await assert.rejects(verifyStreamIngestTicket(env,changed+'.'+signature));
 const expired=await mintStreamIngestTicket(env,{...claims(),e:Date.now()-1});
 await assert.rejects(verifyStreamIngestTicket(env,expired));
});

test('deployed DEV/PROD remain free-tier only: Stream disabled without billable binding',()=>{
 const wrangler=JSON.parse(readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8'));
 for(const stage of ['dev','prod']){
  assert.equal(wrangler.env[stage].vars.STREAM_PREVIEW_ENABLED,stage==='dev'?'false':undefined);
  assert.equal(wrangler.env[stage].stream,undefined);
 }
 assert.equal(streamPreviewEnabled({...env,STREAM_PREVIEW_ENABLED:'false',STREAM:undefined}),false);
});
