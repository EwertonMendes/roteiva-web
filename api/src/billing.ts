import {billingCatalog} from './billing-catalog.ts';
import {activeState} from './access.ts';
import {billingNotice} from './billing-notices.ts';
import type {Env} from './types.ts';

/** Catalog is informational until checkout and reconciliation are homologated. */
export function billingPlansResponse():Response{
  return Response.json({
    checkoutAvailable:false,
    currency:'BRL',
    plans:billingCatalog(),
  });
}
type SubscriptionView={
  cadence:'monthly'|'quarterly'|'yearly';
  status:'active'|'past_due'|'canceled'|'expired';
  paid_until:number;
};
/** Billing status is available to authenticated users, even with expired access. */
export async function billingStatusResponse(env:Env,uid:string,now=Date.now()):Promise<Response>{
  const [access,subscription]=await Promise.all([
    activeState(env,uid,now),
    env.DB.prepare("SELECT cadence,status,paid_until FROM access_subscriptions WHERE owner_uid=? ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'past_due' THEN 1 WHEN 'canceled' THEN 2 ELSE 3 END,updated_at DESC LIMIT 1")
      .bind(uid).first<SubscriptionView>()
  ]);
  return Response.json({
    checkoutAvailable:false,
    access,
    notice:billingNotice(access,subscription,now),
    subscription:subscription?{
      planCode:subscription.cadence,
      status:subscription.status,
      paidUntil:new Date(subscription.paid_until).toISOString(),
    }:null
  });
}
