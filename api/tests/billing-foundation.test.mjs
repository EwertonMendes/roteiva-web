import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {billingCatalog,requireBillingPlan} from '../src/billing-catalog.ts';
import {billingPlansResponse} from '../src/billing.ts';
import {asaasConfigured,asaasRequest} from '../src/billing-asaas.ts';

test('catalog is server-owned, exact, immutable and rejects unknown codes',()=>{
  const plans=billingCatalog();
  assert.deepEqual(plans.map(p=>[p.code,p.cycle,p.amountCents,p.currency]),[
    ['monthly','MONTHLY',3990,'BRL'],['quarterly','QUARTERLY',10990,'BRL'],['yearly','YEARLY',39990,'BRL']
  ]);
  assert.equal(requireBillingPlan('quarterly').amountCents,10990);
  assert.throws(()=>requireBillingPlan('custom'),{code:'billing_invalid_plan'});
  assert.throws(()=>{plans[0].amountCents=1;},TypeError);
  assert.throws(()=>{plans.push({});},TypeError);
});
test('public catalog never advertises working checkout before implementation',async()=>{
  const response=billingPlansResponse(),data=await response.json();
  assert.equal(data.checkoutAvailable,false);
  assert.equal(data.currency,'BRL');
  assert.equal(data.plans.length,3);
});
test('missing or partial configuration fails closed before any external request',async()=>{
  let calls=0;
  const transport=async()=>{calls++;return Response.json({id:'bad'});};
  for(const env of [{ENVIRONMENT:'dev'},{
    ENVIRONMENT:'dev',BILLING_ENABLED:'true',ASAAS_API_KEY:'key'.repeat(10)
  },{
    ENVIRONMENT:'dev',BILLING_ENABLED:'false',ASAAS_API_KEY:'key'.repeat(10),ASAAS_WEBHOOK_TOKEN:'a'.repeat(32)
  },{
    ENVIRONMENT:'dev',BILLING_ENABLED:'true',ASAAS_API_KEY:'k'.repeat(48),
    ASAAS_WEBHOOK_TOKEN:'k'.repeat(48)
  },{
    ENVIRONMENT:'dev',BILLING_ENABLED:'true',ASAAS_API_KEY:'k'.repeat(48),
    ASAAS_WEBHOOK_TOKEN:'token with forbidden spaces'.repeat(2)
  },{
    ENVIRONMENT:'staging',BILLING_ENABLED:'true',ASAAS_API_KEY:'key'.repeat(10),ASAAS_WEBHOOK_TOKEN:'a'.repeat(32)
  }]){
    assert.equal(asaasConfigured(env),false);
    await assert.rejects(asaasRequest(env,'POST','/checkouts',{amount:3990},transport),{code:'billing_unavailable'});
  }
  assert.equal(calls,0);
});
test('Asaas URLs are environment-locked, authenticated and error bodies not leaked',async()=>{
  const mk=(ENVIRONMENT)=>({ENVIRONMENT,BILLING_ENABLED:'true',ASAAS_API_KEY:'$aact_'+(ENVIRONMENT==='dev'?'hmlg':'prod')+'_'+'key'.repeat(10),ASAAS_WEBHOOK_TOKEN:'a'.repeat(32)});
  for(const [env,host] of [['dev','https://api-sandbox.asaas.com/v3'],['prod','https://api.asaas.com/v3']]){
    let called=0;
    const transport=async(url,options)=>{
      called++;
      assert.equal(url,host+'/checkouts');
      assert.equal(options.headers.access_token,mk(env).ASAAS_API_KEY);
      assert.equal(options.redirect,'manual');
      assert.equal(options.method,'POST');
      return Response.json({id:'chk_123'});
    };
    assert.deepEqual(await asaasRequest(mk(env),'POST','/checkouts',{externalReference:'internal'},transport),{id:'chk_123'});
    assert.equal(called,1);
    await assert.rejects(asaasRequest(mk(env),'POST','https://evil.invalid',{},transport),{code:'billing_invalid_request'});
    assert.equal(called,1);
  }
  await assert.rejects(asaasRequest(mk('dev'),'POST','/checkouts',{},async()=>{throw Error('token secret in an exception');}),{
    code:'billing_provider_unavailable'
  });
  await assert.rejects(asaasRequest(mk('dev'),'POST','/checkouts',{},async()=>new Response('private provider body',{status:400})),{
    code:'billing_provider_unavailable'
  });
});
test('billing tables are additive, FK-isolated and reject duplicate provider checkout IDs',()=>{
  const db=new DatabaseSync(':memory:');
  try{
    db.exec(readFileSync(new URL('../migrations/0007_access.sql',import.meta.url),'utf8'));
    const t=1763596800000;
    db.prepare('INSERT INTO access_accounts(owner_uid,trial_started_at,trial_ends_at,created_at,updated_at) VALUES(?,?,?,?,?)')
      .run('owner',t,t+604800000,t,t);
    const before=db.prepare('SELECT * FROM access_accounts').get();
    db.exec(readFileSync(new URL('../migrations/0035_billing_foundation.sql',import.meta.url),'utf8'));
    assert.deepEqual(db.prepare('SELECT * FROM access_accounts').get(),before);
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
    db.exec('PRAGMA foreign_keys=ON');
    const intent=db.prepare('INSERT INTO billing_checkout_intents(id,owner_uid,provider,plan_code,pricing_version,amount_cents,status,provider_checkout_ref,created_at,expires_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)');
    intent.run('one','owner','asaas','monthly','2026-11-v1',3990,'pending','chk_1',t,t+600000,t);
    assert.throws(()=>intent.run('two','owner','asaas','monthly','2026-11-v1',3990,'ready','chk_1',t,t+600000,t));
    assert.throws(()=>intent.run('three','another','asaas','monthly','2026-11-v1',3990,'ready','chk_3',t,t+600000,t));
    assert.throws(()=>intent.run('four','owner','asaas','fake','2026-11-v1',3990,'ready','chk_4',t,t+600000,t));
    assert.equal(db.prepare('SELECT count(*) AS n FROM billing_checkout_intents').get().n,1);
  }finally{db.close();}
});
