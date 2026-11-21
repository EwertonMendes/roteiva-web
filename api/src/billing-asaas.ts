import {ApiError,type Env} from './types.ts';

export type AsaasResource='/customers'|'/checkouts'|'/subscriptions'|
  `/payments/${string}`|`/subscriptions/${string}`|`/checkouts/${string}/cancel`|
  `/payments?checkoutSession=${string}&limit=2`|`/payments?subscription=${string}&dueDate%5Bge%5D=${string}&limit=3`|
  `/subscriptions/${string}/payments?status=PENDING`|`/payments/${string}/refunds`;
export type AsaasMethod='GET'|'POST'|'PUT'|'DELETE';
const sandboxKey=/^\$aact_hmlg_[A-Za-z0-9_+=\/-]{16,}$/;
const productionKey=/^\$aact_prod_[A-Za-z0-9_+=\/-]{16,}$/;

export function asaasConfigured(env:Env):boolean{
  const format=env.ENVIRONMENT==='dev'?sandboxKey:env.ENVIRONMENT==='prod'?productionKey:null;
  return env.BILLING_ENABLED==='true' && !!format && format.test(env.ASAAS_API_KEY??'') &&
    typeof env.ASAAS_WEBHOOK_TOKEN==='string' &&
    env.ASAAS_WEBHOOK_TOKEN.length>=32 && env.ASAAS_WEBHOOK_TOKEN.length<=255 &&
    !/\s/.test(env.ASAAS_WEBHOOK_TOKEN) && env.ASAAS_WEBHOOK_TOKEN!==env.ASAAS_API_KEY;
}

export function providerRef(value:unknown):string|null {
  return typeof value==='string' && /^[A-Za-z0-9_-]{1,160}$/.test(value)?value:null;
}

export function checkoutTestUsers(env:Env):string[]{
  return [env.BILLING_CHECKOUT_TEST_UID??'',...(env.BILLING_CHECKOUT_TEST_UIDS??'').split(',')]
    .map(uid=>uid.trim()).filter(uid=>/^[A-Za-z0-9_-]{1,128}$/.test(uid));
}

export function pixEnabled(env:Env,uid?:string):boolean{
  return env.ENVIRONMENT==='dev'&&asaasConfigured(env)&&env.BILLING_PIX_ENABLED==='true'&&
    !!uid&&checkoutTestUsers(env).includes(uid);
}

export function billingRouted(env:Env):boolean{
  return env.ENVIRONMENT==='dev'||env.ENVIRONMENT==='prod'&&asaasConfigured(env);
}

export function checkoutRouted(env:Env):boolean{
  if(!asaasConfigured(env))return false;
  const hasTestUsers=checkoutTestUsers(env).length>0;
  return env.ENVIRONMENT==='prod'
    ?env.BILLING_CHECKOUT_ENABLED==='true'&&hasTestUsers
    :env.BILLING_CHECKOUT_ENABLED==='true'||hasTestUsers;
}

export function checkoutEnabled(env:Env,uid?:string):boolean{
  return checkoutRouted(env)&&(env.ENVIRONMENT==='dev'&&env.BILLING_CHECKOUT_ENABLED==='true'||
    !!uid&&checkoutTestUsers(env).includes(uid));
}

/** Upstream status is used internally. The provider's error body is discarded. */
export class AsaasError extends ApiError {
  readonly upstreamStatus?:number;
  constructor(upstreamStatus?:number){
    super(upstreamStatus===undefined?503:502,'billing_provider_unavailable');
    this.upstreamStatus=upstreamStatus;
  }
}

export async function asaasRequest<T extends Record<string,unknown>>(
  env:Env,method:AsaasMethod,resource:AsaasResource,body?:Record<string,unknown>,
  transport:typeof fetch=fetch
):Promise<T>{
  if(!asaasConfigured(env))throw new ApiError(503,'billing_unavailable');
  const permitted=method==='GET'?
    /^\/(customers|checkouts|subscriptions|(?:payments|subscriptions)\/[A-Za-z0-9_-]{1,160}|payments\/[A-Za-z0-9_-]{1,160}\/refunds|payments\?checkoutSession=[A-Za-z0-9_-]{1,160}&limit=2|payments\?subscription=[A-Za-z0-9_-]{1,160}&dueDate%5Bge%5D=20\d\d-\d\d-\d\d&limit=3|subscriptions\/[A-Za-z0-9_-]{1,160}\/payments\?status=PENDING)$/.test(resource):
    method==='POST'?/^\/(customers|checkouts|subscriptions|checkouts\/[A-Za-z0-9_-]{1,160}\/cancel)$/.test(resource):
    (method==='PUT'||method==='DELETE')&&/^\/subscriptions\/[A-Za-z0-9_-]{1,160}$/.test(resource);
  if(!permitted||((method==='GET'||method==='DELETE')&&body!==undefined))throw new ApiError(400,'billing_invalid_request');
  const base=env.ENVIRONMENT==='dev'?'https://api-sandbox.asaas.com/v3':'https://api.asaas.com/v3';
  let response:Response;
  try{
    response=await transport(base+resource,{
      method,redirect:'manual',headers:{
        access_token:env.ASAAS_API_KEY!,
        Accept:'application/json','Content-Type':'application/json',
        'User-Agent':'Roteiva/1.0'
      }, ...(body===undefined?{}:{body:JSON.stringify(body)}),
      signal:AbortSignal.timeout(10000),
    });
  }catch{throw new AsaasError();}
  if(!response.ok){
    // Financial provider responses may contain customer details. Never log
    // the body or an untrusted description. Classify only known, static error
    // codes/field names so a Sandbox rejection is diagnosable without PII.
    if(env.ENVIRONMENT==='dev'&&resource==='/checkouts'&&
      Array.isArray(body?.billingTypes)&&body.billingTypes.includes('PIX')){
      let issues:unknown;
      try{issues=(await response.clone().json() as {errors?:unknown}).errors;}catch{/* ignore malformed provider body */}
      const allowedFields=['billingTypes','chargeTypes','callback','items','customer','customerData','subscription','externalReference','minutesToExpire','pix','chave','habilitad'];
      const validations=Array.isArray(issues)?issues.slice(0,4).map(item=>{
        const issue=item&&typeof item==='object'?item as Record<string,unknown>:{};
        const code=['invalid_object','invalid_action','invalid_value','invalid_billing_type'].includes(String(issue.code))?
          String(issue.code):'unknown';
        const description=typeof issue.description==='string'?issue.description.toLowerCase():'';
        return {code,fields:allowedFields.filter(field=>description.includes(field.toLowerCase())),
          ...(/criar uma chave pix/.test(description)?{reason:'pix_account_key_required'}:{})};
      }):[];
      console.warn(JSON.stringify({
        event:'billing_pix_checkout_rejected',
        status:response.status,
        validations,
      }));
    }
    throw new AsaasError(response.status);
  }
  let data:unknown;
  try{data=await response.json();}catch{throw new ApiError(502,'billing_provider_invalid_response');}
  if(!data||typeof data!=='object'||Array.isArray(data))
    throw new ApiError(502,'billing_provider_invalid_response');
  return data as T;
}
