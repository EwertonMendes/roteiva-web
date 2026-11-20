import test from 'node:test';
import assert from 'node:assert/strict';
import {database} from './helpers/database.mjs';
import {billingStatusResponse} from '../src/billing.ts';
import {handle} from '../src/index.ts';

function fixture(){
  const d=database();
  const now=Date.now(),t=now-10*86400000;
  d.sql.prepare('INSERT INTO access_accounts(owner_uid,trial_started_at,trial_ends_at,created_at,updated_at) VALUES(?,?,?,?,?)')
    .run('owner',t,t+7*86400000,now,now);
  return d;
}
test('billing status is readable after trial expiry; no grant, write or provider call',async()=>{
 const d=fixture();
 try{
  const response=await billingStatusResponse({DB:d.DB},'owner');
  assert.equal(response.status,200);
  const status=await response.json();
  assert.equal(status.checkoutAvailable,false);
  assert.equal(status.access.active,false);
  assert.equal(status.subscription,null);
  assert.equal(d.sql.prepare('SELECT count(*) n FROM access_subscriptions').get().n,0);
 }finally{d.close();}
});
test('billing status exposes only own latest contract, not external provider identifiers',async()=>{
 const d=fixture();
 try{
  const now=Date.now();
  d.sql.prepare("INSERT INTO access_subscriptions(id,owner_uid,provider,provider_reference,cadence,status,paid_until,updated_at) VALUES(?,?,?,?,?,'active',?,?)")
    .run('sub-01','owner','asaas','secret-provider-reference','yearly',now+1000000,now);
  const state=await (await billingStatusResponse({DB:d.DB},'owner')).json();
  assert.equal(state.access.active,true);
  assert.equal(state.subscription.planCode,'yearly');
  assert.equal(state.subscription.status,'active');
  assert.equal(state.subscription.paidUntil,new Date(now+1000000).toISOString());
  assert.equal(JSON.stringify(state).includes('secret-provider-reference'),false);
  assert.equal(JSON.stringify(state).includes('owner'),false);
 }finally{d.close();}
});
test('unprovisioned account has no trial or artificial subscription',async()=>{
 const d=database();
 try{
  const state=await (await billingStatusResponse({DB:d.DB},'nonexistent')).json();
  assert.equal(state.access,null);
  assert.equal(state.subscription,null);
  assert.equal(state.checkoutAvailable,false);
 }finally{d.close();}
});
test('HTTP route denies requests without verified Firebase ID even if checkout is off',async()=>{
 const d=fixture();
 try{
  const env={DB:d.DB,ENVIRONMENT:'dev',FIREBASE_PROJECT_ID:'roteiva-web-dev',
    FRONTEND_ORIGIN:'https://roteiva-web-dev.web.app',
    OAUTH_REDIRECT_URI:'https://roteiva-api-dev.roteiva-dev.workers.dev/oauth/drive/callback',
    DROPBOX_ENABLED:'false',API_RATE_LIMIT:{limit:async()=>({success:true})}};
  const response=await handle(new Request('https://roteiva-api-dev.roteiva-dev.workers.dev/billing/status'),env);
  assert.equal(response.status,401);
  assert.equal((await response.json()).error.code,'authentication_required');
 }finally{d.close();}
});
