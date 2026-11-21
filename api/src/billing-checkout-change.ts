import {asaasConfigured,AsaasError} from './billing-asaas.ts';
import {openCheckout,type CheckoutIntent} from './billing-checkout.ts';
import {readBillingJson} from './billing-webhook.ts';
import {paymentGateway} from './payments/asaas-adapter.ts';
import type {GatewayPayment} from './payments/provider.ts';
import {ApiError,type Env} from './types.ts';

type Closure = 'canceled'|'expired';
type Observation = {state:'closed'|'unchanged'}|{state:'has_payment';payment:GatewayPayment};

export function checkoutRecoveryRouted(env:Env):boolean {
  return asaasConfigured(env);
}

export async function queueCheckoutClosure(env:Env,intentId:string,uid:string,now=Date.now()):Promise<boolean>{
  // The durable inbox also serializes the provider cancellation against
  // payment reconciliation. A second click cannot issue another POST.
  const result=await env.DB.prepare(
    "INSERT OR IGNORE INTO billing_webhook_events(provider,event_id,event_type,resource_type,resource_ref,checkout_intent_ref,status,received_at,updated_at) "+
    "SELECT provider,?,'CHECKOUT_CLOSE','checkout',provider_checkout_ref,id,'pending',?,? FROM billing_checkout_intents "+
    "WHERE id=? AND owner_uid=? AND status IN ('pending','ready') AND provider_checkout_ref IS NOT NULL"
  ).bind('close:'+intentId,now,now,intentId,uid).run();
  return result.meta.changes===1;
}

/** An owner may recover a previously opened checkout regardless of the rollout allowlist. */
export async function abandonUnpaidCheckout(request:Request,env:Env,uid:string):Promise<Response>{
  if(!checkoutRecoveryRouted(env))throw new ApiError(404,'not_found');
  const body=await readBillingJson(request,768) as {intentId?:unknown;confirmed?:unknown}|null;
  if(!body||Object.keys(body).length!==2||body.confirmed!==true||
    typeof body.intentId!=='string'||!/^[0-9a-f-]{36}$/i.test(body.intentId))
    throw new ApiError(400,'billing_consent_required');

  const intent=await openCheckout(env,uid);
  if(!intent||intent.id!==body.intentId||!intent.provider_checkout_ref)
    throw new ApiError(409,'billing_checkout_not_switchable');

  await queueCheckoutClosure(env,intent.id,uid);
  return Response.json({status:'pending'},{status:202});
}

/** Terminal webhook or verified cancel response plus an independent payment lookup. */
export async function observeCheckoutClosure(env:Env,intent:CheckoutIntent,ref:string,evidence?:Closure):Promise<Observation>{
  if(!['pending','ready'].includes(intent.status))return {state:'unchanged'};
  const gateway=paymentGateway(env);
  const [payment]=await gateway.listCheckoutPayments(ref);
  if(payment){
    if(payment.checkoutRef!==ref)throw new ApiError(503,'billing_checkout_payment_review');
    return {state:'has_payment',payment};
  }
  const paidSignal=await env.DB.prepare(
    "SELECT 1 FROM billing_webhook_events WHERE provider=? AND event_type='CHECKOUT_PAID' AND resource_ref=? LIMIT 1"
  ).bind(gateway.code,ref).first();
  if(paidSignal)throw new ApiError(503,'billing_checkout_payment_verifying');
  if(!evidence){
    try {
      if(await gateway.cancelCheckout(ref)==='canceled')evidence='canceled';
    } catch(error){
      // A rejected cancellation may mean the checkout has already been paid,
      // canceled or expired. Only a verified terminal notification can settle it.
      if(!(error instanceof AsaasError&&[400,404,409,422].includes(error.upstreamStatus??0)))throw error;
    }
    if(!evidence)throw new ApiError(503,'billing_checkout_terminal_unconfirmed');
    const [latePayment]=await gateway.listCheckoutPayments(ref);
    if(latePayment){
      if(latePayment.checkoutRef!==ref)throw new ApiError(503,'billing_checkout_payment_review');
      return {state:'has_payment',payment:latePayment};
    }
  }
  const now=Date.now();
  const changed=await env.DB.prepare(
    "UPDATE billing_checkout_intents SET status=?,updated_at=?,recovery_after=NULL "+
    "WHERE id=? AND owner_uid=? AND provider_checkout_ref=? AND status IN ('pending','ready') "+
    "AND NOT EXISTS (SELECT 1 FROM billing_contracts WHERE checkout_intent_id=?) "+
    "AND NOT EXISTS (SELECT 1 FROM billing_payment_records WHERE subscription_id=?) "+
    "AND NOT EXISTS (SELECT 1 FROM billing_webhook_events WHERE provider=? AND event_type='CHECKOUT_PAID' AND resource_ref=?)"
  ).bind(evidence,now,intent.id,intent.owner_uid,ref,intent.id,intent.id,gateway.code,ref).run();
  if(changed.meta.changes===1)return {state:'closed'};
  throw new ApiError(503,'billing_checkout_payment_verifying');
}
