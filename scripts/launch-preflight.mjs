// Public, read-only checks. Passing these checks does not approve a public launch.
import assert from 'node:assert/strict';
import {environment} from '../shared/environments.ts';

const target=process.argv[2],expectedSha=process.argv[3],config=environment(target);
if(expectedSha)assert.match(expectedSha,/^[a-f0-9]{40}$/,'Use a full release SHA');
const read=(origin,path,options={})=>fetch(origin+path,{
  ...options,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000),
});
const checks=[];
async function check(name,run){await run();checks.push(name);}
await check('published_environment',async()=>{
  const response=await read(config.frontendOrigin,'/roteiva-build.json');
  assert.equal(response.status,200);const manifest=await response.json();
  assert.equal(manifest.projectId,config.projectId);assert.equal(manifest.environment,target);
  assert.equal(manifest.apiOrigin,config.apiOrigin);assert.match(manifest.sha,/^[a-f0-9]{40}$/);
  if(expectedSha)assert.equal(manifest.sha,expectedSha,'Published release differs');
});
await check('health_and_database_identity',async()=>{
  const response=await read(config.apiOrigin,'/health');assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{status:'ok',environment:target});
});
await check('anonymous_and_invalid_identity_denied',async()=>{
  for(const headers of [{},{Authorization:'Bearer invalid'}]){
    const response=await read(config.apiOrigin,'/integrations/drive',{headers});
    assert.equal(response.status,401);await response.body?.cancel();
  }
});
await check('exact_cors_and_frame_policy',async()=>{
  const rejected=await read(config.apiOrigin,'/health',{headers:{Origin:'https://evil.example'}});
  assert.equal(rejected.status,403);await rejected.body?.cancel();
  const allowed=await read(config.apiOrigin,'/oauth/drive/start',{
    method:'OPTIONS',headers:{Origin:config.frontendOrigin},
  });
  assert.equal(allowed.status,204);assert.equal(allowed.headers.get('Access-Control-Allow-Origin'),config.frontendOrigin);
  assert.match(allowed.headers.get('Content-Security-Policy')||'',/frame-ancestors 'none'/);
});
await check('public_information_and_support_address',async()=>{
  await Promise.all(['/sobre.html','/privacidade.html','/termos.html','/suporte.html'].map(async path=>{
    const response=await read(config.frontendOrigin,path);assert.equal(response.status,200);
    assert.match(response.headers.get('content-type')||'',/text\/html/);
    const html=await response.text();assert.match(html,/<h1[\s>]/i);assert.match(html,/Roteiva/);
    assert.match(html,/roteiva-suporte@googlegroups\.com/);
    assert.doesNotMatch(html,/TODO|example\.com|SEU_DOMINIO/);
  }));
});
console.log(JSON.stringify({environment:target,status:'public_preflight_passed',checks,
  authenticatedBusinessFlowsTested:false,providerApprovalVerified:false,
  supportDeliveryTested:false,physicalDevicesTested:false,productionWrites:0},null,2));
