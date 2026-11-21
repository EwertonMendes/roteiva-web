import {billingDateInstant,periodEnd} from './billing-period.ts';
import type {BillingPlanCode} from './billing-catalog.ts';
import type {Env} from './types.ts';

export const MAX_COURTESY_CREDIT_MS=365*24*60*60*1000;
const dateFormat=new Intl.DateTimeFormat('sv-SE',{
  timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'
});
export const localDay=(time:number)=>dateFormat.format(new Date(time));

type AccountRow={trial_ends_at:number;suspended_at:number|null;sync_pending:number};
type GrantRow={last_finite:number|null;lifetime:number};
type PaidRow={paid_until:number|null};
type ContractRow={running:number};

/**
 * Authoritative checkout eligibility. Free trials and finite complimentary
 * access do NOT prevent one first paid purchase. Live paid periods, lifetime
 * grants and recurring contracts prevent overlapping new purchases.
 */
export async function purchaseWindow(env:Env,uid:string,now=Date.now()):Promise<{
  canPurchase:boolean;courtesyUntil:number;paidUntil:number;
}>{
  const [account,grants,paid,contract]=await Promise.all([
    env.DB.prepare('SELECT trial_ends_at,suspended_at,sync_pending FROM access_accounts WHERE owner_uid=?')
      .bind(uid).first<AccountRow>(),
    env.DB.prepare("SELECT MAX(CASE WHEN grant_kind='lifetime' THEN 1 ELSE 0 END) AS lifetime,"+
      "MAX(CASE WHEN grant_kind='complimentary' AND ends_at IS NOT NULL THEN ends_at ELSE 0 END) AS last_finite "+
      "FROM access_grants WHERE owner_uid=? AND revoked_at IS NULL AND starts_at<=? AND (ends_at IS NULL OR ends_at>?)")
      .bind(uid,now,now).first<GrantRow>(),
    env.DB.prepare("SELECT MAX(paid_until) AS paid_until FROM access_subscriptions WHERE owner_uid=? "+
      "AND status IN ('active','past_due','canceled')").bind(uid).first<PaidRow>(),
    env.DB.prepare('SELECT COUNT(*) AS running FROM billing_contracts WHERE owner_uid=? AND removed_at IS NULL')
      .bind(uid).first<ContractRow>(),
  ]);
  const courtesyUntil=Math.max(0,account?.trial_ends_at??0,grants?.last_finite??0);
  const paidUntil=Math.max(0,paid?.paid_until??0);
  return {
    canPurchase:!!account&&account.suspended_at===null&&account.sync_pending===0&&
      !grants?.lifetime&&!contract?.running&&paidUntil<=now,
    courtesyUntil,paidUntil,
  };
}

/**
 * The first card billing cycle is charged today. Its one-time constant credit
 * keeps every recurring payment period shifted by precisely the unused free
 * time. Never add this credit a second time on later renewals.
 */
export function courtesyCreditForCard(now:number,courtesyUntil:number):number{
  if(courtesyUntil<=now)return 0;
  const startOfChargeDay=billingDateInstant(localDay(now));
  const credit=courtesyUntil-startOfChargeDay;
  if(!Number.isSafeInteger(credit)||credit<=0||credit>MAX_COURTESY_CREDIT_MS)
    throw new Error('billing_invalid_courtesy_credit');
  return credit;
}

/**
 * A detached PIX period starts after the LAST FINITE FREE ACCESS, if any.
 * Preserve the customer's original expiry clock, not just the civil date.
 */
export function manualPaidUntil(start:number,plan:BillingPlanCode):number{
  if(!Number.isSafeInteger(start)||start<0)throw new Error('billing_invalid_period_start');
  const midnight=billingDateInstant(localDay(start));
  return periodEnd(localDay(start),plan)+(start-midnight);
}
