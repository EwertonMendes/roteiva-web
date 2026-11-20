import {asaasConfigured} from './billing-asaas.ts';
import {ApiError,type Env} from './types.ts';

/** DEV-only, opt-in durable inbox. Absolutely no entitlements or provider calls. */
const MAX_WEBHOOK_BYTES=64*1024;
type ResourceType='checkout'|'subscription'|'payment'|'other';
type EventStatus='pending'|'review';
type IncomingEvent={
  eventId:string;
  eventType:string;
  resourceType:ResourceType;
  resourceRef:string|null;
  subscriptionRef:string|null;
  status:EventStatus;
};

function record(value:unknown):Record<string,unknown>|null{
  return value!==null&&typeof value==='object'&&!Array.isArray(value)
    ? value as Record<string,unknown> : null;
}
function reference(value:unknown):string|null{
  return typeof value==='string'&&/^[\x21-\x7e]{1,160}$/.test(value)?value:null;
}
export function parseAsaasEvent(value:unknown):IncomingEvent{
  const root=record(value);
  if(!root||typeof root.id!=='string'||! /^[\x21-\x7e]{1,240}$/.test(root.id)||
      typeof root.event!=='string'||! /^[A-Z][A-Z0-9_]{0,95}$/.test(root.event))
    throw new ApiError(400,'billing_invalid_event');
  const type:ResourceType=root.event.startsWith('CHECKOUT_')?'checkout'
    :root.event.startsWith('SUBSCRIPTION_')?'subscription'
    :root.event.startsWith('PAYMENT_')?'payment':'other';
  const related=type==='other'?null:record(root[type]);
  const resourceRef=reference(related?.id);
  const subscriptionRef=type==='payment'?reference(related?.subscription):null;
  return {
    eventId:root.id,eventType:root.event,resourceType:type,resourceRef,subscriptionRef,
    // Unknown and partial provider schemas are visible for manual review, never authorized.
    status:type!=='other'&&resourceRef!==null?'pending':'review'
  };
}
async function tokenMatches(actual:string|null,expected:string):Promise<boolean>{
  if(!actual||actual.length>255||actual.length<32||expected.length>255||
     expected.length<32||/\s/.test(actual)||/\s/.test(expected))return false;
  const encoder=new TextEncoder();
  const [a,b]=await Promise.all([
    crypto.subtle.digest('SHA-256',encoder.encode(actual)),
    crypto.subtle.digest('SHA-256',encoder.encode(expected))
  ]);
  const x=new Uint8Array(a),y=new Uint8Array(b);
  let mismatch=0;
  for(let i=0;i<x.length;i++)mismatch|=x[i]^y[i];
  return mismatch===0;
}
async function boundedPayload(request:Request):Promise<unknown>{
  const length=request.headers.get('Content-Length');
  if(length && (/^\d+$/.test(length)===false || Number(length)>MAX_WEBHOOK_BYTES))
    throw new ApiError(413,'billing_event_too_large');
  if(!request.body)throw new ApiError(400,'billing_invalid_event');
  const reader=request.body.getReader();
  const chunks:Uint8Array[]=[];
  let size=0;
  try{
    while(true){
      const part=await reader.read();
      if(part.done)break;
      size+=part.value.byteLength;
      if(size>MAX_WEBHOOK_BYTES){
        await reader.cancel().catch(()=>undefined);
        throw new ApiError(413,'billing_event_too_large');
      }
      chunks.push(part.value);
    }
  }catch(error){
    if(error instanceof ApiError)throw error;
    throw new ApiError(400,'billing_invalid_event');
  }finally{reader.releaseLock();}
  const data=new Uint8Array(size);
  let offset=0;
  for(const chunk of chunks){data.set(chunk,offset);offset+=chunk.length;}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(data));}
  catch{throw new ApiError(400,'billing_invalid_event');}
}

/**
 * Save before acknowledgement; duplicates are no-op. The future reconciliation
 * worker (not built yet) must verify ownership and paid periods independently.
 */
export async function ingestAsaasWebhook(request:Request,env:Env):Promise<Response>{
  // Safety fence until payment confirmation and reconciliation are implemented.
  // Never accept production webhooks through an unfinished billing backend.
  if(env.ENVIRONMENT!=='dev'||!asaasConfigured(env))throw new ApiError(404,'not_found');
  if(request.method!=='POST')throw new ApiError(405,'method_not_allowed');
  if(!(await tokenMatches(request.headers.get('asaas-access-token'),env.ASAAS_WEBHOOK_TOKEN!)))
    throw new ApiError(401,'billing_webhook_unauthorized');
  if(request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()!=='application/json')
    throw new ApiError(415,'billing_invalid_content_type');
  const event=parseAsaasEvent(await boundedPayload(request));
  const now=Date.now();
  try{
    const result=await env.DB.prepare(
      'INSERT OR IGNORE INTO billing_webhook_events '+
      '(provider,event_id,event_type,resource_type,resource_ref,subscription_ref,status,received_at,updated_at) '+
      'VALUES (?,?,?,?,?,?,?,?,?)'
    ).bind('asaas',event.eventId,event.eventType,event.resourceType,event.resourceRef,
      event.subscriptionRef,event.status,now,now).run();
    if(!result.success)throw new Error('persist_failed');
  }catch{throw new ApiError(503,'billing_event_persist_unavailable');}
  return new Response(null,{status:200});
}
