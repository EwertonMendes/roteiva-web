
import test from 'node:test';
import assert from 'node:assert/strict';
import {database} from './helpers/database.mjs';
import {periodEnd} from '../src/billing-period.ts';
import {requestUpgrade,recoverUpgrade} from '../src/billing-upgrade.ts';
import {billingStatusResponse} from '../src/billing.ts';
import {ingestAsaasWebhook} from '../src/billing-webhook.ts';
import {reconcileBilling} from '../src/billing-reconciliation.ts';
import {handle} from '../src/index.ts';
import {activeState,PAYMENT_GRACE_MS} from '../src/access.ts';
import {cancelRenewal,retryBillingCancellation} from '../src/billing-management.ts';

const now=Date.now();
const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
const paidUntil=periodEnd(today,'monthly');
const effective=new Date(paidUntil).toISOString().slice(0,10);
const origin='https://roteiva-web-dev.web.app';
const api='https://roteiva-api-dev.roteiva-dev.workers.dev';
const planVersion='2026-11-v1';
const after=(code)=>new Date(periodEnd(effective,code)).toISOString().slice(0,10);

function setup(t){
  const d=database();
  t.after(d.close);
  const env={DB:d.DB,ENVIRONMENT:'dev',FRONTEND_ORIGIN:origin,FIREBASE_PROJECT_ID:'roteiva-web-dev',
    OAUTH_REDIRECT_URI:api+'/oauth/drive/callback',API_RATE_LIMIT:{limit:async()=>({success:true})},
    BILLING_ENABLED:'true',BILLING_CHECKOUT_TEST_UID:'owner',ASAAS_API_KEY:'$aact_hmlg_'+'k'.repeat(32),
    ASAAS_WEBHOOK_TOKEN:'w'.repeat(48)};
  d.sql.prepare('INSERT INTO access_accounts(owner_uid,trial_started_at,trial_ends_at,created_at,updated_at) VALUES(?,?,?,?,?)')
    .run('owner',1,604800001,now,now);
  d.sql.prepare("INSERT INTO billing_customers VALUES('owner','asaas','cus_a',?,?)").run(now,now);
  d.sql.prepare(
    "INSERT INTO billing_checkout_intents(id,owner_uid,provider,plan_code,pricing_version,amount_cents,status,provider_checkout_ref,created_at,expires_at,updated_at,first_due_on) "+
    "VALUES('intent','owner','asaas','monthly',?,3990,'ready','checkout_a',?,?,?,?)"
  ).run(planVersion,now,now+60000,now,today);
  d.sql.prepare("INSERT INTO access_subscriptions(id,owner_uid,provider,provider_reference,cadence,status,paid_until,updated_at) VALUES('contract','owner','asaas','sub_a','monthly','active',?,?)").run(paidUntil,now);
  d.sql.prepare("INSERT INTO billing_contracts(checkout_intent_id,owner_uid,subscription_id,next_due_on) VALUES('intent','owner','contract',?)").run(effective);
  d.sql.exec("UPDATE billing_checkout_intents SET status='completed'");
  d.sql.prepare(
    "INSERT INTO billing_payment_records(id,owner_uid,subscription_id,provider,provider_payment_ref,state,amount_cents,currency,due_on,verified_at,paid_at,period_ends_at,applied_at,created_at,updated_at) "+
    "VALUES('old','owner','contract','asaas','pay_old','confirmed',3990,'BRL',?,?,?,?,?,?,?)"
  ).run(today,now,now,paidUntil,now,now,now);
  return {...d,env};
}

function submit(overrides={}){
  return new Request(api+'/billing/upgrade',{method:'POST',headers:{Origin:origin,'content-type':'application/json'},
    body:JSON.stringify({planCode:'yearly',catalogVersion:planVersion,effectiveOn:effective,confirmed:true,...overrides})});
}

function provider(t,{pending=false,loseResponse=false,extraPending=false,onPut}={}){
  let updated=false,calls=0,removals=0,renewal={status:'PENDING'},refunds=[];
  const scheduled={id:'pay_next',customer:'cus_a',subscription:'sub_a',billingType:'CREDIT_CARD',
    originalDueDate:effective,dueDate:effective,value:39.9,status:'PENDING'};
  const base={id:'sub_a',customer:'cus_a',billingType:'CREDIT_CARD',status:'ACTIVE'};
  const current=()=>({...base,value:updated?399.9:39.9,cycle:updated?'YEARLY':'MONTHLY',
    nextDueDate:pending?after(updated?'yearly':'monthly'):effective});
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    const request=new URL(String(url));
    assert.equal(request.hostname,'api-sandbox.asaas.com');
    if(request.pathname==='/v3/subscriptions/sub_a'&&options.method==='PUT'){
      calls++;
      assert.deepEqual(JSON.parse(options.body),{value:399.9,cycle:'YEARLY',
        nextDueDate:pending?after('yearly'):effective,updatePendingPayments:pending});
      await onPut?.();
      updated=true;
      if(loseResponse)throw Error('response lost after mutation');
      return Response.json(current());
    }
    if(request.pathname==='/v3/subscriptions/sub_a'&&options.method==='DELETE'){
      removals++;
      return Response.json({id:'sub_a',deleted:true});
    }
    if(request.pathname==='/v3/subscriptions/sub_a')return Response.json(current());
    if(request.pathname==='/v3/subscriptions/sub_a/payments'){
      assert.equal(request.searchParams.get('status'),'PENDING');
      return Response.json({data:extraPending?[scheduled,{id:'older_unpaid'}]:[scheduled],hasMore:false});
    }
    if(request.pathname==='/v3/payments'){
      assert.equal(request.searchParams.get('subscription'),'sub_a');
      assert.equal(request.searchParams.get('dueDate[ge]'),effective);
      return Response.json({data:pending?[{...scheduled,value:updated?399.9:39.9}]:[],hasMore:false});
    }
    if(request.pathname==='/v3/payments/pay_next/refunds')return Response.json({data:refunds,hasMore:false});
    if(request.pathname==='/v3/payments/pay_next')return Response.json({...scheduled,value:updated?399.9:39.9,
      invoiceUrl:'https://sandbox.asaas.com/i/test-renewal',...renewal});
    if(request.pathname==='/v3/payments/pay_old')return Response.json({...scheduled,id:'pay_old',value:39.9,
      originalDueDate:today,dueDate:today,checkoutSession:'checkout_a',status:'REFUNDED'});
    throw Error('unexpected provider request');
  });
  return {calls:()=>calls,removals:()=>removals,setStatus:status=>{renewal={status};},
    setRenewal:(snapshot,returnedRefunds=[])=>{renewal=snapshot;refunds=returnedRefunds;}};
}

async function reconcile(s,kind,id){
  assert.equal((await ingestAsaasWebhook(new Request(api+'/billing/webhooks/asaas',{method:'POST',
    headers:{'content-type':'application/json','asaas-access-token':s.env.ASAAS_WEBHOOK_TOKEN},
    body:JSON.stringify({id:crypto.randomUUID(),event:kind,payment:{id}})
  }),s.env)).status,200);
  await reconcileBilling(s.env);
}

test('fast-forward renewal applies an upgrade once, after the generated invoice is paid',async t=>{
  t.mock.timers.enable({apis:['Date'],now});
  const s=setup(t),remote=provider(t,{pending:true});
  const status=async()=>await (await billingStatusResponse(s.env,'owner')).json();
  assert.deepEqual((await status()).subscription.upgradeOffer,{effectiveOn:effective,plans:['quarterly','yearly']});
  assert.equal((await handle(submit(),s.env)).status,401);
  await assert.rejects(requestUpgrade(s.env,'other',submit()),{code:'not_found'});
  await assert.rejects(requestUpgrade(s.env,'owner',submit({confirmed:false})),{code:'billing_consent_required'});
  await assert.rejects(requestUpgrade(s.env,'owner',submit({effectiveOn:today})),{code:'billing_upgrade_terms_changed'});
  await assert.rejects(requestUpgrade(s.env,'owner',submit({planCode:'monthly'})),{code:'billing_upgrade_unavailable'});
  await reconcile(s,'PAYMENT_CREATED','pay_next');
  s.sql.exec("UPDATE access_accounts SET sync_pending=0; DELETE FROM billing_access_projections");
  const results=await Promise.all([requestUpgrade(s.env,'owner',submit()),requestUpgrade(s.env,'owner',submit())]);
  assert.ok(results.some(response=>response.status===200));
  assert.equal(remote.calls(),1);
  const scheduled=(await status()).subscription;
  assert.equal(scheduled.planCode,'monthly');
  assert.equal(scheduled.amountCents,3990);
  assert.equal(scheduled.paidUntil,new Date(paidUntil).toISOString());
  assert.deepEqual(scheduled.upgrade,{planCode:'yearly',amountCents:39990,effectiveOn:effective,status:'scheduled'});
  assert.equal(scheduled.upgradeOffer,null);
  assert.equal((await requestUpgrade(s.env,'owner',submit())).status,200);
  await reconcile(s,'PAYMENT_UPDATED','pay_next');
  assert.equal(s.sql.prepare("SELECT amount_cents FROM billing_payment_records WHERE provider_payment_ref='pay_next'").get().amount_cents,39990);
  simulateProjectionDelivered(s);
  t.mock.timers.setTime(paidUntil-1);
  assert.equal((await activeState(s.env,'owner')).active,true);
  t.mock.timers.setTime(paidUntil);
  assert.equal((await activeState(s.env,'owner')).active,false);
  assert.equal((await status()).subscription.planCode,'monthly');
  t.mock.timers.setTime(paidUntil+60_000);
  remote.setRenewal({status:'CONFIRMED',paymentDate:effective});
  await reconcile(s,'PAYMENT_CONFIRMED','pay_next');
  await reconcile(s,'PAYMENT_CONFIRMED','pay_next');
  const access=s.sql.prepare("SELECT cadence,paid_until FROM access_subscriptions WHERE id='contract'").get();
  assert.equal(access.cadence,'yearly');
  assert.equal(access.paid_until,periodEnd(effective,'yearly'));
  const payments=s.sql.prepare("SELECT state,amount_cents,paid_at FROM billing_payment_records WHERE provider_payment_ref='pay_next'").all();
  assert.deepEqual(payments.map(row=>({...row})),[{state:'confirmed',amount_cents:39990,paid_at:paidUntil}]);
  assert.equal(s.sql.prepare('SELECT state FROM billing_plan_changes').get().state,'applied');
  simulateProjectionDelivered(s);
  assert.equal((await activeState(s.env,'owner')).active,true);
  const renewed=(await status()).subscription;
  assert.equal(renewed.planCode,'yearly');
  assert.equal(renewed.amountCents,39990);
  assert.equal(renewed.upgrade,null);
  await reconcile(s,'PAYMENT_REFUNDED','pay_old');
  assert.equal(s.sql.prepare("SELECT paid_until FROM access_subscriptions WHERE id='contract'").get().paid_until,periodEnd(effective,'yearly'));
  assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM access_subscriptions').get().n,1);
  assert.equal(remote.calls(),1);
});

test('lost PUT response is recovered by reading Asaas without repeating the write',async t=>{
  const s=setup(t),remote=provider(t,{loseResponse:true});
  assert.equal((await requestUpgrade(s.env,'owner',submit())).status,202);
  assert.equal((await requestUpgrade(s.env,'owner',submit())).status,202);
  s.sql.exec('UPDATE billing_plan_changes SET retry_at=0');
  await recoverUpgrade(s.env);
  assert.equal(s.sql.prepare('SELECT state FROM billing_plan_changes').get().state,'scheduled');
  assert.equal(remote.calls(),1);
});

test('a second pending invoice or a suspended account prevents any provider write',async t=>{
  const s=setup(t),remote=provider(t,{pending:true,extraPending:true});
  await assert.rejects(requestUpgrade(s.env,'owner',submit()),{code:'billing_upgrade_invoice_conflict'});
  assert.equal(remote.calls(),0);
  assert.equal(s.sql.prepare('SELECT state FROM billing_plan_changes').get().state,'rejected');
  s.sql.prepare("UPDATE access_accounts SET suspended_at=? WHERE owner_uid='owner'").run(now);
  const status=await (await billingStatusResponse(s.env,'owner')).json();
  assert.equal(status.subscription.upgradeOffer,null);
  await assert.rejects(requestUpgrade(s.env,'owner',submit()),{code:'billing_upgrade_unavailable'});
  assert.equal(remote.calls(),0);
});


function simulateProjectionDelivered(s){
  // Keep these regressions on the production SQL path with no remote Firebase service.
  s.sql.exec("UPDATE access_accounts SET sync_pending=0; DELETE FROM billing_access_projections");
}
function cancelRequest(){
  return new Request(api+'/billing/cancel',{method:'POST',headers:{Origin:origin,'content-type':'application/json'},
    body:'{"confirmed":true}'});
}

test('scheduled upgrade and declined card never advance paid access; overdue grants only the bounded grace',async t=>{
  const s=setup(t),remote=provider(t);
  await requestUpgrade(s.env,'owner',submit());
  assert.equal((await activeState(s.env,'owner',paidUntil-1)).active,true);
  assert.equal((await activeState(s.env,'owner',paidUntil)).active,false);
  await reconcile(s,'PAYMENT_CREDIT_CARD_CAPTURE_REFUSED','pay_next');
  simulateProjectionDelivered(s);
  assert.equal((await activeState(s.env,'owner',paidUntil)).active,false);
  remote.setStatus('OVERDUE');
  await reconcile(s,'PAYMENT_OVERDUE','pay_next');
  simulateProjectionDelivered(s);
  assert.equal((await activeState(s.env,'owner',paidUntil+PAYMENT_GRACE_MS-1)).active,true);
  assert.equal((await activeState(s.env,'owner',paidUntil+PAYMENT_GRACE_MS)).active,false);
  assert.equal(s.sql.prepare("SELECT paid_until FROM access_subscriptions WHERE id='contract'").get().paid_until,paidUntil);
});

test('cancel closes the unpaid upgrade invoice and preserves a late-arriving verified settlement',async t=>{
  const s=setup(t),remote=provider(t,{pending:true});
  await requestUpgrade(s.env,'owner',submit());
  await reconcile(s,'PAYMENT_CREATED','pay_next');
  simulateProjectionDelivered(s);
  assert.equal((await cancelRenewal(cancelRequest(),s.env,'owner')).status,200);
  simulateProjectionDelivered(s);
  await reconcile(s,'PAYMENT_UPDATED','pay_next');
  simulateProjectionDelivered(s);
  const state=await (await billingStatusResponse(s.env,'owner',paidUntil-1)).json();
  assert.equal(state.subscription.status,'canceled');
  assert.equal(state.subscription.upgrade,null);
  assert.deepEqual(state.payments[0],{state:'canceled_invoice',amountCents:39990,dueOn:effective,invoiceUrl:null});
  assert.equal((await activeState(s.env,'owner',paidUntil)).active,false);

  // The provider can already have captured the invoice before processing DELETE.
  remote.setStatus('CONFIRMED');
  await reconcile(s,'PAYMENT_CONFIRMED','pay_next');
  simulateProjectionDelivered(s);
  const settled=await (await billingStatusResponse(s.env,'owner',paidUntil+1000)).json();
  assert.equal(settled.subscription.status,'canceled');
  assert.equal(settled.subscription.planCode,'yearly');
  assert.equal(settled.subscription.paidUntil,new Date(periodEnd(effective,'yearly')).toISOString());
  assert.equal(remote.removals(),1);
});

test('cancellation requested during the provider upgrade is queued without racing the PUT',async t=>{
  const s=setup(t);
  const remote=provider(t,{onPut:async()=>{
    assert.equal((await cancelRenewal(cancelRequest(),s.env,'owner')).status,202);
    assert.equal(remote.removals(),0);
  }});
  await requestUpgrade(s.env,'owner',submit());
  await retryBillingCancellation(s.env);
  simulateProjectionDelivered(s);
  assert.equal(remote.removals(),1);
  assert.equal(s.sql.prepare("SELECT status FROM access_subscriptions WHERE id='contract'").get().status,'canceled');
  assert.equal((await activeState(s.env,'owner',paidUntil)).active,false);
});

test('verified partial refund withdraws only the affected paid period and resists stale payment events',async t=>{
  const s=setup(t),remote=provider(t);
  await requestUpgrade(s.env,'owner',submit());
  remote.setStatus('CONFIRMED');
  await reconcile(s,'PAYMENT_CONFIRMED','pay_next');
  simulateProjectionDelivered(s);
  remote.setRenewal({status:'REFUND_IN_PROGRESS',refunds:[{status:'PENDING',value:10}]});
  await reconcile(s,'PAYMENT_REFUND_IN_PROGRESS','pay_next');
  simulateProjectionDelivered(s);
  assert.equal((await activeState(s.env,'owner',paidUntil+1000)).active,true);

  // A historical event originally went to manual review. It is retried once
  // under the new reader without replaying the refund mutation.
  remote.setRenewal({status:'CONFIRMED',value:389.9,originalValue:399.9},[
    {status:'DONE',value:4},{status:'DONE',value:6},{status:'CANCELLED',value:3},{status:'PENDING',value:12},
  ]);
  s.sql.prepare("INSERT INTO billing_webhook_events(provider,event_id,event_type,resource_type,resource_ref,status,received_at,updated_at,processed_at,attempts) "+
    "VALUES('asaas','legacy_partial','PAYMENT_PARTIALLY_REFUNDED','payment','pay_next','review',?,?,?,1)").run(now,now,now);
  await reconcileBilling(s.env);
  simulateProjectionDelivered(s);
  const status=await (await billingStatusResponse(s.env,'owner',paidUntil-1)).json();
  assert.deepEqual(status.payments[0],{state:'partial_refund',amountCents:39990,refundedAmountCents:1000,dueOn:effective,invoiceUrl:null});
  assert.equal(status.access.active,true);
  assert.equal(status.subscription.paidUntil,new Date(paidUntil).toISOString());
  assert.equal((await activeState(s.env,'owner',paidUntil)).active,false);
  assert.equal(s.sql.prepare("SELECT status FROM billing_webhook_events WHERE event_id='legacy_partial'").get().status,'processed');

  remote.setStatus('CONFIRMED');
  await reconcile(s,'PAYMENT_RECEIVED','pay_next');
  assert.equal((await activeState(s.env,'owner',paidUntil)).active,false);
  assert.equal(s.sql.prepare("SELECT refunded_amount_cents FROM billing_payment_records WHERE provider_payment_ref='pay_next'").get().refunded_amount_cents,1000);
  remote.setRenewal({status:'REFUNDED',value:0,originalValue:399.9});
  await reconcile(s,'PAYMENT_REFUNDED','pay_next');
  simulateProjectionDelivered(s);
  assert.equal(s.sql.prepare("SELECT refunded_amount_cents FROM billing_payment_records WHERE provider_payment_ref='pay_next'").get().refunded_amount_cents,39990);
  assert.equal((await activeState(s.env,'owner',paidUntil-1)).active,true);
});


test('a captured renewal still funds the consented period after an ambiguous upgrade and confirmed cancellation',async t=>{
  const s=setup(t),remote=provider(t,{loseResponse:true});
  assert.equal((await requestUpgrade(s.env,'owner',submit())).status,202);
  assert.equal((await cancelRenewal(cancelRequest(),s.env,'owner')).status,200);
  simulateProjectionDelivered(s);
  assert.equal((await activeState(s.env,'owner',paidUntil)).active,false);
  remote.setStatus('CONFIRMED');
  await reconcile(s,'PAYMENT_CONFIRMED','pay_next');
  simulateProjectionDelivered(s);

  const confirmed=await (await billingStatusResponse(s.env,'owner',paidUntil+1000)).json();
  assert.equal(confirmed.subscription.status,'canceled');
  assert.equal(confirmed.subscription.planCode,'yearly');
  assert.equal(confirmed.subscription.paidUntil,new Date(periodEnd(effective,'yearly')).toISOString());
  assert.equal(s.sql.prepare('SELECT state FROM billing_plan_changes').get().state,'applied');
  assert.equal(remote.calls(),1);
});
