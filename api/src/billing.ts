import {billingCatalog,type BillingPlanCode} from './billing-catalog.ts';
import {activeState} from './access.ts';
import {billingNotice} from './billing-notices.ts';
import {asaasConfigured,checkoutEnabled} from './billing-asaas.ts';
import {openCheckout,openCheckoutUrl} from './billing-checkout.ts';
import type {Env} from './types.ts';

export function billingPlansResponse(env?:Env):Response{
  return Response.json({
    checkoutAvailable:env?checkoutEnabled(env):false,
    currency:'BRL',
    plans:billingCatalog(),
  });
}

type SubscriptionView={
  id:string;cadence:BillingPlanCode;
  status:'active'|'past_due'|'canceled'|'expired';
  paid_until:number;next_due_on:string|null;amount_cents:number|null;can_cancel:number;cancel_after:number|null;cancel_attempts:number|null;
};
type PaymentView={state:string;amount_cents:number;due_on:string|null;details:string|null;invoice_path:string|null};

/** Billing status remains readable with an expired trial or paid period. */
export async function billingStatusResponse(env:Env,uid:string,now=Date.now()):Promise<Response>{
  const [access,subscription,checkout,payments]=await Promise.all([
    activeState(env,uid,now),
    env.DB.prepare(
      'SELECT s.id,s.cadence,s.status,s.paid_until,c.next_due_on,i.amount_cents,c.cancel_after,c.cancel_attempts,(c.subscription_id IS NOT NULL AND c.removed_at IS NULL) AS can_cancel '+
      'FROM access_subscriptions s LEFT JOIN billing_contracts c ON c.subscription_id=s.id LEFT JOIN billing_checkout_intents i ON i.id=c.checkout_intent_id '+
      "WHERE s.owner_uid=? ORDER BY CASE s.status WHEN 'active' THEN 0 WHEN 'past_due' THEN 1 WHEN 'canceled' THEN 2 ELSE 3 END,s.updated_at DESC LIMIT 1"
    ).bind(uid).first<SubscriptionView>(),
    openCheckout(env,uid),
    env.DB.prepare('SELECT state,amount_cents,due_on,details,invoice_path FROM billing_payment_records WHERE owner_uid=? ORDER BY due_on DESC,created_at DESC LIMIT 20')
      .bind(uid).all<PaymentView>()
  ]);
  const enabled=checkoutEnabled(env,uid);
  const checkoutUrl=checkout&&enabled?openCheckoutUrl(checkout,now):null;
  return Response.json({
    checkoutAvailable:enabled,
    canStart:checkoutEnabled(env,uid)&&!!access&&!access.active&&!access.suspended&&!checkout&&!subscription?.can_cancel,
    access,
    notice:billingNotice(access,subscription,now),
    checkout:checkout?{
      planCode:checkout.plan_code,
      status:checkoutUrl?'ready':'pending',
      url:checkoutUrl,
    }:null,
    subscription:subscription?{
      planCode:subscription.cadence,
      status:subscription.status,
      paidUntil:subscription.paid_until>0?new Date(subscription.paid_until).toISOString():null,
      nextDueOn:subscription.next_due_on,
      amountCents:subscription.amount_cents,
      paymentMethod:subscription.amount_cents!==null?'CREDIT_CARD':null,
      canCancel:!!subscription.can_cancel&&subscription.cancel_after===null&&asaasConfigured(env),
      cancellation:subscription.can_cancel&&subscription.cancel_after!==null?
        (subscription.cancel_attempts??0)>=8?'review':'pending':null,
    }:null,
    payments:payments.results.map(payment=>({
      state:payment.details==='refused'&&payment.state==='pending'?'refused':payment.state,
      amountCents:payment.amount_cents,dueOn:payment.due_on,
      invoiceUrl:payment.invoice_path&&['pending','overdue'].includes(payment.state)?
        'https://sandbox.asaas.com'+payment.invoice_path:null,
    })),
  });
}
