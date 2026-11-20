import test from 'node:test';
import assert from 'node:assert/strict';
import {buildRecurringCardCheckout} from '../src/billing-checkout-contract.ts';
import {planBillingEvent} from '../src/billing-events.ts';
const intentId='d7d87e1c-4f28-4d01-91d4-2c488e0cb044';
const dev={ENVIRONMENT:'dev',FRONTEND_ORIGIN:'https://roteiva-web-dev.web.app'};
const prod={ENVIRONMENT:'prod',FRONTEND_ORIGIN:'https://app.roteiva.com'};
const date='2027-01-31 15:02:38';
test('builds each recurring CREDIT_CARD payload from trusted price catalog, not UI input',()=>{
 for(const [code,cycle,value] of [['monthly','MONTHLY',39.90],['quarterly','QUARTERLY',109.90],['yearly','YEARLY',399.90]]){
   const body=buildRecurringCardCheckout(dev,{planCode:code,intentId,nextDueDate:date});
   assert.deepEqual(body.billingTypes,['CREDIT_CARD']);
   assert.deepEqual(body.chargeTypes,['RECURRENT']);
   assert.equal(body.minutesToExpire,30);
   assert.equal(body.items[0].value,value);
   assert.equal(body.subscription.cycle,cycle);
   assert.equal(body.subscription.nextDueDate,date);
   assert.equal(body.externalReference,intentId);
   assert.equal(body.items[0].quantity,1);
   assert.equal(body.callback.successUrl,'https://roteiva-web-dev.web.app/?billing=return');
   assert.equal(Object.hasOwn(body,'customerData'),false);
 }
});
test('production callback cannot be redirected to another origin',()=>{
 const data={planCode:'yearly',intentId,nextDueDate:date};
 assert.deepEqual(buildRecurringCardCheckout(prod,data).callback,{
   cancelUrl:'https://app.roteiva.com/?billing=cancelled',
   expiredUrl:'https://app.roteiva.com/?billing=expired',
   successUrl:'https://app.roteiva.com/?billing=return',
 });
 assert.throws(()=>buildRecurringCardCheckout({...prod,FRONTEND_ORIGIN:'https://evil.example'},data),{code:'billing_invalid_environment'});
 assert.throws(()=>buildRecurringCardCheckout({ENVIRONMENT:'staging',FRONTEND_ORIGIN:'https://evil.example'},data),{code:'billing_invalid_environment'});
});
test('rejects injected intent IDs, invalid prices/plans and invalid calendar dates',()=>{
 const data={planCode:'monthly',intentId,nextDueDate:date};
 assert.throws(()=>buildRecurringCardCheckout(dev,{...data,planCode:'ultra',value:1}),{code:'billing_invalid_plan'});
 for(const nextDueDate of ['2026-02-30 12:00:00','2027-13-01 12:00:00','2027-01-01T10:00:00Z','2027-01-01 25:00:00','2025-12-01 00:00:00'])
   assert.throws(()=>buildRecurringCardCheckout(dev,{...data,nextDueDate}),{code:'billing_invalid_first_due_date'});
 assert.doesNotThrow(()=>buildRecurringCardCheckout(dev,{...data,nextDueDate:'2028-02-29 10:00:00'}));
 assert.throws(()=>buildRecurringCardCheckout(dev,{...data,intentId:'other-uid/injected'}),{code:'billing_invalid_intent'});
});
test('event routing is conservative; checkout or subscription creation can never grant access',()=>{
 for(const name of ['CHECKOUT_PAID','SUBSCRIPTION_CREATED','PAYMENT_CREATED','PAYMENT_AUTHORIZED','PAYMENT_CONFIRMED','PAYMENT_RECEIVED',
  'PAYMENT_OVERDUE','PAYMENT_REFUNDED','PAYMENT_PARTIALLY_REFUNDED','PAYMENT_CHARGEBACK_REQUESTED','PAYMENT_CHARGEBACK_DISPUTE',
  'PAYMENT_AWAITING_CHARGEBACK_REVERSAL','PAYMENT_REFUND_IN_PROGRESS','SOME_NEW_EVENT']){
   const plan=planBillingEvent(name);
   assert.equal(plan.canGrantAccess,false);
   assert.equal(plan.requiresProviderLookup,true);
 }
 assert.deepEqual(planBillingEvent('PAYMENT_CONFIRMED').concern,'paid');
 assert.deepEqual(planBillingEvent('PAYMENT_REFUNDED').concern,'reversal');
 assert.deepEqual(planBillingEvent('PAYMENT_OVERDUE').concern,'overdue');
 assert.deepEqual(planBillingEvent('CHECKOUT_PAID').action,'reconcile_checkout');
 assert.deepEqual(planBillingEvent('PAYMENT_CHARGEBACK_REQUESTED').action,'reconcile_payment');
 assert.deepEqual(planBillingEvent('SOME_NEW_EVENT').action,'manual_review');
});
