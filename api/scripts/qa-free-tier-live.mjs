/** One-shot read-only QA against the real DEV Worker and D1 (no emulators).
 * Requires CLOUDFLARE_API_TOKEN on the protected GitHub environment.
 * Never prints tokens, user data, rows or URLs containing credentials.
 */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const base='https://roteiva-api-dev.ewertonmendes9.workers.dev';
const script=fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js',import.meta.url));
const queries=[
  ['expiry', "EXPLAIN QUERY PLAN SELECT * FROM review_requests WHERE (expires_at<=0 OR status='closing') AND status!='closed' AND updated_at<0 ORDER BY updated_at LIMIT 1"],
  ['owner', "EXPLAIN QUERY PLAN SELECT * FROM review_requests WHERE owner_uid='QA_NONEXISTENT' AND (LOWER(client_name) LIKE '%QA%' OR LOWER(project_name) LIKE '%QA%' OR LOWER(title) LIKE '%QA%') ORDER BY updated_at DESC LIMIT 25 OFFSET 0"],
  ['uploads', "EXPLAIN QUERY PLAN SELECT rowid FROM drive_upload_attempts WHERE expires_at<=0 LIMIT 100"],
];
function d1(label,sql){
  const out=execFileSync(process.execPath,[script,'d1','execute','DB','--env','dev','--remote','--json','--command',sql],{
    encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:45000,env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
  const parsed=JSON.parse(out);
  assert.ok(parsed?.[0]?.success,'D1 query must succeed');
  const meta=parsed[0].meta||{};
  const details=(parsed[0].results||[]).map(x=>x.detail).filter(x=>typeof x==='string');
  console.log(JSON.stringify({check:label,rowsRead:meta.rows_read??null,rowsWritten:meta.rows_written??null,duration:meta.duration??null,queryPlan:details}));
}
async function http(path,expected){
  const start=performance.now();
  const response=await fetch(base+path,{headers:{Authorization:'Bearer invalid'},signal:AbortSignal.timeout(12000)});
  assert.equal(response.status,expected,path);
  console.log(JSON.stringify({check:'worker_http',route:path,status:response.status,wallMs:Math.round(performance.now()-start)}));
  await response.body?.cancel();
}
if(process.env.CLOUDFLARE_API_TOKEN){
  for(const [label,sql] of queries)d1(label,sql);
}else console.log(JSON.stringify({check:'d1_remote',status:'blocked_without_protected_environment'}));
await http('/health',200);
await http('/integrations/drive',401);
await http('/reviews',401);
await http('/nonexistent-qa-route',404);
const frontend=await fetch('https://roteiva-web-dev.web.app/',{signal:AbortSignal.timeout(12000)});
assert.equal(frontend.status,200);
const html=await frontend.text();
assert.ok(html.includes('root')&&html.includes('script'),'DEV frontend is expected to serve SPA');
console.log(JSON.stringify({check:'dev_frontend',status:frontend.status,htmlLength:html.length}));
