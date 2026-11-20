import type {AccessState} from './access.ts';

/**
 * Read-only lifecycle classification for the future billing UI.
 * Do not use to authorize workspace operations or charge a card.
 * D1 + Firestore access guards remain the sole authority.
 */
type Subscription=Readonly<{
  status:'active'|'past_due'|'canceled'|'expired';
  paid_until:number;
}>;
export type BillingNoticeCode=
  'unregistered'|'suspended'|'lifetime'|'trial'|'trial_ending'|
  'complimentary'|'complimentary_ending'|'subscription'|
  'subscription_renewal_soon'|'canceled_until'|'payment_grace'|'expired';
export type BillingNotice=Readonly<{
  code:BillingNoticeCode;
  severity:'info'|'warning'|'critical';
  daysRemaining:number|null;
}>;
const DAY_MS=24*60*60*1000;
const ENDING_WINDOW_MS=3*DAY_MS;
function make(code:BillingNoticeCode,severity:BillingNotice['severity'],daysRemaining:number|null):BillingNotice{
  return {code,severity,daysRemaining};
}

/**
 * All times are instants (UTC milliseconds). The UI can format a calendar date
 * using the user's locale. This function intentionally schedules NO notifications.
 * Only the primary current entitlement is described, so a paid contract cannot
 * wrongly override an independent active lifetime/complimentary grant.
 */
export function billingNotice(access:AccessState|null,subscription:Subscription|null,now=Date.now()):BillingNotice{
  if(!access)return make('unregistered','info',null);
  if(access.suspended)return make('suspended','critical',null);
  if(access.unlimited)return make('lifetime','info',null);
  const remaining=Date.parse(access.accessUntil)-now;
  if(!Number.isFinite(remaining))return make('expired','critical',0);
  if(!access.active||remaining<=0)return make('expired','warning',0);
  const days=Math.ceil(remaining/DAY_MS);
  if(access.source==='trial')
    return make(remaining<=ENDING_WINDOW_MS?'trial_ending':'trial',
      remaining<=ENDING_WINDOW_MS?'warning':'info',days);
  if(access.source==='complimentary')
    return make(remaining<=ENDING_WINDOW_MS?'complimentary_ending':'complimentary',
      remaining<=ENDING_WINDOW_MS?'warning':'info',days);
  if(access.source==='subscription'){
    if(subscription?.status==='past_due'&&subscription.paid_until<=now)
      return make('payment_grace','warning',days);
    if(subscription?.status==='canceled')
      return make('canceled_until','warning',days);
    return make(remaining<=ENDING_WINDOW_MS?'subscription_renewal_soon':'subscription',
      'info',days);
  }
  // Contradictory state is never interpreted as an entitlement or a collection instruction.
  return make('expired','critical',0);
}
