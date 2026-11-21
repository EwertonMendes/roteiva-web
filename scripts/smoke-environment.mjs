import assert from 'node:assert/strict';
import {environment,legacyProdFrontendOrigin} from '../shared/environments.ts';
const target=process.argv[2],config=environment(target);
const send=(path,options={})=>fetch(config.apiOrigin+path,{...options,redirect:'manual',signal:AbortSignal.timeout(15000)});
const health=await send('/health');assert.equal(health.status,200);assert.deepEqual(await health.json(),{status:'ok',environment:target});
assert.equal((await send('/integrations/drive',{headers:{Authorization:'Bearer invalid'}})).status,401);
assert.equal((await send('/health',{headers:{Origin:'https://evil.example'}})).status,403);
const cors=await send('/oauth/drive/start',{method:'OPTIONS',headers:{Origin:config.frontendOrigin}});
assert.equal(cors.status,204);assert.equal(cors.headers.get('Access-Control-Allow-Origin'),config.frontendOrigin);
assert.match(cors.headers.get('Content-Security-Policy'),/frame-ancestors 'none'/);
if(target==='prod'){
  const catalog=await send('/billing/plans');
  if(process.env.PRODUCTION_BILLING_ENABLED==='true'){
    assert.equal(catalog.status,200);
    const billing=await catalog.json();
    assert.equal(billing.currency,'BRL');
    // A public billing release is an explicit, owner-approved production
    // workflow input; a canary-only release must remain closed anonymously.
    const publicCheckout=process.env.PRODUCTION_BILLING_CHECKOUT_ENABLED==='true'&&
      process.env.PRODUCTION_BILLING_PUBLIC_ROLLOUT_ENABLED==='true';
    const publicTestOffer=publicCheckout&&process.env.PRODUCTION_BILLING_TEST_PLAN_ENABLED==='true';
    assert.equal(billing.checkoutAvailable,publicCheckout,
      'PROD checkout visibility must match the protected public-rollout decision');
    const expected=[
      {code:'monthly',amountCents:3990},
      {code:'quarterly',amountCents:10990},
      {code:'yearly',amountCents:39990},
      ...(publicTestOffer?[{code:'test',amountCents:500}]:[])
    ];
    assert.deepEqual(billing.plans.map(plan=>({code:plan.code,amountCents:plan.amountCents})),expected,
      'PROD server-controlled prices and test-offer visibility must match the release');
    assert.equal((await send('/billing/status')).status,401);
    assert.equal((await send('/billing/webhooks/asaas',{method:'POST'})).status,401);
  }else{
    assert.equal(catalog.status,404,'Billing must remain unpublished before activation');
  }
  const legacy=await send('/oauth/drive/start',{method:'OPTIONS',headers:{Origin:legacyProdFrontendOrigin}});
  const windowOpen=process.env.DOMAIN_CUTOVER==='true';
  assert.equal(legacy.status,windowOpen?204:403);
  assert.equal(legacy.headers.get('Access-Control-Allow-Origin'),windowOpen?legacyProdFrontendOrigin:null);
}
console.log('Health, durable D1 identity, invalid token, exact CORS and response policy passed for '+target+'. OAuth consent remains separate.');
