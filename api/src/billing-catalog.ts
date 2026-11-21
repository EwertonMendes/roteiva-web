import {ApiError,type Env} from './types.ts';

/** All amounts are immutable server-owned BRL cents. No browser price is accepted. */
export const BILLING_CATALOG_VERSION='2026-11-v1';
export const TEST_BILLING_VERSION='2026-11-private-test-v1';
export const TEST_BILLING_AMOUNT_CENTS=500;
export type BillingPlanCode='monthly'|'quarterly'|'yearly';
export type BillingOfferCode=BillingPlanCode|'test';
export type BillingCadence='MONTHLY'|'QUARTERLY'|'YEARLY';
export type BillingPlan=Readonly<{code:BillingPlanCode;cycle:BillingCadence;amountCents:number;currency:'BRL';version:string}>;
export type BillingOffer=Readonly<Omit<BillingPlan,'code'>&{code:BillingOfferCode}>;

const plans:readonly BillingPlan[]=Object.freeze([
  Object.freeze({code:'monthly',cycle:'MONTHLY',amountCents:3990,currency:'BRL',version:BILLING_CATALOG_VERSION}),
  Object.freeze({code:'quarterly',cycle:'QUARTERLY',amountCents:10990,currency:'BRL',version:BILLING_CATALOG_VERSION}),
  Object.freeze({code:'yearly',cycle:'YEARLY',amountCents:39990,currency:'BRL',version:BILLING_CATALOG_VERSION}),
]);
const privateTestOffer:BillingOffer=Object.freeze({
  code:'test',cycle:'MONTHLY',amountCents:TEST_BILLING_AMOUNT_CENTS,currency:'BRL',version:TEST_BILLING_VERSION
});

/** A strictly single-UID, production-only, opt-in canary. Never authorize by email or a client flag. */
export function canUsePrivateTestOffer(env:Env,uid?:string):boolean{
  const owner=env.BILLING_TEST_PLAN_UID??'';
  return env.ENVIRONMENT==='prod'&&env.BILLING_TEST_PLAN_ENABLED==='true'&&
    /^[A-Za-z0-9_-]{1,128}$/.test(owner)&&uid===owner;
}
export function billingCatalog(env?:Env,uid?:string):readonly BillingOffer[]{
  return env&&canUsePrivateTestOffer(env,uid)?[...plans,privateTestOffer]:plans;
}
export function requireBillingPlan(code:unknown):BillingPlan{
  const plan=plans.find(item=>item.code===code);
  if(!plan)throw new ApiError(400,'billing_invalid_plan');
  return plan;
}
/** Resolves an HTTP plan code to a trusted, persisted MONTHLY/QUARTERLY/YEARLY contract. */
export function resolveCheckoutOffer(env:Env,uid:string,code:unknown):BillingPlan{
  if(code==='test'){
    if(!canUsePrivateTestOffer(env,uid))throw new ApiError(404,'not_found');
    return Object.freeze({...plans[0],amountCents:TEST_BILLING_AMOUNT_CENTS,version:TEST_BILLING_VERSION});
  }
  return requireBillingPlan(code);
}
/** Used by the provider adapter; the checkout version is never supplied by the browser. */
export function trustedCheckoutPrice(code:BillingPlanCode,version?:string):BillingPlan{
  const standard=requireBillingPlan(code);
  if(version===undefined||version===standard.version)return standard;
  if(code==='monthly'&&version===TEST_BILLING_VERSION)
    return Object.freeze({...standard,amountCents:TEST_BILLING_AMOUNT_CENTS,version});
  throw new ApiError(400,'billing_catalog_changed');
}
