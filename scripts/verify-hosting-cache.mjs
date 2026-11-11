// Called by GitHub Actions after publishing Firebase DEV. The CDN may serve
// old HTML if rules match only the rewritten /index.html; verify real URLs.
import assert from "node:assert/strict";
import {pathToFileURL} from 'node:url';
import {environments} from '../shared/environments.ts';

export function hostingOrigin(target){
  const url=new URL(target);
  const allowed=Object.values(environments).flatMap(item=>[item.frontendOrigin,...item.frontendAliases]);
  if(url.protocol!=='https:'||url.href!==url.origin+'/'||!allowed.includes(url.origin))
    throw new Error('Only an exact configured Roteiva Hosting origin is authorized.');
  return url.origin;
}
export async function verifyHostingCache(target,{fetcher=fetch,delaysMs=[500,1500,3000],sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}){
const root=hostingOrigin(target);
const pages=["/","/index.html","/configuracoes","/biblioteca","/projetos/12345678"];
let entry="";
async function read(path){
  const response=await fetcher(root+path,{signal:AbortSignal.timeout(15000),redirect:"error",cache:'no-store',headers:{"Accept":"text/html"}});
  assert.equal(response.status,200,path+" returned "+response.status);
  return response;
}
for(const page of pages){
  let response,control;
  // A just-published CDN release can briefly return the previous headers.
  // Bounded reads retain every assertion; persistent wrong policy still fails.
  for(let attempt=0;;attempt++){
    response=await read(page);control=response.headers.get('cache-control')||'';
    try{
      assert.match(control,/\bno-cache\b/,page+' was not revalidated');
      assert.match(control,/\bno-store\b/,page+' can cache old HTML');
      assert.match(response.headers.get('content-type')||'',/text\/html/,page+' is not HTML');
      break;
    }catch(error){
      await response.body?.cancel();
      if(attempt>=delaysMs.length)throw error;
      await sleep(delaysMs[attempt]);
    }
  }
  console.log(page+": "+control);
  if(page==="/")entry=await response.text();
}
const asset=entry.match(/(?:src|href)=["'](\/assets\/[^"' ]+\.(?:js|css))["']/)?.[1];
assert.ok(asset,"index.html must contain a hashed Vite JS/CSS entry in /assets/");
assert.match(asset,/-[A-Za-z0-9_-]{6,}\.(?:js|css)$/,"asset is not content hashed");
const response=await read(asset);
const control=response.headers.get("cache-control")||"";
assert.match(control,/\bpublic\b/,"hashed asset must be public");
assert.match(control,/\bimmutable\b/,"hashed asset must be immutable");
assert.match(control,/max-age=31536000/,"hashed asset must be cached for 1 year");
console.log(asset+": "+control);
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)
  await verifyHostingCache(process.argv[2]);
