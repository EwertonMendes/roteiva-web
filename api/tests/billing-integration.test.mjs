import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPair,exportPKCS8} from 'jose';
import {database} from './helpers/database.mjs';
import {createCheckout,checkoutLink} from '../src/billing-checkout.ts';
import {billingStatusResponse} from '../src/billing.ts';
import {activeState} from '../src/access.ts';
import {ingestAsaasWebhook} from '../src/billing-webhook.ts';
import {reconcileBilling} from '../src/billing-reconciliation.ts';
import {requestCheckoutReturnCheck} from '../src/billing-return.ts';
import {cancelRenewal,retryBillingCancellation,stopBillingForDeletion} from '../src/billing-management.ts';
import {billingDateInstant,cents,periodEnd} from '../src/billing-period.ts';
import {handle} from '../src/index.ts';

const base='https://roteiva-api-dev.roteiva-dev.workers.dev';
const origin='https://roteiva-web-dev.web.app';
const now=Date.now();
const due=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
const {privateKey}=await generateKeyPair('RS256',{extractable:true});
const credentials=JSON.stringify({type:'service_account',project_id:'roteiva-web-dev',
  client_email:'test@roteiva-web-dev.iam.gserviceaccount.com',private_key:await exportPKCS8(privateKey),
  token_uri:'https://oauth2.googleapis.com/token'});

function setup(t){
  const db=database();
  t.after(db.close);
  for(const [uid,start] of [['owner',0],['other',0],['trial',now]]){
    db.sql.prepare('INSERT INTO access_accounts(owner_uid,trial_started_at,trial_ends_at,created_at,updated_at) VALUES(?,?,?,?,?)')
      .run(uid,start,start+604800000,now,now);
  }
  return {...db,env:{DB:db.DB,ENVIRONMENT:'dev',FRONTEND_ORIGIN:origin,FIREBASE_PROJECT_ID:'roteiva-web-dev',
    OAUTH_REDIRECT_URI:base+'/oauth/drive/callback',API_RATE_LIMIT:{limit:async()=>({success:true})},
    BILLING_ENABLED:'true',BILLING_CHECKOUT_ENABLED:'true',ASAAS_API_KEY:'$aact_hmlg_'+'k'.repeat(32),ASAAS_WEBHOOK_TOKEN:'w'.repeat(48),
    ACCOUNT_DELETION_ENABLED:'true',FIREBASE_ADMIN_CREDENTIALS_JSON:credentials}};
}
function purchase(planCode='monthly',overrides={}){
  return new Request(base+'/billing/checkout',{method:'POST',headers:{'content-type':'application/json',Origin:origin},
    body:JSON.stringify({planCode,catalogVersion:'2026-11-v1',acceptedImmediateCharge:true,...overrides})});
}
function checkoutResponse(id='checkout_a'){
  return Response.json({id,link:'https://sandbox.asaas.com/000/checkoutSession/show/'+id});
}
function providerPayment(overrides={}){
  return {id:'pay_a',customer:'cus_a',subscription:'sub_a',checkoutSession:'checkout_a',
    originalDueDate:due,paymentDate:due,billingType:'CREDIT_CARD',status:'CONFIRMED',value:39.9,...overrides};
}
function providerSubscription(overrides={}){
  return {id:'sub_a',customer:'cus_a',cycle:'MONTHLY',billingType:'CREDIT_CARD',status:'ACTIVE',value:39.9,nextDueDate:due,...overrides};
}
async function event(env,name,kind,ref,extra={}){
  const event={id:crypto.randomUUID(),event:name,[kind]:{id:ref,...extra}};
  const response=await ingestAsaasWebhook(new Request(base+'/billing/webhooks/asaas',{method:'POST',
    headers:{'content-type':'application/json','asaas-access-token':env.ASAAS_WEBHOOK_TOKEN},body:JSON.stringify(event)}),env);
  assert.equal(response.status,200);
  return event.id;
}

test('checkout authorizes an enrolled expired owner, uses catalog and sends one POST across concurrent requests',async t=>{
  const s=setup(t);
  let requests=0;
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    assert.equal(url,'https://api-sandbox.asaas.com/v3/checkouts');
    requests++;
    const body=JSON.parse(options.body);
    assert.equal(body.items[0].value,109.9);
    assert.equal(body.subscription.cycle,'QUARTERLY');
    return checkoutResponse();
  });
  await assert.rejects(createCheckout(purchase('quarterly',{value:1}),s.env,'owner'),{code:'billing_consent_required'});
  await assert.rejects(createCheckout(purchase('quarterly',{catalogVersion:'stale'}),s.env,'owner'),{code:'billing_catalog_changed'});
  await assert.rejects(createCheckout(purchase('quarterly'),s.env,'trial'),{code:'billing_access_still_active'});
  await assert.rejects(createCheckout(purchase('quarterly'),s.env,'unknown'),{code:'billing_account_ineligible'});
  const responses=await Promise.all([createCheckout(purchase('quarterly'),s.env,'owner'),createCheckout(purchase('quarterly'),s.env,'owner')]);
  assert.ok(responses.some(response=>response.status===201));
  assert.equal(requests,1);
  assert.equal((await (await createCheckout(purchase('quarterly'),s.env,'owner')).json()).url,'https://sandbox.asaas.com/000/checkoutSession/show/checkout_a');
  s.sql.exec("UPDATE billing_checkout_intents SET status='pending',checkout_path=NULL WHERE owner_uid='owner'");
  assert.equal((await (await createCheckout(purchase('quarterly'),s.env,'owner')).json()).url,'https://sandbox.asaas.com/000/checkoutSession/show/checkout_a');
  assert.equal(requests,1);
  await assert.rejects(createCheckout(purchase('yearly'),s.env,'owner'),{code:'billing_checkout_already_open'});
  assert.equal((await (await billingStatusResponse(s.env,'other')).json()).checkout,null);
  assert.equal((await handle(purchase(),s.env)).status,401);
  assert.equal((await handle(purchase(),{...s.env,BILLING_CHECKOUT_ENABLED:'false'})).status,404);
  const canary={...s.env,BILLING_CHECKOUT_ENABLED:'false',BILLING_CHECKOUT_TEST_UID:'owner'};
  assert.equal((await (await billingStatusResponse(canary,'owner')).json()).checkoutAvailable,true);
  assert.equal((await (await billingStatusResponse(canary,'other')).json()).checkoutAvailable,false);
  await assert.rejects(createCheckout(purchase(),canary,'other'),{code:'not_found'});
});

test('return recovery verifies Asaas payment immediately and still preserves cron retry',async t=>{
  const s=setup(t);
  let projection,commits=0,reads=0;
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    const path=String(url);
    if(path==='https://oauth2.googleapis.com/token')return Response.json({access_token:'test-admin'});
    if(path.includes('/documents/users/owner/access/current'))
      return projection?Response.json(projection):new Response(null,{status:404});
    if(path.includes('/documents/users/owner'))return Response.json({fields:{ownerUid:{stringValue:'owner'}},
      createTime:'2026-11-20T00:00:00Z',updateTime:'2026-11-20T00:00:01Z'});
    if(path.endsWith('/documents:commit')){
      const [,access]=JSON.parse(options.body).writes;
      projection={updateTime:new Date(now+ ++commits).toISOString(),fields:access.update.fields};
      return Response.json({});
    }
    if(path.endsWith('/checkouts'))return checkoutResponse();
    if(path.includes('/payments?checkoutSession=checkout_a')){
      reads++;
      return Response.json({data:[providerPayment()],hasMore:false});
    }
    if(path.endsWith('/subscriptions/sub_a'))return Response.json(providerSubscription());
    throw Error('unexpected network request');
  });
  assert.equal((await createCheckout(purchase(),s.env,'owner')).status,201);
  const id=s.sql.prepare('SELECT id FROM billing_checkout_intents WHERE owner_uid=?').get('owner').id;
  assert.equal((await requestCheckoutReturnCheck(s.env,'owner',id)).status,202);
  assert.equal((await requestCheckoutReturnCheck(s.env,'owner',id)).status,202);
  assert.equal(s.sql.prepare("SELECT count(*) n FROM billing_webhook_events WHERE event_id=?").get('return:'+id).n,1);
  await reconcileBilling(s.env);
  assert.equal(reads,1);
  assert.equal((await activeState(s.env,'owner')).active,true);
  assert.equal(commits,1);
  assert.equal(s.sql.prepare("SELECT status FROM billing_webhook_events WHERE event_id=?").get('return:'+id).status,'processed');
  // Independent scheduler recovery remains possible if the first provider read
  // had observed a not-yet-confirmed transaction instead.
  s.sql.exec("UPDATE billing_checkout_intents SET status='ready',recovery_after=0");
  await reconcileBilling(s.env); // schedule retry, without rereading provider immediately
  assert.equal(s.sql.prepare("SELECT count(*) n FROM billing_webhook_events WHERE event_id=?").get('recovery:'+id).n,1);
});

test('ambiguous checkout creation stays fenced across restarts and can recover from a provider event',async t=>{
  const s=setup(t);
  let posts=0;
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    if(options.method==='GET'&&String(url).includes('checkoutSession=checkout_a'))
      return Response.json({data:[],hasMore:false});
    posts++;throw Error('lost response');
  });
  assert.equal((await createCheckout(purchase(),s.env,'owner')).status,202);
  assert.equal((await createCheckout(purchase(),s.env,'owner')).status,202);
  const intent=s.sql.prepare('SELECT * FROM billing_checkout_intents').get();
  assert.equal(posts,1);
  await event(s.env,'CHECKOUT_CREATED','checkout','checkout_a',{externalReference:intent.id});
  await reconcileBilling(s.env);
  assert.equal((await (await createCheckout(purchase(),s.env,'owner')).json()).status,'ready');
  await event(s.env,'CHECKOUT_EXPIRED','checkout','checkout_a',{externalReference:intent.id});
  await reconcileBilling(s.env);
  assert.equal(s.sql.prepare('SELECT status FROM billing_checkout_intents').get().status,'expired');
  assert.equal(posts,1);
  assert.throws(()=>checkoutLink('checkout_a','https://asaas.com/checkoutSession/show/checkout_a'),{code:'billing_provider_invalid_response'});
});

test('verified payments restore projection, survive retries, renew once, and reverse only their own paid period',async t=>{
  const s=setup(t);
  let payment=providerPayment({status:'PENDING'});
  let outage=false,projection,commits=0,cancelled=0;
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    const path=String(url);
    if(path==='https://oauth2.googleapis.com/token')return Response.json({access_token:'test-admin'});
    if(path.includes('/documents/users/owner/access/current'))
      return projection?Response.json(projection):new Response(null,{status:404});
    if(path.includes('/documents/users/owner'))return Response.json({fields:{ownerUid:{stringValue:'owner'}},
      createTime:'2026-11-20T00:00:00Z',updateTime:'2026-11-20T00:00:01Z'});
    if(path.endsWith('/documents:commit')){
      if(outage)return new Response(null,{status:503});
      const [profile,access]=JSON.parse(options.body).writes;
      assert.equal(profile.currentDocument.updateTime,'2026-11-20T00:00:01Z');
      assert.equal(access.update.fields.ownerUid.stringValue,'owner');
      projection={updateTime:new Date(now+ ++commits).toISOString(),fields:access.update.fields};
      return Response.json({});
    }
    assert.equal(new URL(path).hostname,'api-sandbox.asaas.com');
    if(path.endsWith('/checkouts'))return checkoutResponse();
    if(path.includes('/payments?'))return Response.json({data:[]});
    if(path.endsWith('/payments/'+payment.id))return Response.json(payment);
    if(path.endsWith('/subscriptions/sub_a')&&options?.method==='DELETE'){
      cancelled++;
      return cancelled===1?new Response(null,{status:503}):Response.json({id:'sub_a',deleted:true});
    }
    if(path.endsWith('/subscriptions/sub_a'))return Response.json(providerSubscription());
    throw Error('unexpected provider request');
  });
  assert.equal((await createCheckout(purchase(),s.env,'owner')).status,201);
  await event(s.env,'SUBSCRIPTION_CREATED','subscription','sub_a');
  await reconcileBilling(s.env);
  assert.equal((await activeState(s.env,'owner')).active,false);
  await event(s.env,'PAYMENT_CREATED','payment','pay_a');
  await reconcileBilling(s.env);
  assert.equal((await activeState(s.env,'owner')).active,false);
  assert.equal(commits,0);
  assert.equal(s.sql.prepare('SELECT provider_customer_ref FROM billing_customers').get().provider_customer_ref,'cus_a');

  payment={...payment,status:'CONFIRMED'};
  outage=true;
  s.sql.exec("UPDATE access_accounts SET sync_pending=1 WHERE owner_uid='owner'");
  await event(s.env,'PAYMENT_CONFIRMED','payment','pay_a');
  await reconcileBilling(s.env);
  assert.equal(s.sql.prepare('SELECT state FROM billing_payment_records').get().state,'pending');
  assert.equal(s.sql.prepare('SELECT count(*) n FROM billing_access_projections').get().n,0);
  s.sql.exec("UPDATE access_accounts SET sync_pending=0 WHERE owner_uid='owner'; UPDATE billing_webhook_events SET next_attempt_at=0");
  await reconcileBilling(s.env);
  assert.equal(s.sql.prepare('SELECT state FROM billing_payment_records').get().state,'confirmed');
  await assert.rejects(activeState(s.env,'owner'),{code:'access_sync_pending'});
  assert.equal(s.sql.prepare('SELECT attempts FROM billing_access_projections').get().attempts,1);
  outage=false;
  s.sql.exec('UPDATE billing_access_projections SET next_attempt_at=0');
  await reconcileBilling(s.env);
  assert.equal((await activeState(s.env,'owner')).active,true);
  assert.equal(projection.fields.source.stringValue,'subscription');
  assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM billing_access_projections').get().n,0);

  const paidUntil=periodEnd(due,'monthly');
  await event(s.env,'PAYMENT_CREATED','payment','pay_a');
  await reconcileBilling(s.env);
  assert.equal(s.sql.prepare('SELECT paid_until FROM access_subscriptions').get().paid_until,paidUntil);
  assert.equal(commits,1);
  assert.equal((await (await billingStatusResponse(s.env,'other')).json()).payments.length,0);

  const nextDue=new Date(paidUntil).toISOString().slice(0,10);
  payment=providerPayment({id:'pay_b',checkoutSession:null,originalDueDate:nextDue,status:'OVERDUE'});
  await event(s.env,'PAYMENT_OVERDUE','payment','pay_b');
  await reconcileBilling(s.env);
  assert.equal(s.sql.prepare('SELECT status FROM access_subscriptions').get().status,'past_due');
  assert.equal((await activeState(s.env,'owner',paidUntil+86400000)).active,true);
  assert.equal((await activeState(s.env,'owner',paidUntil+3*86400000)).active,false);
  payment={...payment,status:'RECEIVED'};
  await event(s.env,'PAYMENT_RECEIVED','payment','pay_b');
  await reconcileBilling(s.env);
  const renewedUntil=periodEnd(nextDue,'monthly');
  assert.equal(s.sql.prepare('SELECT paid_until FROM access_subscriptions').get().paid_until,renewedUntil);
  payment=providerPayment({status:'REFUNDED'});
  await event(s.env,'PAYMENT_REFUNDED','payment','pay_a');
  await reconcileBilling(s.env);
  assert.equal(s.sql.prepare('SELECT paid_until FROM access_subscriptions').get().paid_until,renewedUntil);

  const cancel=()=>new Request(base+'/billing/cancel',{method:'POST',headers:{'content-type':'application/json'},body:'{"confirmed":true}'});
  assert.equal((await cancelRenewal(cancel(),s.env,'owner')).status,202);
  assert.equal((await (await billingStatusResponse(s.env,'owner')).json()).subscription.cancellation,'pending');
  s.sql.exec('UPDATE billing_contracts SET cancel_after=0');
  await retryBillingCancellation(s.env);
  await reconcileBilling(s.env);
  assert.equal((await cancelRenewal(cancel(),s.env,'owner')).status,200);
  assert.equal(cancelled,2);
  assert.equal(s.sql.prepare('SELECT status FROM access_subscriptions').get().status,'canceled');
  assert.equal(s.sql.prepare('SELECT paid_until FROM access_subscriptions').get().paid_until,renewedUntil);
  await assert.rejects(createCheckout(purchase('yearly'),s.env,'owner'),{code:'billing_access_still_active'});
  assert.equal(await stopBillingForDeletion(s.env,'owner'),true);
  payment=providerPayment({id:'pay_b',checkoutSession:null,originalDueDate:nextDue,status:'CHARGEBACK_REQUESTED'});
  await event(s.env,'PAYMENT_CHARGEBACK_REQUESTED','payment','pay_b');
  await reconcileBilling(s.env);
  assert.equal((await activeState(s.env,'owner')).active,false);
  assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM billing_payment_records').get().n,2);
  assert.equal(s.sql.prepare('PRAGMA foreign_key_check').all().length,0);
});

test('first authoritative response must match amount, customer ownership and subscription cycle',async t=>{
  const s=setup(t);
  let payment=providerPayment({value:1});
  let contract=providerSubscription({cycle:'YEARLY'});
  t.mock.method(globalThis,'fetch',async url=>{
    const path=String(url);
    if(path.endsWith('/checkouts'))return checkoutResponse();
    if(path.endsWith('/payments/pay_a'))return Response.json(payment);
    if(path.endsWith('/subscriptions/sub_a'))return Response.json(contract);
    throw Error('unexpected dependency');
  });
  await createCheckout(purchase(),s.env,'owner');
  await event(s.env,'PAYMENT_CONFIRMED','payment','pay_a');
  await reconcileBilling(s.env);
  assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM billing_payment_records').get().n,0);
  payment=providerPayment();
  await event(s.env,'PAYMENT_CONFIRMED','payment','pay_a');
  await reconcileBilling(s.env);
  assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM billing_contracts').get().n,0);
  contract=providerSubscription();
  s.sql.prepare("INSERT INTO billing_customers VALUES('other','asaas','cus_a',?,?)").run(now,now);
  await event(s.env,'PAYMENT_CONFIRMED','payment','pay_a');
  await reconcileBilling(s.env);
  assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM billing_contracts').get().n,0);
  assert.equal((await activeState(s.env,'owner')).active,false);
  assert.equal((await activeState(s.env,'other')).active,false);
});

test('deletion preserves checkout linkage on uncertainty and stops a known checkout at the provider',async t=>{
  const s=setup(t);
  let creates=0,cancels=0;
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    assert.equal(options.method,'POST');
    if(url==='https://api-sandbox.asaas.com/v3/checkouts'){
      if(++creates===1)throw Error('lost response');
      return checkoutResponse('checkout_b');
    }
    assert.equal(url,'https://api-sandbox.asaas.com/v3/checkouts/checkout_b/cancel');
    cancels++;
    return cancels===1?new Response(null,{status:503}):Response.json({id:'checkout_b',status:'CANCELED'});
  });
  assert.equal((await createCheckout(purchase(),s.env,'owner')).status,202);
  await assert.rejects(stopBillingForDeletion(s.env,'owner'),{code:'billing_deletion_checkout_unresolved'});
  assert.equal((await createCheckout(purchase(),s.env,'other')).status,201);
  await assert.rejects(stopBillingForDeletion(s.env,'other'),{code:'billing_provider_unavailable'});
  assert.equal(s.sql.prepare("SELECT status FROM billing_checkout_intents WHERE owner_uid='other'").get().status,'ready');
  assert.equal(await stopBillingForDeletion(s.env,'other'),true);
  assert.equal(s.sql.prepare("SELECT status FROM billing_checkout_intents WHERE owner_uid='other'").get().status,'canceled');
  assert.equal(s.sql.prepare("SELECT status FROM billing_checkout_intents WHERE owner_uid='owner'").get().status,'pending');
});

test('end of month and leap year use calendar cycles on the Sao Paulo billing date',()=>{
  assert.equal(periodEnd('2028-01-31','monthly'),billingDateInstant('2028-02-29'));
  assert.equal(periodEnd('2027-01-31','quarterly'),billingDateInstant('2027-04-30'));
  assert.equal(periodEnd('2028-02-29','yearly'),billingDateInstant('2029-02-28'));
  assert.equal(cents(109.9),10990);
  assert.equal(cents(39.901),null);
});
