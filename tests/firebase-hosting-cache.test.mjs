import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

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
