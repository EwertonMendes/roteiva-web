import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {hostingOrigin,verifyHostingCache} from '../scripts/verify-hosting-cache.mjs';
import {waitForHostingRelease} from '../scripts/wait-for-hosting-release.mjs';

test("Hosting smoke retries an edge still serving the previous release and reports persistent failures",async()=>{
  let checks=0;
  const pauses=[];
  const options={delaysMs:[1000,3000],pause:async delay=>pauses.push(delay)};
  const recovered=await waitForHostingRelease(async()=>{
    if(++checks===1)throw new Error("Stale edge");
    return "current release";
  },options);
  assert.equal(recovered,"current release");
  assert.deepEqual(pauses,[1000]);

  pauses.length=0;
  checks=0;
  const failure=new Error("Incorrect redirect");
  await assert.rejects(waitForHostingRelease(async()=>{checks++;throw failure;},options),error=>error===failure);
  assert.equal(checks,3);
  assert.deepEqual(pauses,[1000,3000]);
});

const config=JSON.parse(readFileSync(new URL("../firebase.json",import.meta.url),"utf8"));
const hosting=config.hosting;

function cacheHeader(rule){
  return rule.headers?.find(h=>h.key.toLowerCase()==="cache-control")?.value;
}

test("SPA rewrite serves index.html for deep links",()=>{
  assert.ok(hosting.rewrites?.some(r=>r.source==="**"&&r.destination==="/index.html"));
});

test("uncached SPA shell is the default for original URLs before rewrite",()=>{
  const first=hosting.headers?.[0];
  assert.equal(first?.source,"**");
  assert.equal(cacheHeader(first),"no-cache, no-store, must-revalidate");
  // Original request URLs, including /configuracoes, are matched by **.
});

test("Vite hashed assets override the SPA cache policy in a later rule",()=>{
  const specific=hosting.headers?.at(-1);
  assert.equal(specific?.source,"/assets/**");
  assert.equal(cacheHeader(specific),"public, max-age=31536000, immutable");
  assert.equal(hosting.headers.length,2,"do not introduce another accidental cache override");
});

test('header verification uses configured canonical origins and rejects arbitrary URLs before fetching',()=>{
  for(const origin of ['https://app.roteiva.com','https://roteiva-web-dev.web.app','https://roteiva-web-prod.web.app'])
    assert.equal(hostingOrigin(origin+'/'),origin);
  for(const target of ['https://evil.example','https://roteiva.com','https://app.roteiva.com.evil.example','http://app.roteiva.com','https://user:password@app.roteiva.com',
    'https://app.roteiva.com/path','https://app.roteiva.com/?token=synthetic','https://app.roteiva.com/#fragment','https://app.roteiva.com:444'])
    assert.throws(()=>hostingOrigin(target));
});
const html='<script src="/assets/index-synthetic123.js"></script>';
function response(asset,policy='no-cache, no-store, must-revalidate'){
  return new Response(asset?'synthetic':html,{headers:{'content-type':asset?'text/javascript':'text/html',
    'cache-control':asset?'public, max-age=31536000, immutable':policy}});
}
test('brief CDN header propagation recovers while retaining deep-link and hashed-asset checks',async()=>{
  const calls=[];
  await verifyHostingCache('https://app.roteiva.com',{delaysMs:[0],sleep:async()=>{},fetcher:async(url,options)=>{
    calls.push(url);assert.equal(options.redirect,'error');
    return response(url.includes('/assets/'),calls.length===1?'max-age=3600':undefined);
  }});
  assert.equal(calls.length,7);assert.ok(calls.includes('https://app.roteiva.com/configuracoes'));
  assert.equal(calls.at(-1),'https://app.roteiva.com/assets/index-synthetic123.js');
});
test('persistent incorrect HTML policy fails after bounded reads',async()=>{
  let calls=0;await assert.rejects(verifyHostingCache('https://app.roteiva.com',{delaysMs:[0],sleep:async()=>{},
    fetcher:async()=>{calls++;return response(false,'max-age=3600');}}),/was not revalidated/);
  assert.equal(calls,2);
});
