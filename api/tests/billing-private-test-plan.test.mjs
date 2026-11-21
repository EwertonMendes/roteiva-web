import test from 'node:test';
import assert from 'node:assert/strict';
import {database} from './helpers/database.mjs';
import {billingCatalog,TEST_BILLING_VERSION,TEST_BILLING_AMOUNT_CENTS} from '../src/billing-catalog.ts';
import {billingPlansResponse,billingStatusResponse} from '../src/billing.ts';
import {createCheckout} from '../src/billing-checkout.ts';
import {ingestAsaasWebhook} from '../src/billing-webhook.ts';
import {reconcileBilling} from '../src/billing-reconciliation.ts';
import {manualPaidUntil} from '../src/billing-purchase-policy.ts';
import {billingDateInstant,periodEnd} from '../src/billing-period.ts';

const checkoutUrl='https://api.roteiva.com/billing/checkout';
const day=(when)=>new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo',
  year:'numeric',month:'2-digit',day:'2-digit'}).format(when);
function setup(t,now=Date.now()){
  const d=database();t.after(d.close);
  const started=now-2*86400000,trialEnd=started+7*86400000;
  for(const uid of ['owner','other'])
    d.sql.prepare('INSERT INTO access_accounts(owner_uid,trial_started_at,trial_ends_at,created_at,updated_at) VALUES(?,?,?,?,?)')
      .run(uid,started,trialEnd,started,now);
  const env={DB:d.DB,ENVIRONMENT:'prod',FRONTEND_ORIGIN:'https://app.roteiva.com',
    BILLING_ENABLED:'true',BILLING_CHECKOUT_ENABLED:'true',BILLING_PIX_ENABLED:'true',
    BILLING_PUBLIC_ROLLOUT_ENABLED:'false',BILLING_CHECKOUT_TEST_UIDS:'owner',
    BILLING_TEST_PLAN_ENABLED:'true',BILLING_TEST_PLAN_UID:'owner',
    ASAAS_API_KEY:'$aact_prod_'+'k'.repeat(32),ASAAS_WEBHOOK_TOKEN:'w'.repeat(48)};
  return {...d,env,now,trialEnd};
}
function request(planCode='test',overrides={}){
  return new Request(checkoutUrl,{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({planCode,catalogVersion:planCode==='test'?TEST_BILLING_VERSION:'2026-11-v1',
      acceptedImmediateCharge:true,...overrides})});
}
async function webhook(env,paymentId,eventId,event='PAYMENT_RECEIVED'){
  const result=await ingestAsaasWebhook(new Request('https://api.roteiva.com/billing/webhooks/asaas',{
    method:'POST',headers:{'Content-Type':'application/json','asaas-access-token':env.ASAAS_WEBHOOK_TOKEN},
    body:JSON.stringify({id:eventId,event,payment:{id:paymentId}})
  }),env);
  assert.equal(result.status,200);
}

test('minimum R$5 offer is server-owned and only visible to one exact PROD UID',async t=>{
  const f=setup(t);
  const owner=await (await billingPlansResponse(f.env,'owner')).json();
  const other=await (await billingPlansResponse(f.env,'other')).json();
  assert.equal(owner.plans.length,4);
  assert.deepEqual(owner.plans.find(plan=>plan.code==='test'),{
    code:'test',cycle:'MONTHLY',amountCents:500,currency:'BRL',version:TEST_BILLING_VERSION
  });
  assert.deepEqual(other.plans.map(p=>p.code),['monthly','quarterly','yearly']);
  assert.deepEqual(billingCatalog({...f.env,BILLING_TEST_PLAN_ENABLED:'false'},'owner').map(p=>p.code),
    ['monthly','quarterly','yearly']);
  assert.deepEqual(billingCatalog({...f.env,ENVIRONMENT:'dev'},'owner').map(p=>p.code),
    ['monthly','quarterly','yearly']);
  assert.deepEqual(billingCatalog({...f.env,BILLING_TEST_PLAN_UID:'other'},'owner').map(p=>p.code),
    ['monthly','quarterly','yearly']);
  assert.deepEqual(billingCatalog({...f.env,BILLING_PUBLIC_ROLLOUT_ENABLED:'true'},'other').map(p=>p.code),
    ['monthly','quarterly','yearly']);
  assert.equal(TEST_BILLING_AMOUNT_CENTS,500);
  await assert.rejects(createCheckout(request(),{...f.env,BILLING_PUBLIC_ROLLOUT_ENABLED:'true'},'other',f.now),{
    code:'not_found'});
  await assert.rejects(createCheckout(request(),{...f.env,BILLING_TEST_PLAN_ENABLED:'false'},'owner',f.now),{
    code:'not_found'});
  await assert.rejects(createCheckout(request(),{...f.env,BILLING_CHECKOUT_ENABLED:'false'},'owner',f.now),{
    code:'not_found'});
});

test('tampered price and plan version are rejected, no discounted commercial checkout is possible',async t=>{
  const f=setup(t);
  let sent=0,providerBody;
  t.mock.method(globalThis,'fetch',async (_,options)=>{
    sent++;
    providerBody=JSON.parse(options.body);
    return Response.json({id:'checkout_private_card'});
  });
  for(const injection of [{amountCents:1},{value:0.01},{price:0},{discountPercent:100},{ownerUid:'owner'}]){
    await assert.rejects(createCheckout(request('test',injection),f.env,'owner',f.now),{
      code:'billing_consent_required'});
  }
  await assert.rejects(createCheckout(request('monthly',{catalogVersion:TEST_BILLING_VERSION}),f.env,'owner',f.now),{
    code:'billing_catalog_changed'});
  await assert.rejects(createCheckout(request('test',{catalogVersion:'2026-11-v1'}),f.env,'owner',f.now),{
    code:'billing_catalog_changed'});
  assert.equal(sent,0);
  const result=await createCheckout(request(),f.env,'owner',f.now);
  assert.equal(result.status,201);
  assert.equal(sent,1);
  assert.deepEqual(providerBody.billingTypes,['CREDIT_CARD']);
  assert.deepEqual(providerBody.chargeTypes,['RECURRENT']);
  assert.equal(providerBody.items[0].value,5);
  assert.equal(providerBody.subscription.cycle,'MONTHLY');
  assert.equal(providerBody.callback.successUrl.startsWith('https://app.roteiva.com/'),true);
  assert.equal(f.sql.prepare('SELECT plan_code,pricing_version,amount_cents FROM billing_checkout_intents').get().plan_code,'monthly');
  assert.equal(f.sql.prepare('SELECT pricing_version FROM billing_checkout_intents').get().pricing_version,TEST_BILLING_VERSION);
  assert.equal(f.sql.prepare('SELECT amount_cents FROM billing_checkout_intents').get().amount_cents,500);
  await assert.rejects(createCheckout(request('monthly'),f.env,'owner',f.now),{
    code:'billing_checkout_already_open'});
  assert.equal(sent,1,'must never start a second provider payment for a price/version mismatch');
});

test('commercial monthly remains R$39.90, even for the private test owner',async t=>{
  const f=setup(t);
  let value=0;
  t.mock.method(globalThis,'fetch',async (_,options)=>{
    value=JSON.parse(options.body).items[0].value;
    return Response.json({id:'checkout_commercial'});
  });
  const created=await createCheckout(request('monthly'),f.env,'owner',f.now);
  assert.equal(created.status,201);
  assert.equal(value,39.9);
  assert.equal(f.sql.prepare('SELECT amount_cents FROM billing_checkout_intents').get().amount_cents,3990);
});

test('R$5 PIX is one-off, settlement preserves trial, idempotent and cannot be stacked',async t=>{
  const f=setup(t),due=day(f.now);
  const payment={id:'pay_private_pix',billingType:'PIX',checkoutSession:'checkout_private_pix',
    subscription:null,customer:'cust_private_pix',value:5,status:'RECEIVED',originalDueDate:due,paymentDate:due};
  let postCount=0,checkoutPayload;
  t.mock.method(globalThis,'fetch',async (url,options)=>{
    const path=String(url);
    if(path.endsWith('/v3/checkouts')){
      postCount++;checkoutPayload=JSON.parse(options.body);
      return Response.json({id:'checkout_private_pix'});
    }
    if(path.endsWith('/payments/pay_private_pix'))return Response.json(payment);
    if(path.includes('/payments?checkoutSession=checkout_private_pix&limit=2'))
      return Response.json({data:[payment],hasMore:false});
    throw new Error('unexpected Asaas request '+path);
  });
  assert.equal((await createCheckout(request('test',{paymentMethod:'PIX'}),f.env,'owner',f.now)).status,201);
  assert.equal(checkoutPayload.items[0].value,5);
  assert.deepEqual(checkoutPayload.chargeTypes,['DETACHED']);
  assert.deepEqual(checkoutPayload.billingTypes,['PIX']);
  assert.equal(checkoutPayload.subscription,undefined);
  const paused={...f.env,BILLING_TEST_PLAN_ENABLED:'false',BILLING_CHECKOUT_ENABLED:'false'};
  await webhook(paused,payment.id,'evt_private_pix_1');
  await reconcileBilling(paused);
  const sub=f.sql.prepare('SELECT paid_until,cadence,status FROM access_subscriptions').get();
  assert.equal(sub.status,'active');
  assert.equal(sub.cadence,'monthly');
  assert.equal(sub.paid_until,manualPaidUntil(f.trialEnd,'monthly'));
  assert.equal(f.sql.prepare('SELECT amount_cents,payment_method FROM billing_payment_records').get().amount_cents,500);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM billing_contracts').get().n,0);
  await webhook(paused,payment.id,'evt_private_pix_2');
  await reconcileBilling(paused);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM billing_payment_records').get().n,1);
  assert.equal(postCount,1);
  await assert.rejects(createCheckout(request('test',{paymentMethod:'PIX'}),f.env,'owner',f.now),
    {code:'billing_access_still_active'});
  const status=await (await billingStatusResponse(paused,'owner',f.now)).json();
  assert.equal(status.subscription.isTestPlan,true);
  assert.equal(status.subscription.amountCents,500);
});

test('R$5 recurring card settles against the original trusted intent and keeps one courtesy credit',async t=>{
  const f=setup(t),due=day(f.now);
  const pay={id:'pay_private_card',billingType:'CREDIT_CARD',
    checkoutSession:'checkout_private_card',subscription:'sub_private_card',
    customer:'cust_private_card',value:5,status:'CONFIRMED',originalDueDate:due,paymentDate:due};
  const contract={id:'sub_private_card',customer:'cust_private_card',billingType:'CREDIT_CARD',
    cycle:'MONTHLY',value:5,status:'ACTIVE',nextDueDate:due};
  t.mock.method(globalThis,'fetch',async (url,options)=>{
    const path=String(url);
    if(path.endsWith('/v3/checkouts')){
      assert.equal(JSON.parse(options.body).items[0].value,5);
      return Response.json({id:'checkout_private_card'});
    }
    if(path.endsWith('/payments/pay_private_card'))return Response.json(pay);
    if(path.endsWith('/subscriptions/sub_private_card'))return Response.json(contract);
    throw new Error('unexpected Asaas request '+path);
  });
  assert.equal((await createCheckout(request(),f.env,'owner',f.now)).status,201);
  const credit=f.sql.prepare('SELECT courtesy_credit_ms FROM billing_checkout_intents').get().courtesy_credit_ms;
  assert.equal(credit>0,true);
  const paused={...f.env,BILLING_TEST_PLAN_ENABLED:'false',BILLING_CHECKOUT_ENABLED:'false'};
  await webhook(paused,pay.id,'evt_private_card_1','PAYMENT_CONFIRMED');
  await reconcileBilling(paused);
  assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM billing_contracts').get().n,1);
  assert.equal(f.sql.prepare('SELECT paid_until FROM access_subscriptions').get().paid_until,periodEnd(due,'monthly')+credit);
  assert.equal(f.sql.prepare('SELECT amount_cents FROM billing_payment_records').get().amount_cents,500);
  const status=await (await billingStatusResponse(paused,'owner',f.now)).json();
  assert.equal(status.subscription.isTestPlan,true);
  assert.equal(status.subscription.renewalMode,'automatic');
  assert.equal(status.subscription.amountCents,500);
});
