import test from 'node:test';
import assert from 'node:assert/strict';
import {database} from './helpers/database.mjs';
import {createCheckout} from '../src/billing-checkout.ts';
import {abandonUnpaidCheckout} from '../src/billing-checkout-change.ts';
import {ingestAsaasWebhook} from '../src/billing-webhook.ts';
import {reconcileBilling} from '../src/billing-reconciliation.ts';
import {buildDetachedPixCheckout,buildRecurringCardCheckout} from '../src/billing-checkout-contract.ts';

const base='https://roteiva-api-dev.roteiva-dev.workers.dev';
const origin='https://roteiva-web-dev.web.app';
const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(Date.now());
function fixture(t){
 const d=database();t.after(d.close);
 const now=Date.now();
 d.sql.prepare('INSERT INTO access_accounts(owner_uid,trial_started_at,trial_ends_at,created_at,updated_at) VALUES(?,?,?,?,?)')
   .run('owner',0,604800000,now,now);
 return {...d,env:{DB:d.DB,ENVIRONMENT:'dev',FRONTEND_ORIGIN:origin,
  BILLING_ENABLED:'true',BILLING_CHECKOUT_ENABLED:'true',BILLING_PIX_ENABLED:'true',BILLING_CHECKOUT_TEST_UID:'owner',
  ASAAS_API_KEY:'$aact_hmlg_'+'k'.repeat(32),ASAAS_WEBHOOK_TOKEN:'w'.repeat(48)}};
}
const request=(planCode='monthly',paymentMethod='PIX')=>new Request(base+'/billing/checkout',{
 method:'POST',headers:{'content-type':'application/json'},
 body:JSON.stringify({planCode,catalogVersion:'2026-11-v1',acceptedImmediateCharge:true,
  ...(paymentMethod==='PIX'?{paymentMethod}:{}),
 })});
async function notify(env,event,kind,id){
 const value={id:crypto.randomUUID(),event,[kind]:{id}};
 const r=await ingestAsaasWebhook(new Request(base+'/billing/webhooks/asaas',{
  method:'POST',headers:{'content-type':'application/json','asaas-access-token':env.ASAAS_WEBHOOK_TOKEN},
  body:JSON.stringify(value)}),env);
 assert.equal(r.status,200);
}
function payment(status='RECEIVED',overrides={}){
 return {id:'payment_pix',billingType:'PIX',checkoutSession:'checkout_pix',subscription:null,
   customer:'customer_pix',value:39.9,status,originalDueDate:today,paymentDate:today,...overrides};
}
test('Pix checkout is detached, server-priced, callback-restricted and distinct from card',()=>{
 const args={planCode:'monthly',intentId:'d7d87e1c-4f28-4d01-91d4-2c488e0cb044',nextDueDate:'2027-01-31 15:02:38'};
 const env={ENVIRONMENT:'dev',FRONTEND_ORIGIN:origin};
 const pix=buildDetachedPixCheckout(env,args),card=buildRecurringCardCheckout(env,args);
 assert.deepEqual(pix.billingTypes,['PIX']);
 assert.deepEqual(pix.chargeTypes,['DETACHED']);
 assert.equal(pix.items[0].value,39.9);
 assert.equal(pix.subscription,undefined);
 assert.deepEqual(card.billingTypes,['CREDIT_CARD']);
 assert.equal(card.subscription.cycle,'MONTHLY');
 assert.equal(pix.callback.successUrl,origin+'/?billing=return&intent='+args.intentId);
 assert.throws(()=>buildDetachedPixCheckout({...env,FRONTEND_ORIGIN:'https://evil.example'},args),
  {code:'billing_invalid_environment'});
});
test('PIX is opt-in; card creation remains functional when PIX disabled',async t=>{
 const s=fixture(t);s.env.BILLING_PIX_ENABLED='false';
 await assert.rejects(createCheckout(request(),s.env,'owner'),{code:'not_found'});
 let posts=0;
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  posts++;const data=JSON.parse(options.body);
  assert.deepEqual(data.billingTypes,['CREDIT_CARD']);
  assert.deepEqual(data.chargeTypes,['RECURRENT']);
  return Response.json({id:'card_checkout'});
 });
 const response=await createCheckout(request('monthly','CREDIT_CARD'),s.env,'owner');
 assert.equal(response.status,201);assert.equal(posts,1);
 assert.equal(s.sql.prepare('SELECT payment_method FROM billing_checkout_intents').get().payment_method,'CREDIT_CARD');
});
test('PIX stays fenced in CONFIRMED (PF caution), RECEIVED grants exactly once; refund revokes only PIX period',async t=>{
 const s=fixture(t);
 let current=payment('CONFIRMED');
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  const path=String(url);
  if(path.endsWith('/checkouts'))return Response.json({id:'checkout_pix'});
  if(path.includes('/payments?checkoutSession=checkout_pix'))return Response.json({data:[current],hasMore:false});
  if(path.endsWith('/payments/payment_pix'))return Response.json(current);
  throw Error('unexpected provider request: '+path);
 });
 const checkout=await createCheckout(request(),s.env,'owner');
 assert.equal(checkout.status,201);
 assert.equal(s.sql.prepare('SELECT payment_method FROM billing_checkout_intents').get().payment_method,'PIX');
 await notify(s.env,'CHECKOUT_PAID','checkout','checkout_pix');
 await reconcileBilling(s.env);
 assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM access_subscriptions').get().n,0);
 current=payment('RECEIVED');
 await notify(s.env,'PAYMENT_RECEIVED','payment','payment_pix');
 await reconcileBilling(s.env);
 assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM access_subscriptions').get().n,1);
 assert.equal(s.sql.prepare("SELECT status FROM billing_checkout_intents").get().status,'completed');
 assert.equal(s.sql.prepare('SELECT payment_method,state FROM billing_payment_records').get().payment_method,'PIX');
 assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM billing_contracts').get().n,0);
 const paidUntil=s.sql.prepare('SELECT paid_until FROM access_subscriptions').get().paid_until;
 assert.ok(paidUntil>Date.now());
 await notify(s.env,'PAYMENT_RECEIVED','payment','payment_pix');
 await reconcileBilling(s.env);
 assert.equal(s.sql.prepare('SELECT paid_until FROM access_subscriptions').get().paid_until,paidUntil);
 assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM billing_payment_records').get().n,1);
 current=payment('REFUNDED');
 await notify(s.env,'PAYMENT_REFUNDED','payment','payment_pix');
 await reconcileBilling(s.env);
 assert.equal(s.sql.prepare('SELECT status,paid_until FROM access_subscriptions').get().status,'expired');
 assert.equal(s.sql.prepare('SELECT paid_until FROM access_subscriptions').get().paid_until,0);
 assert.equal(s.sql.prepare('SELECT state FROM billing_payment_records').get().state,'refunded');
});
test('switch cancels only a verified unpaid checkout; old attempt persists for audit',async t=>{
 const s=fixture(t);
 let posts=0,cancels=0,paid=false;
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  const path=String(url);
  if(path.endsWith('/checkouts')){posts++;return Response.json({id:'checkout_'+posts});}
  if(path.endsWith('/checkouts/checkout_1/cancel')){
    cancels++;
    return paid?new Response('{}',{status:400}):Response.json({id:'checkout_1',status:'CANCELED'});
  }
  if(path.includes('/payments?checkoutSession=checkout_1'))return Response.json({data:paid?[payment('RECEIVED')]:[],hasMore:false});
  throw Error('unexpected request: '+path);
 });
 await createCheckout(request('monthly'),s.env,'owner');
 const old=s.sql.prepare('SELECT id FROM billing_checkout_intents').get().id;
 const abandon=()=>abandonUnpaidCheckout(new Request(base+'/billing/checkout/abandon',{method:'POST',
  headers:{'content-type':'application/json'},body:JSON.stringify({intentId:old,confirmed:true})}),s.env,'owner');
 paid=true;
 await assert.rejects(abandon(),{code:'billing_checkout_payment_verifying'});
 assert.equal(cancels,1);
 paid=false;
 assert.equal((await abandon()).status,200);
 assert.equal(cancels,2);
 assert.equal(s.sql.prepare('SELECT status FROM billing_checkout_intents WHERE id=?').get(old).status,'canceled');
 await createCheckout(request('yearly'),s.env,'owner');
 assert.equal(posts,2);
 assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM billing_checkout_intents').get().n,2);
 assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM billing_contracts').get().n,0);
});

test('Provider 400 on Pix is definitive, logged without PII and does not block existing card',async t=>{
 const s=fixture(t);
 const warnings=[];
 t.mock.method(console,'warn',value=>warnings.push(String(value)));
 let posted=0;
 t.mock.method(globalThis,'fetch',async(url,options)=>{
   assert.ok(String(url).endsWith('/checkouts'));
   posted++;
   const payload=JSON.parse(options.body);
   if(payload.billingTypes[0]==='PIX')return Response.json({errors:[
     {code:'invalid_object',description:'Campo billingTypes não habilitado para contato client@example.com CPF 12345678900'}
   ]},{status:400});
   assert.deepEqual(payload.billingTypes,['CREDIT_CARD']);
   assert.deepEqual(payload.chargeTypes,['RECURRENT']);
   return Response.json({id:'checkout_card_after_pix'});
 });
 await assert.rejects(createCheckout(request('monthly','PIX'),s.env,'owner'),
   {status:422,code:'billing_pix_checkout_rejected'});
 assert.deepEqual(s.sql.prepare('SELECT status,payment_method,provider_checkout_ref FROM billing_checkout_intents ORDER BY created_at').all().map(row=>({...row})),
   [{status:'failed',payment_method:'PIX',provider_checkout_ref:null}]);
 assert.equal(warnings.length,1);
 assert.match(warnings[0],/billing_pix_checkout_rejected/);
 assert.match(warnings[0],/invalid_object/);
 assert.doesNotMatch(warnings[0],/client@example|12345678900/);
 const response=await createCheckout(request('monthly','CREDIT_CARD'),s.env,'owner');
 assert.equal(response.status,201);
 assert.equal(posted,2);
 assert.equal(s.sql.prepare("SELECT COUNT(*) AS n FROM billing_checkout_intents WHERE status='ready' AND payment_method='CREDIT_CARD'").get().n,1);
});
