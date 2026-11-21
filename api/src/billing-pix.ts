import {providerRef} from './billing-asaas.ts';
import {type CheckoutIntent} from './billing-checkout.ts';
import {billingDateInstant,cents,civilDate,periodEnd} from './billing-period.ts';
import {queueBillingProjection} from './billing-projection.ts';
import {refundedSoFar} from './billing-refunds.ts';
import {ApiError,type Env} from './types.ts';

/** Manual purchases are not recurring contracts. Every verified payment
 * owns one immutable period and a separate access-subscriptions row.
 * Old card subscriptions and their reconciliation path are untouched. */
type Existing={owner_uid:string;subscription_id:string;state:string;amount_cents:number;refunded_amount_cents:number;period_ends_at:number|null};
const dateFormat=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'});
const dayAt=(now:number)=>dateFormat.format(new Date(now));

export async function reconcilePixPayment(env:Env,payment:Record<string,unknown>,ref:string,
  eventType?:string):Promise<'processed'|'ignored'|'review'> {
  if(payment.id!==ref)throw new ApiError(502,'billing_provider_invalid_response');
  const checkout=providerRef(payment.checkoutSession),customer=providerRef(payment.customer);
  if(payment.billingType!=='PIX'||!checkout||!customer||providerRef(payment.subscription))
    return 'ignored';
  const intent=await env.DB.prepare(
    "SELECT * FROM billing_checkout_intents WHERE provider='asaas' AND provider_checkout_ref=? AND payment_method='PIX'"
  ).bind(checkout).first<CheckoutIntent>();
  if(!intent)return 'ignored';
  const deletion=await env.DB.prepare('SELECT 1 FROM account_deletions WHERE owner_uid=?')
    .bind(intent.owner_uid).first();
  if(deletion)return 'review';

  if(payment.currency!==undefined&&payment.currency!=='BRL')return 'review';
  if(cents(payment.value)!==intent.amount_cents&&
    cents(payment.originalValue)!==intent.amount_cents)return 'review';
  const existing=await env.DB.prepare(
    "SELECT owner_uid,subscription_id,state,amount_cents,refunded_amount_cents,period_ends_at FROM billing_payment_records WHERE provider='asaas' AND provider_payment_ref=?"
  ).bind(ref).first<Existing>();
  if(existing&&(existing.owner_uid!==intent.owner_uid||existing.subscription_id!==intent.id||
    existing.amount_cents!==intent.amount_cents))return 'review';

  const owner=await env.DB.prepare(
    "SELECT owner_uid,provider_customer_ref FROM billing_customers WHERE provider_customer_ref=? OR owner_uid=?"
  ).bind(customer,intent.owner_uid).all<{owner_uid:string;provider_customer_ref:string}>();
  if(owner.results.some(x=>x.owner_uid!==intent.owner_uid||x.provider_customer_ref!==customer))return 'review';
  const now=Date.now();
  const refund=await refundedSoFar(env,payment,ref,intent.amount_cents,existing?.refunded_amount_cents??0,eventType);
  // A Pix from a PF account may remain CONFIRMED during a precautionary hold.
  // RELEASE access only after the provider reports RECEIVED.
  if(payment.status==='CONFIRMED'||payment.status==='PENDING')return 'processed';
  if(refund>0||payment.status==='REFUNDED'){
    if(!existing)return 'processed'; // No period was ever granted.
    if(refund<existing.refunded_amount_cents)return 'review';
    if(existing.state==='refunded'&&refund===existing.refunded_amount_cents)return 'processed';
    const state=refund===intent.amount_cents?'refunded':'review';
    await env.DB.batch([
      env.DB.prepare("UPDATE billing_payment_records SET state=?,details=?,refunded_amount_cents=?,updated_at=? WHERE provider='asaas' AND provider_payment_ref=? AND owner_uid=?")
        .bind(state,refund===intent.amount_cents?null:'partial_refund',refund,now,ref,intent.owner_uid),
      env.DB.prepare("UPDATE access_subscriptions SET status='expired',paid_until=0,updated_at=? WHERE id=? AND owner_uid=?")
        .bind(now,intent.id,intent.owner_uid),
      ...queueBillingProjection(env,intent.owner_uid,now)
    ]);
    return state==='refunded'?'processed':'review';
  }
  if(payment.status!=='RECEIVED')return 'review';
  if(existing)return existing.state==='received'?'processed':'review';
  if(!['pending','ready'].includes(intent.status))return 'review';
  const paidOn=civilDate(payment.paymentDate??payment.confirmedDate);
  if(!paidOn)return 'review';
  const activeContract=await env.DB.prepare(
    'SELECT 1 FROM billing_contracts WHERE owner_uid=? AND removed_at IS NULL LIMIT 1'
  ).bind(intent.owner_uid).first();
  if(activeContract)return 'review';
  const last=await env.DB.prepare(
    "SELECT MAX(paid_until) AS until FROM access_subscriptions WHERE owner_uid=? AND status IN ('active','past_due','canceled')"
  ).bind(intent.owner_uid).first<{until:number|null}>();
  const anchor=Math.max(now,last?.until??0);
  const end=periodEnd(dayAt(anchor),intent.plan_code);
  if(end<=anchor)return 'review';
  const dueOn=civilDate(payment.originalDueDate??payment.dueDate)??dayAt(now);
  const changed=await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO billing_customers(owner_uid,provider,provider_customer_ref,created_at,updated_at) VALUES(?,'asaas',?,?,?)")
      .bind(intent.owner_uid,customer,now,now),
    env.DB.prepare("INSERT INTO access_subscriptions(id,owner_uid,provider,provider_reference,cadence,status,paid_until,updated_at) "+
      "SELECT ?,owner_uid,'asaas',?,?,'active',?,? FROM billing_checkout_intents WHERE id=? AND owner_uid=? AND status IN ('pending','ready')")
      .bind(intent.id,ref,intent.plan_code,end,now,intent.id,intent.owner_uid),
    env.DB.prepare("INSERT INTO billing_payment_records(id,owner_uid,subscription_id,provider,provider_payment_ref,state,amount_cents,currency,due_on,verified_at,paid_at,period_ends_at,applied_at,created_at,updated_at,refunded_amount_cents,payment_method) "+
      "VALUES(?,?,?,'asaas',?,'received',?,'BRL',?,?,?,?,?,?,?,0,'PIX')")
      .bind(crypto.randomUUID(),intent.owner_uid,intent.id,ref,intent.amount_cents,dueOn,now,
        billingDateInstant(paidOn),end,now,now,now),
    env.DB.prepare("UPDATE billing_checkout_intents SET status='completed',updated_at=?,recovery_after=NULL WHERE id=? AND owner_uid=? AND status IN ('pending','ready')")
      .bind(now,intent.id,intent.owner_uid),
    ...queueBillingProjection(env,intent.owner_uid,now)
  ]);
  if(!changed.every(x=>x.success))throw new ApiError(503,'billing_pix_settlement_unavailable');
  return 'processed';
}
