
import {activeState} from './access.ts';
import {asaasConfigured,AsaasError,asaasRequest,checkoutEnabled,checkoutTestUsers,providerRef} from './billing-asaas.ts';
import {requireBillingPlan,type BillingPlanCode} from './billing-catalog.ts';
import {billingDateInstant,cents,civilDate,periodEnd} from './billing-period.ts';
import {readBillingJson} from './billing-webhook.ts';
import {ApiError,type Env} from './types.ts';

const MUTATION_WINDOW=120000;
const rank:Record<BillingPlanCode,number>={monthly:0,quarterly:1,yearly:2};
const destinations:Record<BillingPlanCode,readonly BillingPlanCode[]>={
  monthly:['quarterly','yearly'],quarterly:['yearly'],yearly:[],
};
type ChangeState='applying'|'verifying'|'scheduled'|'applied'|'rejected'|'review';
type Change={
  id:string;owner_uid:string;subscription_id:string;plan_code:BillingPlanCode;
  amount_cents:number;effective_on:string;next_due_on:string|null;state:ChangeState;attempts:number;
};
type Contract={
  id:string;owner_uid:string;cadence:BillingPlanCode;paid_until:number;amount_cents:number;
  provider_reference:string;provider_customer_ref:string;
};
type RemoteContract={ref:string;customer:string};

export function upgradeRouted(env:Env):boolean{
  // Upgrades are available only to the configured test users during rollout.
  return checkoutTestUsers(env).some(uid=>checkoutEnabled(env,uid));
}
export function upgradeOffer(env:Env,uid:string,plan:BillingPlanCode,paidUntil:number,now:number){
  if(!upgradeRouted(env)||!checkoutTestUsers(env).includes(uid)||
    paidUntil<=now+MUTATION_WINDOW||!destinations[plan].length)return null;
  const effectiveOn=civilDate(new Date(paidUntil).toISOString().slice(0,10));
  if(!effectiveOn||billingDateInstant(effectiveOn)!==paidUntil)return null;
  return {effectiveOn,plans:destinations[plan]};
}

export function currentUpgrade(env:Env,uid:string,subId:string):Promise<Change|null>{
  return env.DB.prepare("SELECT * FROM billing_plan_changes WHERE owner_uid=? AND subscription_id=? "+
    "AND state IN ('applying','verifying','scheduled','review') ORDER BY created_at DESC LIMIT 1")
    .bind(uid,subId).first<Change>();
}

export async function termsAtRenewal(env:Env,subId:string,dueOn:string,afterRemovalAmount?:number|null):Promise<Change|null>{
  const change=await env.DB.prepare(
    "SELECT * FROM billing_plan_changes WHERE subscription_id=? AND effective_on<=? "+
    "AND (state IN ('applying','verifying','scheduled','applied') OR (?=1 AND state='review')) ORDER BY effective_on DESC LIMIT 1"
  ).bind(subId,dueOn,afterRemovalAmount!==undefined?1:0).first<Change>();
  if(!change||change.state==='scheduled'||change.state==='applied')return change;
  if(afterRemovalAmount===undefined)throw new ApiError(503,'billing_upgrade_verifying');
  // After removal there is no recurrence left to verify. A payment that
  // already settled can match the exact amount and first date consented
  // before the PUT. Otherwise use the last verified terms.
  if(change.next_due_on&&change.effective_on===dueOn&&change.amount_cents===afterRemovalAmount)return change;
  return env.DB.prepare(
    "SELECT * FROM billing_plan_changes WHERE subscription_id=? AND effective_on<=? "+
    "AND state IN ('scheduled','applied') ORDER BY effective_on DESC LIMIT 1"
  ).bind(subId,dueOn).first<Change>();
}

function contractForUpgrade(env:Env,uid:string):Promise<Contract|null>{
  return env.DB.prepare(
    'SELECT s.id,s.owner_uid,s.cadence,s.paid_until,s.provider_reference,b.provider_customer_ref,'+
    "COALESCE((SELECT u.amount_cents FROM billing_plan_changes u WHERE u.subscription_id=s.id AND u.state='applied' ORDER BY u.effective_on DESC LIMIT 1),i.amount_cents) AS amount_cents "+
    'FROM access_subscriptions s JOIN billing_contracts c ON c.subscription_id=s.id '+
    'JOIN billing_checkout_intents i ON i.id=c.checkout_intent_id JOIN billing_customers b ON b.owner_uid=s.owner_uid '+
    "WHERE s.owner_uid=? AND s.provider='asaas' AND s.status='active' AND c.cancel_after IS NULL AND c.stopped_at IS NULL AND c.removed_at IS NULL"
  ).bind(uid).first<Contract>();
}

function remoteIdentity(contract:Contract):RemoteContract{
  const ref=providerRef(contract.provider_reference),customer=providerRef(contract.provider_customer_ref);
  if(!ref||!customer)throw new ApiError(409,'billing_upgrade_unavailable');
  return {ref,customer};
}

function matchesContract(remote:Record<string,unknown>,target:RemoteContract,plan:BillingPlanCode,amount:number){
  return remote.id===target.ref&&remote.customer===target.customer&&remote.deleted!==true&&
    remote.status==='ACTIVE'&&remote.billingType==='CREDIT_CARD'&&
    remote.cycle===requireBillingPlan(plan).cycle&&cents(remote.value)===amount;
}

async function upcomingInvoice(env:Env,target:RemoteContract,effectiveOn:string,amount:number,allowSettled=false):Promise<string|null>{
  const list=await asaasRequest(env,'GET',`/payments?subscription=${target.ref}&dueDate%5Bge%5D=${effectiveOn}&limit=3`);
  if(list.hasMore!==false||!Array.isArray(list.data)||list.data.length>1)throw new ApiError(409,'billing_upgrade_invoice_conflict');
  const invoice=list.data[0] as Record<string,unknown>|undefined;
  if(!invoice)return null;
  const id=providerRef(invoice.id);
  const validState=invoice.status==='PENDING'||(allowSettled&&['CONFIRMED','RECEIVED'].includes(String(invoice.status)));
  if(!id||invoice.subscription!==target.ref||invoice.customer!==target.customer||
    invoice.billingType!=='CREDIT_CARD'||invoice.deleted===true||
    !validState||civilDate(invoice.dueDate)!==effectiveOn||
    civilDate(invoice.originalDueDate??invoice.dueDate)!==effectiveOn||cents(invoice.value)!==amount){
    throw new ApiError(409,'billing_upgrade_invoice_conflict');
  }
  return id;
}

const followingDue=(effectiveOn:string,plan:BillingPlanCode)=>new Date(periodEnd(effectiveOn,plan)).toISOString().slice(0,10);

async function verifySchedule(env:Env,change:Change,target:RemoteContract):Promise<boolean>{
  const remote=await asaasRequest(env,'GET',`/subscriptions/${target.ref}`);
  if(!matchesContract(remote,target,change.plan_code,change.amount_cents))return false;
  const invoice=await upcomingInvoice(env,target,change.effective_on,change.amount_cents,true);
  const expected=invoice?followingDue(change.effective_on,change.plan_code):change.effective_on;
  if(civilDate(remote.nextDueDate)!==expected)return false;
  const result=await env.DB.prepare("UPDATE billing_plan_changes SET state='scheduled' WHERE id=? AND state IN ('applying','verifying')"+
    " AND EXISTS(SELECT 1 FROM billing_contracts WHERE subscription_id=billing_plan_changes.subscription_id AND removed_at IS NULL AND stopped_at IS NULL)")
    .bind(change.id).run();
  return result.meta.changes===1;
}

function mark(env:Env,id:string,state:'verifying'|'rejected'|'review',retryAt=0){
  return env.DB.prepare("UPDATE billing_plan_changes SET state=?,retry_at=? WHERE id=? AND state IN ('applying','verifying')")
    .bind(state,retryAt,id).run();
}

export async function requestUpgrade(env:Env,uid:string,request:Request):Promise<Response>{
  if(!upgradeRouted(env)||!checkoutTestUsers(env).includes(uid))throw new ApiError(404,'not_found');
  const body=await readBillingJson(request,1024) as {
    planCode?:unknown;catalogVersion?:unknown;effectiveOn?:unknown;confirmed?:unknown;
  }|null;
  if(!body||body.confirmed!==true||!civilDate(body.effectiveOn)||Object.keys(body).length!==4)
    throw new ApiError(400,'billing_consent_required');
  const plan=requireBillingPlan(body.planCode);
  if(body.catalogVersion!==plan.version)throw new ApiError(409,'billing_catalog_changed');
  const now=Date.now();
  const [access,contract]=await Promise.all([activeState(env,uid,now),contractForUpgrade(env,uid)]);
  if(!access?.active||access.suspended||!contract||rank[plan.code]<=rank[contract.cadence])
    throw new ApiError(409,'billing_upgrade_unavailable');
  const offer=upgradeOffer(env,uid,contract.cadence,contract.paid_until,now);
  if(!offer||offer.effectiveOn!==body.effectiveOn)throw new ApiError(409,'billing_upgrade_terms_changed');

  const id=crypto.randomUUID(),effective=offer.effectiveOn,target=remoteIdentity(contract);
  const claimed=await env.DB.prepare(
    'INSERT OR IGNORE INTO billing_plan_changes(id,owner_uid,subscription_id,plan_code,amount_cents,catalog_version,effective_on,state,retry_at,created_at) '+
    "SELECT ?,s.owner_uid,s.id,?,?,?,?,'applying',?,? FROM access_subscriptions s "+
    'JOIN billing_contracts c ON c.subscription_id=s.id JOIN access_accounts a ON a.owner_uid=s.owner_uid '+
    "WHERE s.id=? AND s.owner_uid=? AND s.cadence=? AND s.paid_until=? AND s.status='active' "+
    'AND c.cancel_after IS NULL AND c.stopped_at IS NULL AND c.removed_at IS NULL AND a.suspended_at IS NULL AND a.sync_pending=0 '+
    'AND NOT EXISTS (SELECT 1 FROM account_deletions WHERE owner_uid=s.owner_uid)'
  ).bind(id,plan.code,plan.amountCents,plan.version,effective,now+75000,now,contract.id,uid,contract.cadence,contract.paid_until).run();
  if(claimed.meta.changes!==1){
    const current=await currentUpgrade(env,uid,contract.id);
    if(current?.plan_code===plan.code&&current.effective_on===effective&&current.state!=='review')
      return Response.json({status:current.state==='scheduled'?'scheduled':'pending'},{status:current.state==='scheduled'?200:202});
    throw new ApiError(409,'billing_upgrade_in_progress');
  }

  let nextDue:string,invoice:string|null;
  try{
    const remote=await asaasRequest(env,'GET',`/subscriptions/${target.ref}`);
    if(!matchesContract(remote,target,contract.cadence,contract.amount_cents))throw new ApiError(409,'billing_upgrade_unavailable');
    invoice=await upcomingInvoice(env,target,effective,contract.amount_cents);
    if(invoice){
      const pending=await asaasRequest(env,'GET',`/subscriptions/${target.ref}/payments?status=PENDING`);
      if(pending.hasMore!==false||!Array.isArray(pending.data)||pending.data.length!==1||pending.data[0]?.id!==invoice)
        throw new ApiError(409,'billing_upgrade_invoice_conflict');
    }
    const before=invoice?followingDue(effective,contract.cadence):effective;
    if(civilDate(remote.nextDueDate)!==before)throw new ApiError(409,'billing_upgrade_invoice_conflict');
    nextDue=invoice?followingDue(effective,plan.code):effective;
    const ready=await env.DB.prepare("UPDATE billing_plan_changes SET next_due_on=? WHERE id=? AND state='applying' "+
      'AND EXISTS(SELECT 1 FROM billing_contracts c JOIN access_subscriptions s ON s.id=c.subscription_id '+
      "WHERE c.subscription_id=? AND c.cancel_after IS NULL AND c.removed_at IS NULL AND c.stopped_at IS NULL AND s.status='active' AND s.paid_until=?) "+
      'AND EXISTS(SELECT 1 FROM access_accounts WHERE owner_uid=? AND suspended_at IS NULL AND sync_pending=0) '+
      'AND NOT EXISTS(SELECT 1 FROM account_deletions WHERE owner_uid=?)')
      .bind(nextDue,id,contract.id,contract.paid_until,uid,uid).run();
    if(ready.meta.changes!==1)throw new ApiError(409,'billing_upgrade_unavailable');
  }catch(error){
    await mark(env,id,'rejected');
    throw error;
  }

  const change:Change={id,owner_uid:uid,subscription_id:contract.id,plan_code:plan.code,
    amount_cents:plan.amountCents,effective_on:effective,next_due_on:nextDue,state:'applying',attempts:0};
  try{
    // Mutate the existing recurrence. Never replay this write after a lost response.
    await asaasRequest(env,'PUT',`/subscriptions/${target.ref}`,{
      value:plan.amountCents/100,cycle:plan.cycle,nextDueDate:nextDue,updatePendingPayments:!!invoice,
    });
  }catch(error){
    if(error instanceof AsaasError&&[400,401,403,404,422].includes(error.upstreamStatus??0)){
      await mark(env,id,'rejected');
      throw new ApiError(409,'billing_upgrade_provider_rejected');
    }
    await mark(env,id,'verifying',Date.now()+60000);
    return Response.json({status:'pending'},{status:202});
  }
  try{
    if(await verifySchedule(env,change,target))return Response.json({status:'scheduled'});
  }catch{/* Provider reads can lag behind the mutation. Verify again without replaying it. */}
  await mark(env,id,'verifying',Date.now()+60000);
  return Response.json({status:'pending'},{status:202});
}

export async function recoverUpgrade(env:Env):Promise<void>{
  if(!asaasConfigured(env))return;
  const now=Date.now();
  const change=await env.DB.prepare(
    "UPDATE billing_plan_changes SET attempts=attempts+1,retry_at=? WHERE id=("+
    "SELECT id FROM billing_plan_changes WHERE state IN ('applying','verifying') AND retry_at<=? ORDER BY retry_at LIMIT 1) RETURNING *"
  ).bind(now+90000,now).first<Change>();
  if(!change)return;
  if(!change.next_due_on){await mark(env,change.id,'rejected');return;}
  const contract=await contractForUpgrade(env,change.owner_uid);
  try{
    if(contract?.id===change.subscription_id&&await verifySchedule(env,change,remoteIdentity(contract)))return;
  }catch{/* Ambiguous provider state stays fenced. */}
  if(change.attempts>=8){
    await mark(env,change.id,'review');
    console.warn(JSON.stringify({event:'billing_upgrade_review'}));
  }else await mark(env,change.id,'verifying',now+Math.min(3600000,60000*2**change.attempts));
}
