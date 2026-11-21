import {activeState} from './access.ts';
import {AsaasError,checkoutEnabled,pixEnabled,providerRef} from './billing-asaas.ts';
import {requireBillingPlan,type BillingPlanCode} from './billing-catalog.ts';
import {buildRecurringCardCheckout,buildDetachedPixCheckout} from './billing-checkout-contract.ts';
import {paymentGateway} from './payments/asaas-adapter.ts';
import type {PaymentMethod} from './payments/provider.ts';
import {readBillingJson} from './billing-webhook.ts';
import {ApiError,type Env} from './types.ts';

const CHECKOUT_LIFETIME=30*60*1000;
const sandboxOrigin='https://sandbox.asaas.com';
const localClock=new Intl.DateTimeFormat('sv-SE',{
  timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit',
  hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23',
});

export type CheckoutIntent={
  id:string;owner_uid:string;plan_code:BillingPlanCode;pricing_version:string;amount_cents:number;
  status:'pending'|'ready'|'completed'|'expired'|'canceled'|'failed';payment_method:PaymentMethod;
  provider_checkout_ref:string|null;checkout_path:string|null;expires_at:number;first_due_on:string|null;
};

export function openCheckout(env:Env,uid:string):Promise<CheckoutIntent|null>{
  return env.DB.prepare("SELECT * FROM billing_checkout_intents WHERE owner_uid=? AND status IN ('pending','ready')")
    .bind(uid).first<CheckoutIntent>();
}

export function checkoutLink(id:string,link?:unknown):string{
  if(!providerRef(id))throw new ApiError(502,'billing_provider_invalid_response');
  if(link===undefined||link===null)return sandboxOrigin+'/000/checkoutSession/show/'+id;
  if(typeof link==='string'){
    const url=URL.parse(link);
    if(url?.origin===sandboxOrigin&&!url.username&&!url.password&&!url.hash&&
      ((['/checkoutSession/show/'+id,'/000/checkoutSession/show/'+id].includes(url.pathname)&&!url.search)||
       (url.pathname==='/checkoutSession/show'&&url.search==='?id='+id))){
      return url.href;
    }
  }
  throw new ApiError(502,'billing_provider_invalid_response');
}

export function openCheckoutUrl(row:CheckoutIntent,now:number):string|null{
  if(row.expires_at<=now||!row.provider_checkout_ref)return null;
  return checkoutLink(row.provider_checkout_ref,row.checkout_path?sandboxOrigin+row.checkout_path:undefined);
}

function resume(row:CheckoutIntent,planCode:BillingPlanCode,method:PaymentMethod,now:number):Response{
  if((row.payment_method??'CREDIT_CARD')!==method)throw new ApiError(409,'billing_checkout_already_open');
  if(row.plan_code!==planCode)throw new ApiError(409,'billing_checkout_already_open');
  // A provider ID can be saved before the ready response. Reuse the exact
  // existing checkout even when saving the presentation URL was interrupted.
  const url=openCheckoutUrl(row,now);
  return url?Response.json({status:'ready',url}):Response.json({status:'pending'},{status:202});
}

export async function createCheckout(request:Request,env:Env,uid:string,now=Date.now()):Promise<Response>{
  const data=await readBillingJson(request,1024) as {planCode?:unknown;catalogVersion?:unknown;acceptedImmediateCharge?:unknown;paymentMethod?:unknown}|null;
  const method=data?.paymentMethod??'CREDIT_CARD';
  if((method!=='PIX'&&method!=='CREDIT_CARD')||!data||
    typeof data!=='object'||Object.keys(data).length!==(data.paymentMethod===undefined?3:4)||
    data.acceptedImmediateCharge!==true)
    throw new ApiError(400,'billing_consent_required');
  if(method==='PIX'?!pixEnabled(env,uid):!checkoutEnabled(env,uid))
    throw new ApiError(404,'not_found');
  const plan=requireBillingPlan(data.planCode);
  if(data.catalogVersion!==plan.version)throw new ApiError(409,'billing_catalog_changed');
  const access=await activeState(env,uid,now);
  if(!access||access.suspended)throw new ApiError(409,'billing_account_ineligible');

  const open=await openCheckout(env,uid);
  if(open)return resume(open,plan.code,method,now);
  // Protect remaining trial, courtesy or paid time until scheduling is homologated.
  // PIX is a manual period purchase; an active paid period may be extended,
  // but trial, complimentary and live card recurrences cannot be overridden.
  if(access.active&&(method==='CREDIT_CARD'||access.source!=='subscription'))
    throw new ApiError(409,'billing_access_still_active');
  const firstDueDate=localClock.format(now);
  const id=crypto.randomUUID();
  const payload=method==='PIX'
    ?buildDetachedPixCheckout(env,{planCode:plan.code,intentId:id,nextDueDate:firstDueDate})
    :buildRecurringCardCheckout(env,{planCode:plan.code,intentId:id,nextDueDate:firstDueDate});
  const customer=await env.DB.prepare("SELECT provider_customer_ref FROM billing_customers WHERE owner_uid=? AND provider='asaas'")
    .bind(uid).first<{provider_customer_ref:string}>();
  const result=await env.DB.prepare(
    "INSERT OR IGNORE INTO billing_checkout_intents(id,owner_uid,provider,plan_code,pricing_version,amount_cents,status,created_at,expires_at,updated_at,first_due_on,payment_method) "+
    "SELECT ?,owner_uid,'asaas',?,?,?,'pending',?,?,?,?,? FROM access_accounts WHERE owner_uid=? AND suspended_at IS NULL AND sync_pending=0 AND trial_ends_at<=? "+
    "AND NOT EXISTS(SELECT 1 FROM account_deletions WHERE owner_uid=?) "+
    "AND NOT EXISTS(SELECT 1 FROM access_grants WHERE owner_uid=? AND revoked_at IS NULL AND starts_at<=? AND (ends_at IS NULL OR ends_at>?)) "+
    "AND (?='PIX' OR NOT EXISTS(SELECT 1 FROM access_subscriptions WHERE owner_uid=? AND (status IN ('active','past_due') OR (status='canceled' AND paid_until>?)))) "+
    "AND NOT EXISTS(SELECT 1 FROM billing_contracts WHERE owner_uid=? AND removed_at IS NULL)"
  ).bind(id,plan.code,plan.version,plan.amountCents,now,now+CHECKOUT_LIFETIME,now,firstDueDate.slice(0,10),method,
    uid,now,uid,uid,now,now,method,uid,now,uid).run();
  if(result.meta.changes!==1){
    const existing=await openCheckout(env,uid);
    if(existing)return resume(existing,plan.code,method,now);
    throw new ApiError(409,'billing_account_ineligible');
  }
  let created:Record<string,unknown>;
  try{
    created=await paymentGateway(env).createCheckout({
      ...payload,...(customer?{customer:customer.provider_customer_ref}:{})
    });
  }catch(error){
    if(error instanceof AsaasError&&error.upstreamStatus===400){
      await env.DB.prepare("UPDATE billing_checkout_intents SET status='failed',updated_at=? WHERE id=? AND provider_checkout_ref IS NULL AND status='pending'")
        .bind(Date.now(),id).run();
      throw error;
    }
    // The POST may have succeeded. The webhook can bind it later. Never repost.
    return Response.json({status:'pending'},{status:202});
  }
  const ref=providerRef(created.id);
  if(!ref)return Response.json({status:'pending'},{status:202});
  await env.DB.prepare("UPDATE billing_checkout_intents SET provider_checkout_ref=?,updated_at=?,recovery_after=? WHERE id=? AND status IN ('pending','ready') AND (provider_checkout_ref IS NULL OR provider_checkout_ref=?)")
    .bind(ref,Date.now(),Date.now()+120000,id,ref).run();
  const url=checkoutLink(ref,created.link);
  const resultReady=await env.DB.prepare(
    "UPDATE billing_checkout_intents SET status='ready',checkout_path=?,updated_at=? WHERE id=? AND provider_checkout_ref=? AND status IN ('pending','ready') AND expires_at>? "+
    "AND NOT EXISTS(SELECT 1 FROM account_deletions WHERE owner_uid=?)"
  ).bind(url.slice(sandboxOrigin.length),Date.now(),id,ref,Date.now(),uid).run();
  if(resultReady.meta.changes!==1)return Response.json({status:'pending'},{status:202});
  return Response.json({status:'ready',url},{status:201});
}
