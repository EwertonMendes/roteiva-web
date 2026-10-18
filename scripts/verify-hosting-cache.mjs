// Called by GitHub Actions after publishing Firebase DEV. The CDN may serve
// old HTML if rules match only the rewritten /index.html; verify real URLs.
import assert from "node:assert/strict";

const target=process.argv[2];
if(!target||!/^https:\/\/roteiva-web-dev\.web\.app\/?$/.test(target)){
  throw new Error("Only the DEV Hosting origin is authorized for header verification.");
}
const root=target.replace(/\/$/,"");
const pages=["/","/index.html","/configuracoes","/biblioteca","/projetos/12345678"];
let entry="";
async function read(path){
  const response=await fetch(root+path,{signal:AbortSignal.timeout(15000),redirect:"follow",headers:{"Accept":"text/html"}});
  assert.equal(response.status,200,path+" returned "+response.status);
  return response;
}
for(const page of pages){
  const response=await read(page);
  const control=response.headers.get("cache-control")||"";
  assert.match(control,/\bno-cache\b/,page+" was not revalidated");
  assert.match(control,/\bno-store\b/,page+" can cache old HTML");
  assert.match(response.headers.get("content-type")||"",/text\/html/,page+" is not HTML");
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
