import {asaasConfigured,AsaasError,asaasRequest,providerRef} from './billing-asaas.ts';
import {openCheckout,type CheckoutIntent} from './billing-checkout.ts';
import {observeCheckoutClosure,queueCheckoutClosure} from './billing-checkout-change.ts';
import {planBillingEvent} from './billing-events.ts';
import {billingDateInstant,cents,civilDate,periodEnd} from './billing-period.ts';
import {flushBillingProjection,queueBillingProjection} from './billing-projection.ts';
import {requireBillingPlan} from './billing-catalog.ts';
import {termsAtRenewal} from './billing-upgrade.ts';
import {refundedSoFar} from './billing-refunds.ts';
import {reconcilePixPayment} from './billing-pix.ts';
import {paymentGateway} from './payments/asaas-adapter.ts';
import {ApiError,type Env} from './types.ts';

type InboxEvent={
  event_id:string;event_type:string;resource_ref:string|null;checkout_intent_ref:string|null;attempts:number;
};
type Contract=CheckoutIntent&{
  subscription_id:string;stopped_at:number|null;removed_at:number|null;provider_reference:string;provider_customer_ref:string;
};
type PaymentState='pending'|'confirmed'|'received'|'overdue'|'refunded'|'chargeback'|'review';
type VerifiedPayment={
  owner_uid:string;subscription_id:string;state:PaymentState;due_on:string|null;amount_cents:number;
  refunded_amount_cents:number;details:string|null;paid_at:number|null;
};

function paymentState(payment:Record<string,unknown>,previous?:VerifiedPayment|null):PaymentState{
  if(payment.deleted===true)return 'review';
  switch(payment.status){
    case 'CONFIRMED':return 'confirmed';
    case 'RECEIVED':return 'received';
    case 'OVERDUE':return 'overdue';
    case 'REFUND_REQUESTED':case 'REFUND_IN_PROGRESS':
      return previous?.state==='confirmed'||previous?.state==='received'?previous.state:'review';
    case 'CHARGEBACK_REQUESTED':case 'CHARGEBACK_DISPUTE':case 'AWAITING_CHARGEBACK_REVERSAL':return 'chargeback';
    case 'PENDING':case 'AWAITING_RISK_ANALYSIS':case 'AUTHORIZED':return 'pending';
    default:return 'review';
  }
}

function loadContract(env:Env,ref:string):Promise<Contract|null>{
  return env.DB.prepare(
    'SELECT i.*,c.subscription_id,c.stopped_at,c.removed_at,s.provider_reference,b.provider_customer_ref '+
    'FROM access_subscriptions s JOIN billing_contracts c ON c.subscription_id=s.id '+
    'JOIN billing_checkout_intents i ON i.id=c.checkout_intent_id JOIN billing_customers b ON b.owner_uid=c.owner_uid '+
    "WHERE s.provider='asaas' AND s.provider_reference=?"
  ).bind(ref).first<Contract>();
}

function intentByCheckout(env:Env,checkout:string):Promise<CheckoutIntent|null>{
  return env.DB.prepare("SELECT * FROM billing_checkout_intents WHERE provider='asaas' AND provider_checkout_ref=?")
    .bind(checkout).first<CheckoutIntent>();
}

async function accountDeleting(env:Env,uid:string):Promise<boolean>{
  return !!await env.DB.prepare('SELECT 1 FROM account_deletions WHERE owner_uid=?').bind(uid).first();
}

export async function refreshPaidWindow(env:Env,uid:string,subId:string,now:number,
  statements:D1PreparedStatement[]):Promise<void>{
  // Original due date anchors every payment independently. Revoking an old
  // payment cannot subtract time from a later verified renewal.
  await env.DB.batch([
    ...statements,
    env.DB.prepare(
      "UPDATE access_subscriptions SET paid_until=COALESCE((SELECT MAX(period_ends_at) FROM billing_payment_records WHERE subscription_id=? AND state IN ('confirmed','received')),0), "+
      "status=CASE WHEN (SELECT stopped_at FROM billing_contracts WHERE subscription_id=?) IS NOT NULL THEN 'canceled' "+
      "WHEN (SELECT state FROM billing_payment_records WHERE subscription_id=? ORDER BY due_on DESC,verified_at DESC LIMIT 1)='overdue' "+
      "AND EXISTS(SELECT 1 FROM billing_payment_records WHERE subscription_id=? AND state IN ('confirmed','received') AND period_ends_at>0) THEN 'past_due' ELSE 'active' END,updated_at=? "+
      'WHERE id=? AND owner_uid=?'
    ).bind(subId,subId,subId,subId,now,subId,uid),
    ...queueBillingProjection(env,uid,now),
  ]);
}

export function closeUnpaidInvoices(env:Env,uid:string,subId:string,now:number):D1PreparedStatement{
  return env.DB.prepare("UPDATE billing_payment_records SET state='review',details='canceled_invoice',invoice_path=NULL,updated_at=? "+
    "WHERE owner_uid=? AND subscription_id=? AND state IN ('pending','overdue')")
    .bind(now,uid,subId);
}

async function reconcilePayment(env:Env,payment:Record<string,unknown>,ref:string,eventType?:string):Promise<'processed'|'ignored'|'review'>{
  if(payment.id!==ref)throw new ApiError(502,'billing_provider_invalid_response');
  const subscription=providerRef(payment.subscription);
  const customer=providerRef(payment.customer);
  if(!subscription||!customer||payment.billingType!=='CREDIT_CARD')return 'ignored';
  const checkout=providerRef(payment.checkoutSession);
  const dueOn=civilDate(payment.originalDueDate??payment.dueDate);
  if(!dueOn)return 'review';

  const prior=await loadContract(env,subscription);
  const intent=prior??(checkout?await intentByCheckout(env,checkout):null);
  if(!intent){
    if(checkout)throw new ApiError(503,'billing_checkout_unlinked');
    return 'ignored';
  }
  if(await accountDeleting(env,intent.owner_uid))return 'ignored';
  if((intent.first_due_on&&dueOn<intent.first_due_on) ||
    (payment.currency!==undefined&&payment.currency!=='BRL'))return 'review';
  if(prior&&(
    customer!==prior.provider_customer_ref||
    (checkout&&checkout!==prior.provider_checkout_ref)
  ))return 'review';

  const now=Date.now();
  const statements:D1PreparedStatement[]=[];
  const subId=prior?.subscription_id??intent.id;
  const previous=await env.DB.prepare(
    'SELECT owner_uid,subscription_id,state,due_on,amount_cents,refunded_amount_cents,details,paid_at FROM billing_payment_records WHERE provider=? AND provider_payment_ref=?'
  ).bind('asaas',ref).first<VerifiedPayment>();
  if(previous&&(previous.owner_uid!==intent.owner_uid||previous.subscription_id!==subId||
    (previous.due_on&&previous.due_on!==dueOn)))return 'review';

  const change=prior?await termsAtRenewal(env,prior.subscription_id,dueOn,
    prior.removed_at!==null?cents(payment.value):undefined):null;
  const amount=change?.amount_cents??intent.amount_cents;
  const refund=await refundedSoFar(env,payment,ref,amount,previous?.refunded_amount_cents??0,eventType);
  if(!refund&&payment.deleted===true&&(previous?.state==='confirmed'||previous?.state==='received'))return 'review';
  // After a reversal the provider can report a different value. Use the original
  // verified ledger amount (or the provider's original value for a late event).
  if(cents(payment.value)!==amount&&
    !(refund>0&&(previous?.amount_cents===amount||cents(payment.originalValue)===amount)))return 'review';
  if(!prior){
    const closed=['canceled','expired'].includes(intent.status);
    if(!['pending','ready'].includes(intent.status)&&(!closed||
      !['CONFIRMED','RECEIVED'].includes(String(payment.status))))return 'review';
    if(closed){
      const anotherCheckout=await openCheckout(env,intent.owner_uid);
      const otherContract=await env.DB.prepare("SELECT 1 FROM billing_contracts WHERE owner_uid=? AND removed_at IS NULL")
        .bind(intent.owner_uid).first();
      if(anotherCheckout||otherContract)return 'review';
      // Contract creation requires an open intent. Reopen only in the same
      // transaction as the verified payment; the unique index fences new checkout.
      statements.push(env.DB.prepare("UPDATE billing_checkout_intents SET status='pending' WHERE id=? AND status IN ('canceled','expired')")
        .bind(intent.id));
    }
    const contract=await asaasRequest(env,'GET',`/subscriptions/${subscription}`);
    if(contract.id!==subscription||contract.customer!==customer||
      contract.billingType!=='CREDIT_CARD'||cents(contract.value)!==amount||
      contract.cycle!==requireBillingPlan(intent.plan_code).cycle)return 'review';
    if(await accountDeleting(env,intent.owner_uid))return 'ignored';
    const present=await env.DB.prepare(
      'SELECT owner_uid,provider_customer_ref FROM billing_customers WHERE owner_uid=? OR provider_customer_ref=?'
    ).bind(intent.owner_uid,customer).all<{owner_uid:string;provider_customer_ref:string}>();
    if(present.results.some(row=>row.owner_uid!==intent.owner_uid||row.provider_customer_ref!==customer))return 'review';
    const stopped=contract.deleted===true||contract.status==='INACTIVE';
    if(!stopped&&contract.status!=='ACTIVE')return 'review';
    statements.push(
      env.DB.prepare("INSERT OR IGNORE INTO billing_customers(owner_uid,provider,provider_customer_ref,created_at,updated_at) VALUES(?,'asaas',?,?,?)")
        .bind(intent.owner_uid,customer,now,now),
      env.DB.prepare("INSERT INTO access_subscriptions(id,owner_uid,provider,provider_reference,cadence,status,paid_until,updated_at) VALUES(?,?,'asaas',?,?,'active',0,?)")
        .bind(subId,intent.owner_uid,subscription,intent.plan_code,now),
      env.DB.prepare('INSERT INTO billing_contracts(checkout_intent_id,owner_uid,subscription_id,next_due_on,stopped_at) VALUES(?,?,?,?,?)')
        .bind(intent.id,intent.owner_uid,subId,civilDate(contract.nextDueDate),stopped?now:null),
      env.DB.prepare("UPDATE billing_checkout_intents SET status='completed',updated_at=? WHERE id=?").bind(now,intent.id),
    );
  }

  const reported=paymentState(payment,previous);
  const canceledInvoice=prior?.removed_at!=null&&(payment.deleted===true||reported==='pending'||reported==='overdue');
  const state=refund>0?(refund===amount?'refunded':'review'):canceledInvoice?'review':reported;
  const details=refund>0&&refund<amount?'partial_refund':canceledInvoice?'canceled_invoice':
    state==='pending'&&['PAYMENT_CREDIT_CARD_CAPTURE_REFUSED','PAYMENT_REPROVED_BY_RISK_ANALYSIS'].includes(eventType??'')?'refused':null;
  const invoicePath=paymentGateway(env).invoicePath(payment.invoiceUrl);
  const paid=state==='confirmed'||state==='received';
  const paidOn=civilDate(payment.paymentDate??payment.confirmedDate);
  // The one-time credit is frozen in the original checkout intent and applied
  // to EVERY recurrence end once, never compounded across billing cycles.
  const credit=intent.courtesy_credit_ms??0;
  if(!Number.isSafeInteger(credit)||credit<0||credit>31536000000)return 'review';
  const end=paid?periodEnd(dueOn,change?.plan_code??intent.plan_code)+credit:null;
  if(prior&&previous?.state===state&&previous.amount_cents===amount&&
    previous.details===details&&previous.refunded_amount_cents===refund)return 'processed';
  statements.push(env.DB.prepare(
    "INSERT INTO billing_payment_records(id,owner_uid,subscription_id,provider,provider_payment_ref,state,amount_cents,currency,due_on,verified_at,paid_at,period_ends_at,applied_at,created_at,updated_at,details,invoice_path,refunded_amount_cents) "+
    "VALUES(?,?,?,'asaas',?,?,?,'BRL',?,?,?,?,?,?,?,?,?,?) ON CONFLICT(provider,provider_payment_ref) DO UPDATE SET "+
    "state=excluded.state,amount_cents=excluded.amount_cents,verified_at=excluded.verified_at,paid_at=excluded.paid_at,period_ends_at=excluded.period_ends_at,applied_at=excluded.applied_at,updated_at=excluded.updated_at,details=excluded.details,invoice_path=excluded.invoice_path,refunded_amount_cents=excluded.refunded_amount_cents "+
    'WHERE billing_payment_records.owner_uid=excluded.owner_uid AND billing_payment_records.subscription_id=excluded.subscription_id '+
    'AND billing_payment_records.refunded_amount_cents<=excluded.refunded_amount_cents'
  ).bind(crypto.randomUUID(),intent.owner_uid,subId,ref,state,amount,dueOn,now,paid&&paidOn?billingDateInstant(paidOn):previous?.paid_at??null,
    end,paid?now:null,now,now,details,canceledInvoice?null:invoicePath,refund));
  if(paid&&change&&change.state!=='applied'){
    const verified=" EXISTS(SELECT 1 FROM billing_payment_records WHERE provider='asaas' AND provider_payment_ref=? "+
      "AND subscription_id=? AND refunded_amount_cents=0 AND state IN ('confirmed','received'))";
    statements.push(
      env.DB.prepare("UPDATE access_subscriptions SET cadence=? WHERE id=? AND owner_uid=? AND cadence<>? AND cadence<>'yearly' AND"+verified)
        .bind(change.plan_code,subId,intent.owner_uid,change.plan_code,ref,subId),
      env.DB.prepare("UPDATE billing_plan_changes SET state='applied' WHERE id=? AND state IN ('applying','verifying','scheduled','review') AND"+verified)
        .bind(change.id,ref,subId),
    );
  }
  if(!prior&&!paid)await env.DB.batch(statements);
  else await refreshPaidWindow(env,intent.owner_uid,subId,now,statements);
  return state==='review'&&!details?'review':'processed';
}

async function reconcileCheckout(env:Env,event:InboxEvent,ref:string):Promise<'processed'|'ignored'|'review'>{
  const now=Date.now();
  if(event.checkout_intent_ref){
    // Authenticated Asaas event can recover the ID when the POST response was lost.
    await env.DB.prepare("UPDATE billing_checkout_intents SET provider_checkout_ref=?,updated_at=?,recovery_after=? WHERE id=? AND status='pending' AND provider_checkout_ref IS NULL")
      .bind(ref,now,now+120000,event.checkout_intent_ref).run();
  }
  const intent=await intentByCheckout(env,ref);
  if(!intent)throw new ApiError(503,'billing_checkout_unlinked');
  if(event.event_type==='CHECKOUT_PAID'&&intent.status==='completed'){
    const verified=await env.DB.prepare(
      "SELECT 1 FROM billing_payment_records WHERE owner_uid=? AND subscription_id=? AND provider='asaas' "+
      "AND (applied_at IS NOT NULL OR paid_at IS NOT NULL OR state='refunded') LIMIT 1"
    ).bind(intent.owner_uid,intent.id).first();
    if(verified)return 'processed';
  }
  if((event.event_id.startsWith('recovery:')||event.event_id.startsWith('return:'))&&!['pending','ready'].includes(intent.status))return 'ignored';
  if(['CHECKOUT_CANCELED','CHECKOUT_EXPIRED','CHECKOUT_CLOSE'].includes(event.event_type)){
    const proof=event.event_type==='CHECKOUT_CANCELED'?'canceled':event.event_type==='CHECKOUT_EXPIRED'?'expired':undefined;
    const closure=await observeCheckoutClosure(env,intent,ref,proof);
    if(closure.state==='has_payment'){
      const {payment}=closure;
      const status=intent.payment_method==='PIX'
        ?await reconcilePixPayment(env,payment.raw,payment.id,event.event_type)
        :await reconcilePayment(env,payment.raw,payment.id);
      const latest=await intentByCheckout(env,ref);
      if(latest?.status==='completed')return status;
      // Keep the checkout locked while settlement is unresolved. A pending
      // payment or an empty lookup without terminal proof cannot release it.
      if(status==='review')return 'review';
      throw new ApiError(503,'billing_checkout_payment_verifying');
    }
  }else if(event.event_type==='CHECKOUT_CREATED'){
    if(intent.expires_at>now&&!await accountDeleting(env,intent.owner_uid)){
      const path=paymentGateway(env).checkoutPath(ref);
      await env.DB.prepare("UPDATE billing_checkout_intents SET status='ready',checkout_path=?,updated_at=? WHERE id=? AND status='pending'")
        .bind(path,now,intent.id).run();
    }
  }else if(event.event_type==='CHECKOUT_PAID'||(event.event_id.startsWith('recovery:')||event.event_id.startsWith('return:'))){
    const result=await asaasRequest(env,'GET',`/payments?checkoutSession=${ref}&limit=2`);
    if(!Array.isArray(result.data)||result.hasMore===true||result.data.length>1)return 'review';
    const payment=result.data[0] as Record<string,unknown>|undefined;
    const paymentRef=providerRef(payment?.id);
    if(!payment||!paymentRef)throw new ApiError(503,'billing_payment_not_visible');
    if(payment.checkoutSession!==ref)return 'review';
    return intent.payment_method==='PIX'
      ?reconcilePixPayment(env,payment,paymentRef,event.event_type)
      :reconcilePayment(env,payment,paymentRef);
  }
  return 'processed';
}

async function reconcileContract(env:Env,ref:string,eventType:string):Promise<'processed'|'ignored'|'review'>{
  const linked=await loadContract(env,ref);
  if(!linked)return 'ignored';
  let remote:Record<string,unknown>;
  try{remote=await asaasRequest(env,'GET',`/subscriptions/${ref}`);}
  catch(error){
    if(!(error instanceof AsaasError&&error.upstreamStatus===404&&eventType==='SUBSCRIPTION_DELETED'))throw error;
    remote={id:ref,customer:linked.provider_customer_ref,deleted:true};
  }
  if(remote.id!==ref||remote.customer!==linked.provider_customer_ref)return 'review';
  const stopped=remote.deleted===true||remote.status==='INACTIVE';
  if(!stopped&&remote.status!=='ACTIVE')return 'review';
  if(!stopped&&linked.stopped_at!==null)return 'review';
  const now=Date.now();
  const update=env.DB.prepare('UPDATE billing_contracts SET next_due_on=?,stopped_at=COALESCE(stopped_at,?),removed_at=COALESCE(removed_at,?) WHERE subscription_id=?')
    .bind(stopped?null:civilDate(remote.nextDueDate),stopped?now:null,remote.deleted===true?now:null,linked.subscription_id);
  const removed=remote.deleted===true&&linked.removed_at===null;
  if((removed||stopped&&linked.stopped_at===null)&&!await accountDeleting(env,linked.owner_uid)){
    const statements=[update];
    if(removed)statements.push(closeUnpaidInvoices(env,linked.owner_uid,linked.subscription_id,now));
    await refreshPaidWindow(env,linked.owner_uid,linked.subscription_id,now,statements);
  }
  else await update.run();
  return 'processed';
}

async function processInbox(env:Env):Promise<boolean>{
  const now=Date.now(),lease=crypto.randomUUID();
  const event=await env.DB.prepare(
    "UPDATE billing_webhook_events SET status='pending',lease_id=?,lease_until=?,attempts=attempts+1 WHERE provider='asaas' AND event_id=("+
    "SELECT event_id FROM billing_webhook_events WHERE provider='asaas' AND (status='pending' OR "+
    "(status='review' AND event_type='PAYMENT_PARTIALLY_REFUNDED' AND attempts=1 AND processed_at IS NOT NULL AND last_error_code IS NULL) OR "+
    "(status='review' AND event_type='CHECKOUT_PAID' AND attempts=8 AND last_error_code='billing_payment_not_visible' "+
    "AND EXISTS(SELECT 1 FROM billing_checkout_intents i JOIN billing_payment_records p ON p.subscription_id=i.id "+
    "AND p.owner_uid=i.owner_uid AND p.provider=i.provider "+
    "WHERE i.provider='asaas' AND i.provider_checkout_ref=billing_webhook_events.resource_ref AND i.status='completed' "+
    "AND (p.applied_at IS NOT NULL OR p.paid_at IS NOT NULL OR p.state='refunded')))) "+
    'AND resource_ref IS NOT NULL AND next_attempt_at<=? AND lease_until<=? '+
    "AND NOT EXISTS(SELECT 1 FROM billing_webhook_events WHERE provider='asaas' AND status='pending' AND lease_until>?) "+
    'ORDER BY next_attempt_at,received_at LIMIT 1) RETURNING event_id,event_type,resource_ref,checkout_intent_ref,attempts'
  ).bind(lease,now+90000,now,now,now).first<InboxEvent>();
  if(!event)return false;
  let status:'processed'|'ignored'|'pending'|'review'='review',code:string|null=null;
  try{
    const action=event.event_type==='CHECKOUT_CLOSE'||event.event_type==='CHECKOUT_RECOVERY'
      ?'reconcile_checkout':planBillingEvent(event.event_type).action;
    const ref=providerRef(event.resource_ref);
    if(ref&&action==='reconcile_payment'){
      try{
        const payment=await asaasRequest(env,'GET',`/payments/${ref}`);
        status=payment.billingType==='PIX'
          ?await reconcilePixPayment(env,payment,ref,event.event_type)
          :await reconcilePayment(env,payment,ref,event.event_type);
      }catch(error){
        if(!(error instanceof AsaasError&&error.upstreamStatus===404&&event.event_type==='PAYMENT_DELETED'))throw error;
        const previous=await env.DB.prepare("SELECT details FROM billing_payment_records WHERE provider='asaas' AND provider_payment_ref=?")
          .bind(ref).first<{details:string|null}>();
        // A deletion with no provider record cannot reverse a payment. The
        // confirmed subscription removal closes previously unpaid invoices.
        status=previous?.details==='canceled_invoice'?'processed':'review';
      }
    }else if(ref&&action==='reconcile_checkout'){
      status=await reconcileCheckout(env,event,ref);
    }else if(ref&&action==='reconcile_contract'){
      status=await reconcileContract(env,ref,event.event_type);
    }
  }catch(error){
    status=event.attempts>=8?'review':'pending';
    code=error instanceof ApiError?error.code:'billing_reconciliation_failed';
  }
  await env.DB.prepare('UPDATE billing_webhook_events SET status=?,next_attempt_at=?,processed_at=?,last_error_code=?,updated_at=?,lease_id=NULL,lease_until=0 WHERE provider=? AND event_id=? AND lease_id=?')
    .bind(status,Date.now()+Math.min(3600000,30000*2**event.attempts),status==='pending'?null:Date.now(),code,Date.now(),'asaas',event.event_id,lease).run();
  if(status==='review')console.warn(JSON.stringify({event:'billing_event_review',code:code??'billing_event_unresolved'}));
  return true;
}

async function recoverCheckout(env:Env):Promise<void>{
  const now=Date.now();
  const expired=await env.DB.prepare(
    "SELECT i.id,i.owner_uid FROM billing_checkout_intents i WHERE i.status IN ('pending','ready') "+
    "AND i.expires_at<=? AND i.provider_checkout_ref IS NOT NULL "+
    "AND NOT EXISTS(SELECT 1 FROM billing_webhook_events e WHERE e.provider=i.provider AND e.event_id='close:'||i.id) "+
    "ORDER BY i.expires_at LIMIT 1"
  ).bind(now).first<{id:string;owner_uid:string}>();
  if(expired){
    await queueCheckoutClosure(env,expired.id,expired.owner_uid,now);
    return;
  }
  const pending=await env.DB.prepare(
    "SELECT id FROM billing_checkout_intents WHERE status IN ('pending','ready') "+
    'AND provider_checkout_ref IS NOT NULL AND recovery_after<=? ORDER BY recovery_after LIMIT 1'
  ).bind(now).first<{id:string}>();
  if(!pending)return;
  // One durable, bounded recovery job shares the inbox lease, even if the
  // provider delivery and the scheduled read arrive concurrently.
  await env.DB.batch([
    env.DB.prepare(
      "INSERT OR IGNORE INTO billing_webhook_events(provider,event_id,event_type,resource_type,resource_ref,status,received_at,updated_at) "+
      "SELECT 'asaas',?,'CHECKOUT_RECOVERY','checkout',provider_checkout_ref,'pending',?,? FROM billing_checkout_intents "+
      "WHERE id=? AND recovery_after<=? AND provider_checkout_ref IS NOT NULL AND status IN ('pending','ready')"
    ).bind('recovery:'+pending.id,now,now,pending.id,now),
    env.DB.prepare("UPDATE billing_checkout_intents SET recovery_after=NULL WHERE id=? AND recovery_after<=?")
      .bind(pending.id,now)
  ]);
}

export async function reconcileBilling(env:Env):Promise<void>{
  if(!asaasConfigured(env))return;
  try{
    if(!await processInbox(env))await recoverCheckout(env);
  }finally{await flushBillingProjection(env);}
}
