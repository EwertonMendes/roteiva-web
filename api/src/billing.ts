import {billingCatalog,type BillingPlanCode} from './billing-catalog.ts';
import {activeState} from './access.ts';
import {billingNotice} from './billing-notices.ts';
import {asaasConfigured,checkoutEnabled} from './billing-asaas.ts';
import {openCheckout,openCheckoutUrl} from './billing-checkout.ts';
import {currentUpgrade,upgradeOffer} from './billing-upgrade.ts';
import {ApiError,type Env} from './types.ts';

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
  paid_until:number;next_due_on:string|null;amount_cents:number|null;can_cancel:number;cancel_after:number|null;cancel_attempts:number|null;stopped_at:number|null;
};
type PaymentPosition={id:string;due_on:string|null;created_at:number};
type PaymentView=PaymentPosition&{state:string;amount_cents:number;details:string|null;invoice_path:string|null};
const PAGE_SIZE=5;

function paymentPosition(cursor:string):PaymentPosition{
  try{
    if(cursor.length>240)throw new Error();
    const {id,due_on,created_at}=JSON.parse(cursor) as PaymentPosition;
    if(typeof id!=='string'||id.length<1||id.length>80||
      (due_on!==null&&(typeof due_on!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(due_on)))||
      !Number.isSafeInteger(created_at)||created_at<0)throw new Error();
    return {id,due_on,created_at};
  }catch{throw new ApiError(400,'invalid_billing_cursor');}
}

async function paymentPage(env:Env,uid:string,cursor:string|null){
  const position=cursor===null?null:paymentPosition(cursor);
  const base='SELECT id,state,amount_cents,due_on,details,invoice_path,created_at FROM billing_payment_records WHERE owner_uid=?';
  const order=' ORDER BY due_on DESC,created_at DESC,id DESC LIMIT ?';
  const after=position?.due_on===null?' AND due_on IS NULL AND (created_at,id)<(?,?)':
    ' AND ((due_on,created_at,id)<(?,?,?) OR due_on IS NULL)';
  const {results}=await (position===null?env.DB.prepare(base+order).bind(uid,PAGE_SIZE+1):
    env.DB.prepare(base+after+order).bind(uid,...(position.due_on===null?[]:[position.due_on]),position.created_at,position.id,PAGE_SIZE+1)
  ).all<PaymentView>();
  const last=results[PAGE_SIZE-1];
  return {
    nextPaymentCursor:results.length>PAGE_SIZE?JSON.stringify({id:last.id,due_on:last.due_on,created_at:last.created_at}):null,
    payments:results.slice(0,PAGE_SIZE).map(payment=>({
      state:payment.details==='refused'&&payment.state==='pending'?'refused':payment.state,
      amountCents:payment.amount_cents,dueOn:payment.due_on,
      invoiceUrl:payment.invoice_path&&['pending','overdue'].includes(payment.state)?
        'https://sandbox.asaas.com'+payment.invoice_path:null,
    })),
  };
}

/** Billing status remains readable with an expired trial or paid period. */
export async function billingStatusResponse(env:Env,uid:string,now=Date.now(),cursor:string|null=null):Promise<Response>{
  if(cursor!==null)return Response.json(await paymentPage(env,uid,cursor));
  const [access,subscription,checkout,history]=await Promise.all([
    activeState(env,uid,now),
    env.DB.prepare(
      'SELECT s.id,s.cadence,s.status,s.paid_until,c.next_due_on,c.stopped_at,c.cancel_after,c.cancel_attempts,(c.subscription_id IS NOT NULL AND c.removed_at IS NULL) AS can_cancel '+
      ",COALESCE((SELECT u.amount_cents FROM billing_plan_changes u WHERE u.subscription_id=s.id AND u.state='applied' ORDER BY u.effective_on DESC LIMIT 1),i.amount_cents) AS amount_cents "+
      'FROM access_subscriptions s LEFT JOIN billing_contracts c ON c.subscription_id=s.id LEFT JOIN billing_checkout_intents i ON i.id=c.checkout_intent_id '+
      "WHERE s.owner_uid=? ORDER BY CASE s.status WHEN 'active' THEN 0 WHEN 'past_due' THEN 1 WHEN 'canceled' THEN 2 ELSE 3 END,s.updated_at DESC LIMIT 1"
    ).bind(uid).first<SubscriptionView>(),
    openCheckout(env,uid),
    paymentPage(env,uid,null),
  ]);
  const enabled=checkoutEnabled(env,uid);
  const checkoutUrl=checkout&&enabled?openCheckoutUrl(checkout,now):null;
  const upgrade=subscription?.can_cancel&&subscription.stopped_at===null&&subscription.cancel_after===null
    ?await currentUpgrade(env,uid,subscription.id):null;
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
      nextDueOn:upgrade?.state==='scheduled'?upgrade.effective_on:subscription.next_due_on,
      amountCents:subscription.amount_cents,
      paymentMethod:subscription.amount_cents!==null?'CREDIT_CARD':null,
      canCancel:!!subscription.can_cancel&&subscription.cancel_after===null&&upgrade?.state!=='applying'&&asaasConfigured(env),
      cancellation:subscription.can_cancel&&subscription.cancel_after!==null?
        (subscription.cancel_attempts??0)>=8?'review':'pending':null,
      upgradeOffer:!upgrade&&access?.active&&!access.suspended&&subscription.status==='active'&&
        subscription.can_cancel&&subscription.stopped_at===null&&subscription.cancel_after===null
        ?upgradeOffer(env,uid,subscription.cadence,subscription.paid_until,now):null,
      upgrade:upgrade?{
        planCode:upgrade.plan_code,amountCents:upgrade.amount_cents,effectiveOn:upgrade.effective_on,
        status:upgrade.state==='scheduled'?'scheduled':upgrade.state==='review'?'review':'pending',
      }:null,
    }:null,
    ...history,
  });
}
