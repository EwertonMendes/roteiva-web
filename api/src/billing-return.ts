import {asaasConfigured} from './billing-asaas.ts';
import {ApiError,type Env} from './types.ts';

/**
 * An authenticated, owner-scoped nudge for the existing durable reconciliation inbox.
 * A browser callback is never proof of payment. This inserts no grants, contracts,
 * payments or access projections; the existing Asaas-verified worker does that.
 */
export async function requestCheckoutReturnCheck(env:Env,uid:string,intentId:unknown):Promise<Response>{
  if(!asaasConfigured(env))throw new ApiError(404,'not_found');
  if(intentId!==null&&(typeof intentId!=='string'||!/^[0-9a-f-]{36}$/i.test(intentId)))
    throw new ApiError(400,'billing_invalid_intent');
  const intent=await (intentId?
    env.DB.prepare("SELECT id,status,provider_checkout_ref FROM billing_checkout_intents WHERE owner_uid=? AND id=? AND provider='asaas'")
      .bind(uid,intentId):
    env.DB.prepare("SELECT id,status,provider_checkout_ref FROM billing_checkout_intents WHERE owner_uid=? AND provider='asaas' ORDER BY created_at DESC LIMIT 1")
      .bind(uid)
  ).first<{id:string;status:string;provider_checkout_ref:string|null}>();
  if(!intent)return Response.json({status:'not_found'});
  if(intent.status==='completed')return Response.json({status:'processing'});
  if(['canceled','expired','failed'].includes(intent.status))return Response.json({status:'closed'});
  if(!['pending','ready'].includes(intent.status)||!intent.provider_checkout_ref)
    return Response.json({status:'pending'});
  const now=Date.now();
  // A distinct deterministic return event leaves the scheduled recovery intact.
  // Repeated returns and simultaneous tabs never create duplicate provider reads.
  await env.DB.prepare(
    "INSERT OR IGNORE INTO billing_webhook_events(provider,event_id,event_type,resource_type,resource_ref,status,received_at,updated_at) "+
    "SELECT 'asaas',?,'CHECKOUT_RECOVERY','checkout',provider_checkout_ref,'pending',?,? "+
    "FROM billing_checkout_intents WHERE id=? AND owner_uid=? AND provider='asaas' "+
    "AND status IN ('pending','ready') AND provider_checkout_ref=?"
  ).bind('return:'+intent.id,now,now,intent.id,uid,intent.provider_checkout_ref).run();
  return Response.json({status:'checking'},{status:202});
}
