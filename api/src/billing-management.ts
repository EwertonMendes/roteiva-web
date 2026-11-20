import {asaasConfigured,AsaasError,asaasRequest,providerRef} from './billing-asaas.ts';
import {openCheckout, type CheckoutIntent} from './billing-checkout.ts';
import {flushBillingProjection} from './billing-projection.ts';
import {refreshPaidWindow} from './billing-reconciliation.ts';
import {cents} from './billing-period.ts';
import {readBillingJson} from './billing-webhook.ts';
import {ApiError,type Env} from './types.ts';

async function removeRecurrence(env:Env,ref:string):Promise<void>{
  try{
    const remote=await asaasRequest(env,'DELETE',`/subscriptions/${ref}`);
    if(remote.id!==ref||remote.deleted!==true)throw new ApiError(502,'billing_provider_invalid_response');
  }catch(error){
    // Retry after a lost response. The subscription must have previously been
    // verified on this account. A definitive GET can corroborate its removal.
    if(!(error instanceof AsaasError&&error.upstreamStatus===404))throw error;
    const remote=await asaasRequest(env,'GET',`/subscriptions/${ref}`);
    if(remote.id!==ref||remote.deleted!==true)throw new ApiError(502,'billing_provider_invalid_response');
  }
}

type Recurrence={subscription_id:string;provider_reference:string};

async function stopContract(env:Env,uid:string,contract:Recurrence,deleting:boolean):Promise<void>{
  const ref=providerRef(contract.provider_reference);
  if(!ref)throw new ApiError(503,'billing_contract_invalid');
  await removeRecurrence(env,ref);
  const now=Date.now();
  const stop=env.DB.prepare('UPDATE billing_contracts SET stopped_at=COALESCE(stopped_at,?),removed_at=?,next_due_on=NULL,cancel_after=NULL WHERE owner_uid=? AND subscription_id=?')
    .bind(now,now,uid,contract.subscription_id);
  if(deleting)await stop.run();
  else await refreshPaidWindow(env,uid,contract.subscription_id,now,[stop]);
}

function recurringContract(env:Env,uid:string):Promise<Recurrence|null>{
  return env.DB.prepare('SELECT c.subscription_id,s.provider_reference FROM billing_contracts c '+
    'JOIN access_subscriptions s ON s.id=c.subscription_id WHERE c.owner_uid=? AND c.removed_at IS NULL LIMIT 1')
    .bind(uid).first<Recurrence>();
}

async function attemptCancellation(env:Env,uid:string,contract:Recurrence):Promise<boolean>{
  const now=Date.now();
  const job=await env.DB.prepare(
    'UPDATE billing_contracts SET cancel_attempts=cancel_attempts+1,cancel_after=? WHERE subscription_id=? '+
    'AND owner_uid=? AND removed_at IS NULL AND cancel_after<=? AND cancel_attempts<8 RETURNING cancel_attempts'
  ).bind(now+90000,contract.subscription_id,uid,now).first<{cancel_attempts:number}>();
  if(!job)return false;
  try{
    await stopContract(env,uid,contract,false);
    return true;
  }catch{
    await env.DB.prepare('UPDATE billing_contracts SET cancel_after=? WHERE subscription_id=? AND owner_uid=? AND removed_at IS NULL AND cancel_attempts=?')
      .bind(now+Math.min(3600000,60000*2**job.cancel_attempts),contract.subscription_id,uid,job.cancel_attempts).run();
    if(job.cancel_attempts===8)console.warn(JSON.stringify({event:'billing_cancellation_review'}));
    return false;
  }
}

export async function retryBillingCancellation(env:Env):Promise<void>{
  if(env.ENVIRONMENT!=='dev'||!asaasConfigured(env))return;
  const job=await env.DB.prepare(
    'SELECT c.owner_uid,c.subscription_id,s.provider_reference FROM billing_contracts c JOIN access_subscriptions s ON s.id=c.subscription_id '+
    'WHERE c.removed_at IS NULL AND c.cancel_after<=? AND c.cancel_attempts<8 '+
    'AND NOT EXISTS(SELECT 1 FROM account_deletions d WHERE d.owner_uid=c.owner_uid) ORDER BY c.cancel_after LIMIT 1'
  ).bind(Date.now()).first<Recurrence&{owner_uid:string}>();
  if(job)await attemptCancellation(env,job.owner_uid,job);
}

export async function cancelRenewal(request:Request,env:Env,uid:string):Promise<Response>{
  if(env.ENVIRONMENT!=='dev'||!asaasConfigured(env))throw new ApiError(404,'not_found');
  const data=await readBillingJson(request,1024) as {confirmed?:unknown}|null;
  if(data?.confirmed!==true||Object.keys(data).length!==1)throw new ApiError(400,'billing_consent_required');
  const contract=await recurringContract(env,uid);
  if(contract){
    await env.DB.prepare('UPDATE billing_contracts SET cancel_after=? WHERE owner_uid=? AND subscription_id=? AND cancel_after IS NULL AND removed_at IS NULL '+
      "AND NOT EXISTS (SELECT 1 FROM billing_plan_changes WHERE subscription_id=billing_contracts.subscription_id AND state='applying')")
      .bind(Date.now(),uid,contract.subscription_id).run();
    if(await env.DB.prepare("SELECT 1 FROM billing_plan_changes WHERE subscription_id=? AND state='applying'")
      .bind(contract.subscription_id).first())throw new ApiError(409,'billing_upgrade_in_progress');
    const completed=await attemptCancellation(env,uid,contract);
    if(completed){
      await flushBillingProjection(env,uid);
      return Response.json({status:'canceled'});
    }
    return Response.json({status:'pending'},{status:202});
  }
  const previous=await env.DB.prepare('SELECT 1 FROM billing_contracts WHERE owner_uid=? AND removed_at IS NOT NULL LIMIT 1').bind(uid).first();
  if(previous)return Response.json({status:'canceled'});
  throw new ApiError(409,'billing_no_active_subscription');
}

/** Do not erase the local linkage while a checkout can still start a recurrence. */
async function stopOpenCheckout(env:Env,intent:CheckoutIntent):Promise<void>{
  const ref=providerRef(intent.provider_checkout_ref);
  if(!ref)throw new ApiError(503,'billing_deletion_checkout_unresolved');
  let result:Record<string,unknown>|undefined;
  try{result=await asaasRequest(env,'POST',`/checkouts/${ref}/cancel`);}
  catch(error){
    if(!(error instanceof AsaasError&&error.upstreamStatus===400))throw error;
  }
  if(result?.id!==ref||result.status!=='CANCELED'){
    const list=await asaasRequest(env,'GET',`/payments?checkoutSession=${ref}&limit=2`);
    if(!Array.isArray(list.data)||list.data.length!==1||list.hasMore===true)
      throw new ApiError(503,'billing_deletion_checkout_unresolved');
    const payment=list.data[0] as Record<string,unknown>;
    const sub=providerRef(payment.subscription);
    const customer=providerRef(payment.customer);
    if(!sub||!customer||payment.checkoutSession!==ref||payment.billingType!=='CREDIT_CARD'||cents(payment.value)!==intent.amount_cents)
      throw new ApiError(503,'billing_deletion_checkout_unresolved');
    const owner=await env.DB.prepare('SELECT owner_uid FROM billing_customers WHERE provider_customer_ref=?').bind(customer).first<{owner_uid:string}>();
    if(owner&&owner.owner_uid!==intent.owner_uid)throw new ApiError(503,'billing_deletion_checkout_unresolved');
    await removeRecurrence(env,sub);
  }
  await env.DB.prepare("UPDATE billing_checkout_intents SET status='canceled',updated_at=? WHERE id=? AND status IN ('pending','ready')")
    .bind(Date.now(),intent.id).run();
}

export async function stopBillingForDeletion(env:Env,uid:string):Promise<boolean>{
  if(env.ENVIRONMENT!=='dev')return true;
  const [intent,contract]=await Promise.all([openCheckout(env,uid),recurringContract(env,uid)]);
  if(!intent&&!contract)return true;
  if(!asaasConfigured(env))throw new ApiError(503,'billing_deletion_unavailable');
  if(contract&&await env.DB.prepare("SELECT 1 FROM billing_plan_changes WHERE subscription_id=? AND state='applying'")
    .bind(contract.subscription_id).first())throw new ApiError(503,'billing_upgrade_in_progress');
  if(intent)await stopOpenCheckout(env,intent);
  if(contract)await stopContract(env,uid,contract,true);
  return !await recurringContract(env,uid);
}
