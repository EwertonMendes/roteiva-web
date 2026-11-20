import test from 'node:test';
import assert from 'node:assert/strict';
import {billingNotice} from '../src/billing-notices.ts';
import {billingStatusResponse} from '../src/billing.ts';
import {database} from './helpers/database.mjs';
const DAY=86400000;
const NOW=Date.UTC(2026,10,20,12,0,0);
const state=(source,expires,extras={})=>({
  active:true,source,accessUntil:new Date(NOW+expires).toISOString(),
  unlimited:false,suspended:false,trialEndsAt:new Date(NOW+7*DAY).toISOString(),
  trialDays:7,...extras
});
const sub=(status,paidUntil)=>({status,paid_until:paidUntil});
test('read-only lifecycle classification covers trial, gift, paid, lapse and admin block',()=>{
 const checks=[
  [null,null,'unregistered',null,'info'],
  [state('trial',7*DAY),null,'trial',7,'info'],
  [state('trial',3*DAY),null,'trial_ending',3,'warning'],
  [state('trial',DAY/2),null,'trial_ending',1,'warning'],
  [state('trial',-DAY,{active:false}),null,'expired',0,'warning'],
  [state('complimentary',10*DAY),null,'complimentary',10,'info'],
  [state('complimentary',DAY),null,'complimentary_ending',1,'warning'],
  [state('subscription',10*DAY),sub('active',NOW+10*DAY),'subscription',10,'info'],
  [state('subscription',2*DAY),sub('active',NOW+2*DAY),'subscription_renewal_soon',2,'info'],
  [state('subscription',30*DAY),sub('canceled',NOW+30*DAY),'canceled_until',30,'warning'],
  [state('subscription',2*DAY),sub('past_due',NOW-DAY),'payment_grace',2,'warning'],
  [state('subscription',-DAY,{active:false}),sub('past_due',NOW-4*DAY),'expired',0,'warning'],
  [state('subscription',10*DAY,{suspended:true,active:false}),sub('active',NOW+10*DAY),'suspended',null,'critical'],
  [state('complimentary',30*DAY,{unlimited:true}),sub('past_due',NOW-DAY),'lifetime',null,'info'],
  [state('complimentary',30*DAY),sub('past_due',NOW-DAY),'complimentary',30,'info'],
 ];
 for(const [access,subscription,code,daysRemaining,severity] of checks){
  assert.deepEqual(billingNotice(access,subscription,NOW),{code,daysRemaining,severity},code);
 }
});
test('boundary timing is exact and never extends an expired right',()=>{
 const exp=state('trial',1);
 assert.equal(billingNotice(exp,null,NOW).daysRemaining,1);
 assert.equal(billingNotice(exp,null,NOW+1).code,'expired');
 const three=state('trial',3*DAY+1);
 assert.equal(billingNotice(three,null,NOW).code,'trial');
 assert.equal(billingNotice(three,null,NOW+1).code,'trial_ending');
});
test('read-only status exposes notice but does not change subscriptions or grants',async()=>{
 const d=database();
 try{
  const t=NOW-6*DAY;
  d.sql.prepare('INSERT INTO access_accounts(owner_uid,trial_started_at,trial_ends_at,created_at,updated_at) VALUES(?,?,?,?,?)')
    .run('owner',t,t+7*DAY,t,t);
  const initialAccount=d.sql.prepare('SELECT * FROM access_accounts WHERE owner_uid=?').get('owner');
  const result=await billingStatusResponse({DB:d.DB},'owner',NOW);
  assert.equal(result.status,200);
  const body=await result.json();
  assert.deepEqual(body.notice,{code:'trial_ending',severity:'warning',daysRemaining:1});
  assert.equal(body.checkoutAvailable,false);
  assert.equal(body.access.active,true);
  assert.equal(body.subscription,null);
  assert.deepEqual(d.sql.prepare('SELECT * FROM access_accounts WHERE owner_uid=?').get('owner'),initialAccount);
  assert.equal(d.sql.prepare('SELECT count(*) n FROM access_subscriptions').get().n,0);
  assert.equal(d.sql.prepare('SELECT count(*) n FROM access_grants').get().n,0);
 }finally{d.close();}
});
