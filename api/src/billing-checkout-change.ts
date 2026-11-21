import {checkoutEnabled} from './billing-asaas.ts';
import {openCheckout} from './billing-checkout.ts';
import {readBillingJson} from './billing-webhook.ts';
import {paymentGateway} from './payments/asaas-adapter.ts';
import {ApiError,type Env} from './types.ts';

/**
 * Cancel an UNPAID checkout only. Keeps the old checkout/intent and provider
 * references for late webhook recovery; never deletes payment history.
 * There is deliberately NO automatic "create next checkout" step.
 */
export async function abandonUnpaidCheckout(request:Request,env:Env,uid:string):Promise<Response>{
  if(!checkoutEnabled(env,uid))throw new ApiError(404,'not_found');
  const body=await readBillingJson(request,768) as {intentId?:unknown;confirmed?:unknown}|null;
  if(!body||Object.keys(body).length!==2||body.confirmed!==true||
    typeof body.intentId!=='string'||!/^[0-9a-f-]{36}$/i.test(body.intentId))
    throw new ApiError(400,'billing_consent_required');

  const intent=await openCheckout(env,uid);
  if(!intent||intent.id!==body.intentId||!intent.provider_checkout_ref)
    throw new ApiError(409,'billing_checkout_not_switchable');

  const gateway=paymentGateway(env);
  const ref=intent.provider_checkout_ref;
  const state=await gateway.checkoutState(ref);
  if(state==='PAID'||state==='UNKNOWN')throw new ApiError(409,'billing_checkout_payment_verifying');
  if(state==='ACTIVE'&&await gateway.cancelCheckout(ref)!=='canceled')
    throw new ApiError(409,'billing_checkout_cancel_unconfirmed');

  // Do not let a completed transaction race with a switch. Even a canceled
  // Checkout must not be treated as unpaid if a payment is already visible.
  const payments=await gateway.listCheckoutPayments(ref);
  if(payments.length!==0)throw new ApiError(409,'billing_checkout_payment_verifying');

  const now=Date.now();
  const changed=await env.DB.prepare(
    "UPDATE billing_checkout_intents SET status=?,updated_at=?,recovery_after=NULL "+
    "WHERE id=? AND owner_uid=? AND provider_checkout_ref=? AND status IN ('pending','ready') "+
    "AND NOT EXISTS (SELECT 1 FROM billing_contracts WHERE checkout_intent_id=?) "+
    "AND NOT EXISTS (SELECT 1 FROM billing_payment_records WHERE subscription_id=?)"
  ).bind(state==='EXPIRED'?'expired':'canceled',now,intent.id,uid,ref,intent.id,intent.id).run();
  if(changed.meta.changes!==1)throw new ApiError(409,'billing_checkout_payment_verifying');
  return Response.json({status:'closed'});
}
