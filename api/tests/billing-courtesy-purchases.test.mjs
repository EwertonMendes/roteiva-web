import test from 'node:test';
import assert from 'node:assert/strict';
import {database} from './helpers/database.mjs';
import {purchaseWindow,courtesyCreditForCard,manualPaidUntil} from '../src/billing-purchase-policy.ts';
import {billingDateInstant,periodEnd} from '../src/billing-period.ts';
import {createCheckout} from '../src/billing-checkout.ts';
import {billingStatusResponse} from '../src/billing.ts';
import {checkoutEnabled,pixEnabled} from '../src/billing-asaas.ts';

const url='https://roteiva-api-dev.roteiva-dev.workers.dev/billing/checkout';
function setup(t,now=Date.now()) {
 const d=database();t.after(d.close);
 const started=now-2*86400000;
 const trialEnd=started+7*86400000;
 d.sql.prepare('INSERT INTO access_accounts(owner_uid,trial_started_at,trial_ends_at,created_at,updated_at) VALUES(?,?,?,?,?)')
  .run('owner',started,trialEnd,started,now);
 const env={DB:d.DB,ENVIRONMENT:'dev',FRONTEND_ORIGIN:'https://roteiva-web-dev.web.app',
  BILLING_ENABLED:'true',BILLING_PIX_ENABLED:'true',BILLING_CHECKOUT_ENABLED:'true',
  ASAAS_API_KEY:'$aact_hmlg_'+'k'.repeat(32),ASAAS_WEBHOOK_TOKEN:'w'.repeat(48)};
 return {...d,env,now,trialEnd};
}
function purchase(method='PIX',plan='monthly'){
 return new Request(url,{method:'POST',headers:{'content-type':'application/json'},
 body:JSON.stringify({planCode:plan,catalogVersion:'2026-11-v1',acceptedImmediateCharge:true,
 ...(method==='PIX'?{paymentMethod:method}:{})})});
}
test('free trial and finite courtesy are purchasable; preserved time is stable',async t=>{
 const f=setup(t);
 const initial=await purchaseWindow(f.env,'owner',f.now);
 assert.equal(initial.canPurchase,true);
 assert.equal(initial.courtesyUntil,f.trialEnd);
 const start=f.trialEnd;
 assert.equal(manualPaidUntil(start,'monthly')>f.trialEnd,true);
 const localDate=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(f.now);
 const credit=courtesyCreditForCard(f.now,f.trialEnd);
 assert.equal(credit,f.trialEnd-billingDateInstant(localDate));
 assert.ok(credit>0);
 assert.equal(periodEnd(localDate,'monthly')+credit,
  periodEnd(localDate,'monthly')+f.trialEnd-billingDateInstant(localDate));
 const courtesyEnd=f.now+25*86400000;
 f.sql.prepare("INSERT INTO access_grants(id,owner_uid,grant_kind,starts_at,ends_at,reason,created_at) VALUES('free','owner','complimentary',?,?,?,?)")
   .run(f.now,courtesyEnd,'bonus',f.now);
 assert.equal((await purchaseWindow(f.env,'owner',f.now)).courtesyUntil,courtesyEnd);
 assert.equal(courtesyCreditForCard(f.now,courtesyEnd)>credit,true);
 f.sql.prepare("INSERT INTO access_grants(id,owner_uid,grant_kind,starts_at,reason,created_at) VALUES('life','owner','lifetime',?,?,?)")
   .run(f.now,'free forever',f.now);
 assert.equal((await purchaseWindow(f.env,'owner',f.now)).canPurchase,false);
});

test('calendar-accurate manual period preserves local clock and end-of-month',()=>{
 const at=Date.parse('2027-01-31T13:37:00-03:00');
 assert.equal(new Date(manualPaidUntil(at,'monthly')).toISOString(),'2027-02-28T16:37:00.000Z');
 assert.equal(new Date(manualPaidUntil(at,'quarterly')).toISOString(),'2027-04-30T16:37:00.000Z');
 assert.equal(new Date(manualPaidUntil(at,'yearly')).toISOString(),'2028-01-31T16:37:00.000Z');
});

test('an active courtesy user may see and start either mode without interrupting card recurrence',async t=>{
 const f=setup(t);let received;
 t.mock.method(globalThis,'fetch',async(request,opts)=>{
  received=JSON.parse(opts.body);
  return Response.json({id:received.billingTypes[0]==='PIX'?'checkout_pix':'checkout_card'});
 });
 const status=await (await billingStatusResponse(f.env,'owner',f.now)).json();
 assert.equal(status.canStart,true);
 assert.equal(status.canRenewWithPix,true);
 assert.equal(status.courtesyUntil,new Date(f.trialEnd).toISOString());
 const response=await createCheckout(purchase('CREDIT_CARD'),f.env,'owner',f.now);
 assert.equal(response.status,201);
 assert.deepEqual(received.billingTypes,['CREDIT_CARD']);
 assert.deepEqual(received.chargeTypes,['RECURRENT']);
 const intent=f.sql.prepare('SELECT payment_method,courtesy_credit_ms FROM billing_checkout_intents').get();
 assert.equal(intent.payment_method,'CREDIT_CARD');
 assert.equal(intent.courtesy_credit_ms,courtesyCreditForCard(f.now,f.trialEnd));
 assert.equal((await (await billingStatusResponse(f.env,'owner',f.now)).json()).canStart,false);
 await assert.rejects(createCheckout(purchase('PIX'),f.env,'owner',f.now),{code:'billing_checkout_already_open'});
});

test('PIX purchase during courtesy never adds a credit to recurring card metadata',async t=>{
 const f=setup(t);let received;
 t.mock.method(globalThis,'fetch',async(request,opts)=>{
  received=JSON.parse(opts.body);
  return Response.json({id:'checkout_pix'});
 });
 const response=await createCheckout(purchase('PIX'),f.env,'owner',f.now);
 assert.equal(response.status,201);
 assert.deepEqual(received.billingTypes,['PIX']);
 assert.deepEqual(received.chargeTypes,['DETACHED']);
 assert.equal(received.subscription,undefined);
 const intent=f.sql.prepare('SELECT payment_method,courtesy_credit_ms FROM billing_checkout_intents').get();
 assert.equal(intent.payment_method,'PIX');
 assert.equal(intent.courtesy_credit_ms,0);
});

test('a paid period blocks extra purchases; expiration permits a single new attempt',async t=>{
 const f=setup(t);
 f.sql.prepare("INSERT INTO access_subscriptions(id,owner_uid,provider,provider_reference,cadence,status,paid_until,updated_at) VALUES('sub','owner','asaas','remote','monthly','active',?,?)")
  .run(f.now+30*86400000,f.now);
 assert.equal((await purchaseWindow(f.env,'owner',f.now)).canPurchase,false);
 await assert.rejects(createCheckout(purchase('PIX'),f.env,'owner',f.now),{code:'billing_access_still_active'});
 f.sql.prepare("UPDATE access_subscriptions SET paid_until=? WHERE id='sub'").run(f.now-1);
 assert.equal((await purchaseWindow(f.env,'owner',f.now)).canPurchase,true);
});

test('production PIX remains opt-in and never leaks from DEV configuration',()=>{
 const env={ENVIRONMENT:'prod',BILLING_ENABLED:'true',BILLING_CHECKOUT_ENABLED:'true',
  ASAAS_API_KEY:'$aact_prod_'+'k'.repeat(32),ASAAS_WEBHOOK_TOKEN:'w'.repeat(48)};
 assert.equal(checkoutEnabled(env,'arbitrary'),false);
 assert.equal(pixEnabled({...env,BILLING_PIX_ENABLED:'true'},'arbitrary'),false);
 assert.equal(pixEnabled({...env,BILLING_PIX_ENABLED:'true',BILLING_CHECKOUT_TEST_UIDS:'qa-user'},'qa-user'),true);
 assert.equal(pixEnabled({...env,BILLING_PIX_ENABLED:'false',BILLING_CHECKOUT_TEST_UIDS:'qa-user'},'qa-user'),false);
 assert.equal(pixEnabled({...env,BILLING_PIX_ENABLED:'true',BILLING_PUBLIC_ROLLOUT_ENABLED:'true'},'arbitrary'),true);
});
