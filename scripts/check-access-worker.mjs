import assert from 'node:assert/strict';
const base='https://roteiva-api-dev.ewertonmendes9.workers.dev';
const health=await fetch(base+'/health',{signal:AbortSignal.timeout(15000)});
assert.equal(health.status,200,'DEV Worker unavailable');
assert.equal(health.headers.get('X-Roteiva-Access-Version'),'1','Access Worker must be published before this frontend');
const denied=await fetch(base+'/access/ensure',{method:'POST',headers:{Origin:'https://roteiva-web-dev.web.app'},signal:AbortSignal.timeout(15000)});
assert.equal(denied.status,401,'Provisioning route must exist and require identity');
console.log('DEV access Worker is published; unauthenticated provisioning rejected. This is not an authenticated IAM smoke.');
