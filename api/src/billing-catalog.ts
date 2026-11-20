import {ApiError} from './types.ts';

/** Server-owned commercial catalog. Prices are BRL cents; never trust the browser. */
export const BILLING_CATALOG_VERSION='2026-11-v1';
export type BillingPlanCode='monthly'|'quarterly'|'yearly';
export type BillingCadence='MONTHLY'|'QUARTERLY'|'YEARLY';
export type BillingPlan=Readonly<{code:BillingPlanCode;cycle:BillingCadence;amountCents:number;currency:'BRL';version:string}>;

const plans:readonly BillingPlan[]=Object.freeze([
  Object.freeze({code:'monthly',cycle:'MONTHLY',amountCents:3990,currency:'BRL',version:BILLING_CATALOG_VERSION}),
  Object.freeze({code:'quarterly',cycle:'QUARTERLY',amountCents:10990,currency:'BRL',version:BILLING_CATALOG_VERSION}),
  Object.freeze({code:'yearly',cycle:'YEARLY',amountCents:39990,currency:'BRL',version:BILLING_CATALOG_VERSION}),
]);

export function billingCatalog():readonly BillingPlan[]{return plans;}
export function requireBillingPlan(code:unknown):BillingPlan{
  const plan=plans.find(item=>item.code===code);
  if(!plan)throw new ApiError(400,'billing_invalid_plan');
  return plan;
}
