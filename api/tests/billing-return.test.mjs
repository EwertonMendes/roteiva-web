import test from 'node:test';
import assert from 'node:assert/strict';
import {database} from './helpers/database.mjs';
import {requestCheckoutReturnCheck} from '../src/billing-return.ts';
import {handle} from '../src/index.ts';

const intentId='d7d87e1c-4f28-4d01-91d4-2c488e0cb044';
const api='https://roteiva-api-dev.roteiva-dev.workers.dev';
const envBase={ENVIRONMENT:'dev',FRONTEND_ORIGIN:'https://roteiva-web-dev.web.app',
  FIREBASE_PROJECT_ID:'roteiva-web-dev',OAUTH_REDIRECT_URI:api+'/oauth/drive/callback',
  BILLING_ENABLED:'true',ASAAS_API_KEY:'$aact_hmlg_'+'a'.repeat(32),
  ASAAS_WEBHOOK_TOKEN:'b'.repeat(48),
  API_RATE_LIMIT:{limit:async()=>({success:true})}};
function setup(t){
  const db=database();t.after(db.close);
  const now=Date.now();
  for(const uid of ['owner','other']){
    db.sql.prepare('INSERT INTO access_accounts(owner_uid,trial_started_at,trial_ends_at,created_at,updated_at) VALUES(?,?,?,?,?)')
      .run(uid,0,604800000,now,now);
  }
  db.sql.prepare("INSERT INTO billing_checkout_intents(id,owner_uid,provider,plan_code,pricing_version,amount_cents,status,provider_checkout_ref,created_at,expires_at,updated_at) VALUES(?,'owner','asaas','monthly','2026-11-v1',3990,'ready','checkout_a',?,?,?)")
    .run(intentId,now,now+1800000,now);
  return {...db,env:{...envBase,DB:db.DB}};
}

test('authenticated return queues one durable verified checkout recovery, never a grant or payment',async t=>{
  const d=setup(t);
  const first=await requestCheckoutReturnCheck(d.env,'owner',intentId);
  assert.equal(first.status,202);
  assert.equal((await first.json()).status,'checking');
  const second=await requestCheckoutReturnCheck(d.env,'owner',intentId);
  assert.equal(second.status,202);
  assert.equal(d.sql.prepare("SELECT count(*) n FROM billing_webhook_events WHERE event_id=?").get('recovery:'+intentId).n,1);
  assert.equal(d.sql.prepare('SELECT count(*) n FROM access_subscriptions').get().n,0);
  assert.equal(d.sql.prepare('SELECT count(*) n FROM billing_payment_records').get().n,0);
  assert.equal((await (await requestCheckoutReturnCheck(d.env,'other',intentId)).json()).status,'not_found');
  assert.equal((await (await requestCheckoutReturnCheck(d.env,'owner',null)).json()).status,'checking');
  await assert.rejects(requestCheckoutReturnCheck(d.env,'owner','../../other'),{code:'billing_invalid_intent'});
  await assert.rejects(requestCheckoutReturnCheck({...d.env,ENVIRONMENT:'prod'},'owner',intentId),{code:'not_found'});
  d.sql.exec("UPDATE billing_checkout_intents SET status='completed' WHERE owner_uid='owner'");
  assert.equal((await (await requestCheckoutReturnCheck(d.env,'owner',intentId)).json()).status,'processing');
  d.sql.exec("UPDATE billing_checkout_intents SET status='expired' WHERE owner_uid='owner'");
  assert.equal((await (await requestCheckoutReturnCheck(d.env,'owner',intentId)).json()).status,'closed');
});

test('checkout-return verification rejects anonymous callers and foreign browser origins',async t=>{
  const d=setup(t);
  const request=(origin)=>new Request(api+'/billing/return/verify',{method:'POST',headers:{
    'Content-Type':'application/json',Origin:origin},body:JSON.stringify({intentId})});
  const denied=await handle(request('https://roteiva-web-dev.web.app'),d.env);
  assert.equal(denied.status,401);
  const foreign=await handle(request('https://example.com'),d.env);
  assert.equal(foreign.status,403);
  assert.equal(d.sql.prepare('SELECT count(*) n FROM billing_webhook_events').get().n,0);
});
