import test from 'node:test';
import assert from 'node:assert/strict';
import {database} from './helpers/database.mjs';
import {ingestAsaasWebhook,parseAsaasEvent} from '../src/billing-webhook.ts';
import {handle} from '../src/index.ts';

const TOKEN='w'.repeat(48);
const mkEnv=(DB,overrides={})=>({
  ENVIRONMENT:'dev',BILLING_ENABLED:'true',ASAAS_API_KEY:'$aact_hmlg_'+'k'.repeat(32),
  ASAAS_WEBHOOK_TOKEN:TOKEN,DB,...overrides
});
const fixture=database;
function request(event,options={}){
  return new Request('https://roteiva-api-dev.roteiva-dev.workers.dev/billing/webhooks/asaas',{
    method:'POST',headers:{'Content-Type':'application/json','asaas-access-token':TOKEN,...options.headers},
    body:typeof event==='string'?event:JSON.stringify(event)
  });
}
const payment={id:'evt_05b708f961d739ea7eba7e4db318f621&368604920',
  event:'PAYMENT_RECEIVED',dateCreated:'2026-11-20 12:00:00',
  payment:{id:'pay_080225913252',subscription:'sub_0102',customer:'cus_007',
    cardHolderName:'SECRET SHOULD NOT BE STORED',creditCard:{number:'4111111111111111'}}};

test('unknown and partial events are review-only and cannot grant access',()=>{
  assert.deepEqual(parseAsaasEvent({...payment,event:'PROVIDER_NEW_TYPE'}).status,'review');
  assert.equal(parseAsaasEvent({id:'evt_other',event:'CHECKOUT_PAID'}).status,'review');
  assert.equal(parseAsaasEvent(payment).status,'pending');
  assert.equal(parseAsaasEvent(payment).subscriptionRef,'sub_0102');
  assert.throws(()=>parseAsaasEvent({event:'PAYMENT_RECEIVED'}),{code:'billing_invalid_event'});
  assert.throws(()=>parseAsaasEvent({id:'evt_a',event:'not upper case'}),{code:'billing_invalid_event'});
});
test('disabled, incomplete or production configuration rejects before reading or storing',async()=>{
  const d=fixture();
  try{
    for(const cfg of [
      {BILLING_ENABLED:undefined},
      {ASAAS_API_KEY:undefined},
      {ASAAS_WEBHOOK_TOKEN:undefined},
      {ENVIRONMENT:'prod'}
    ]){
      await assert.rejects(ingestAsaasWebhook(request(payment),mkEnv(d.DB,cfg)),{code:'not_found'});
    }
    assert.equal(d.sql.prepare('SELECT COUNT(*) AS n FROM billing_webhook_events').get().n,0);
  }finally{d.close();}
});
test('secret checked before parsing body; wrong method and content-type fail closed',async()=>{
  const d=fixture();
  try{
    await assert.rejects(ingestAsaasWebhook(request('{ malformed', {headers:{'asaas-access-token':'x'.repeat(48)}}),mkEnv(d.DB)),{code:'billing_webhook_unauthorized'});
    await assert.rejects(ingestAsaasWebhook(request(payment,{headers:{'asaas-access-token':'x'.repeat(400)}}),mkEnv(d.DB)),{code:'billing_webhook_unauthorized'});
    await assert.rejects(ingestAsaasWebhook(request(payment,{headers:{'Content-Type':'text/plain'}}),mkEnv(d.DB)),{code:'billing_invalid_content_type'});
    await assert.rejects(ingestAsaasWebhook(request('{'),mkEnv(d.DB)),{code:'billing_invalid_event'});
    assert.equal(d.sql.prepare('SELECT COUNT(*) AS n FROM billing_webhook_events').get().n,0);
  }finally{d.close();}
});
test('oversized stream is rejected without storage',async()=>{
  const d=fixture();
  try{
    const oversized=JSON.stringify({...payment,padding:'A'.repeat(70000)});
    await assert.rejects(ingestAsaasWebhook(request(oversized),mkEnv(d.DB)),{code:'billing_event_too_large'});
    assert.equal(d.sql.prepare('SELECT COUNT(*) AS n FROM billing_webhook_events').get().n,0);
  }finally{d.close();}
});
test('durable inbox acknowledges once and deduplicates replays before financial effects',async()=>{
  const d=fixture();
  try{
    const env=mkEnv(d.DB);
    const [first,second]=await Promise.all([
      ingestAsaasWebhook(request(payment),env),
      ingestAsaasWebhook(request({...payment,payment:{id:'pay_tampered'}}),env)
    ]);
    assert.equal(first.status,200);assert.equal(second.status,200);
    assert.equal(d.sql.prepare('SELECT COUNT(*) AS n FROM billing_webhook_events').get().n,1);
    const row=d.sql.prepare('SELECT * FROM billing_webhook_events WHERE provider=? AND event_id=?')
      .get('asaas',payment.id);
    assert.equal(row.event_type,'PAYMENT_RECEIVED');
    assert.equal(row.resource_type,'payment');
    assert.ok(['pay_080225913252','pay_tampered'].includes(row.resource_ref));
    assert.ok([null,'sub_0102'].includes(row.subscription_ref));
    assert.equal(row.status,'pending');
    assert.equal(row.attempts,0);
    assert.equal(row.processed_at,null);
    assert.equal(d.sql.prepare('SELECT COUNT(*) AS n FROM access_subscriptions').get().n,0);
    assert.equal(d.sql.prepare('SELECT COUNT(*) AS n FROM access_grants').get().n,0);
    assert.equal(d.sql.prepare('PRAGMA foreign_key_check').all().length,0);
    const serialized=JSON.stringify(row);
    assert.equal(serialized.includes('SECRET SHOULD NOT BE STORED'),false);
    assert.equal(serialized.includes('4111111111111111'),false);
  }finally{d.close();}
});
test('unknown provider fields do not break the webhook queue',async()=>{
  const d=fixture();
  try{
    assert.equal((await ingestAsaasWebhook(request({id:'evt_future',event:'FUTURE_EVENT',secret:'ignored',other:{a:1}}),mkEnv(d.DB))).status,200);
    const row=d.sql.prepare('SELECT * FROM billing_webhook_events WHERE event_id=?').get('evt_future');
    assert.equal(row.status,'review');assert.equal(row.resource_ref,null);
    assert.equal(row.resource_type,'other');
  }finally{d.close();}
});
test('storage failure returns retryable 503; successful retry persists once',async()=>{
  const d=fixture();
  try{
    const env=mkEnv({prepare(){throw Error('database unavailable: sensitive detail');}});
    await assert.rejects(ingestAsaasWebhook(request(payment),env),{code:'billing_event_persist_unavailable'});
    const successful=await ingestAsaasWebhook(request(payment),mkEnv(d.DB));
    assert.equal(successful.status,200);
    assert.equal(d.sql.prepare('SELECT COUNT(*) AS n FROM billing_webhook_events').get().n,1);
  }finally{d.close();}
});
test('main router rejects unauthenticated webhook if billing unavailable, preserving health',async()=>{
  const d=fixture();
  try{
    const env=mkEnv(d.DB,{
      BILLING_ENABLED:undefined,FIREBASE_PROJECT_ID:'roteiva-web-dev',
      FRONTEND_ORIGIN:'https://roteiva-web-dev.web.app',
      OAUTH_REDIRECT_URI:'https://roteiva-api-dev.roteiva-dev.workers.dev/oauth/drive/callback',
      DROPBOX_ENABLED:'false',
      API_RATE_LIMIT:{limit:async()=>({success:true})}
    });
    const blocked=await handle(request(payment),env);
    assert.equal(blocked.status,404);
    assert.equal((await blocked.json()).error.code,'not_found');
    const health=await handle(new Request('https://roteiva-api-dev.roteiva-dev.workers.dev/health'),env);
    assert.equal(health.status,200);
    assert.equal((await health.json()).environment,'dev');
    assert.equal(d.sql.prepare('SELECT COUNT(*) AS n FROM billing_webhook_events').get().n,0);
  }finally{d.close();}
});
