/** Webhook names are routing hints only: never authorize access from this file. */
export type BillingEventAction=
  'reconcile_payment'|'reconcile_contract'|'reconcile_checkout'|'manual_review';
export type BillingPaymentConcern='paid'|'overdue'|'reversal'|'pending'|'unknown';
export type BillingEventPlan=Readonly<{
  action:BillingEventAction;
  concern:BillingPaymentConcern;
  canGrantAccess:false;
  requiresProviderLookup:true;
}>;
const paid=new Set(['PAYMENT_CONFIRMED','PAYMENT_RECEIVED']);
const reversed=new Set(['PAYMENT_REFUNDED','PAYMENT_RECEIVED_IN_CASH_UNDONE']);
const risky=new Set(['PAYMENT_CHARGEBACK_REQUESTED',
  'PAYMENT_CHARGEBACK_DISPUTE','PAYMENT_AWAITING_CHARGEBACK_REVERSAL',
  'PAYMENT_REFUND_IN_PROGRESS']);
const pending=new Set(['PAYMENT_CREATED','PAYMENT_AUTHORIZED','PAYMENT_UPDATED',
  'PAYMENT_AWAITING_RISK_ANALYSIS','PAYMENT_APPROVED_BY_RISK_ANALYSIS',
  'PAYMENT_REPROVED_BY_RISK_ANALYSIS','PAYMENT_CREDIT_CARD_CAPTURE_REFUSED']);
const late=new Set(['PAYMENT_OVERDUE','PAYMENT_DELETED']);
const checkout=new Set(['CHECKOUT_CREATED','CHECKOUT_PAID','CHECKOUT_CANCELED','CHECKOUT_EXPIRED']);
const contract=new Set(['SUBSCRIPTION_CREATED','SUBSCRIPTION_UPDATED',
  'SUBSCRIPTION_INACTIVATED','SUBSCRIPTION_DELETED']);
export function planBillingEvent(eventType:string):BillingEventPlan{
  const action:BillingEventAction=checkout.has(eventType)?'reconcile_checkout':
    contract.has(eventType)?'reconcile_contract':
    paid.has(eventType)||reversed.has(eventType)||late.has(eventType)||pending.has(eventType)?
      'reconcile_payment':'manual_review';
  const concern:BillingPaymentConcern=paid.has(eventType)?'paid':
    reversed.has(eventType)?'reversal':
    late.has(eventType)?'overdue':
    pending.has(eventType)?'pending':'unknown';
  return {action:risky.has(eventType)?'reconcile_payment':action,
    concern:risky.has(eventType)?'reversal':concern,canGrantAccess:false,requiresProviderLookup:true};
}
