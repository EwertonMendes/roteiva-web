import {ApiError,type Env} from './types.ts';

/** Private integration boundary. No call sites create live checkouts in this phase. */
export type AsaasResource='/customers'|'/checkouts'|'/subscriptions';
export type AsaasMethod='GET'|'POST';

/** An incomplete or disabled billing setup must not affect any other route. */
export function asaasConfigured(env:Env):boolean{
  return env.BILLING_ENABLED==='true' &&
    (env.ENVIRONMENT==='dev'||env.ENVIRONMENT==='prod') &&
    typeof env.ASAAS_API_KEY==='string' && env.ASAAS_API_KEY.length>=16 &&
    typeof env.ASAAS_WEBHOOK_TOKEN==='string' && env.ASAAS_WEBHOOK_TOKEN.length>=32;
}
function baseUrl(env:Env):string{
  if(env.ENVIRONMENT==='dev')return 'https://api-sandbox.asaas.com/v3';
  if(env.ENVIRONMENT==='prod')return 'https://api.asaas.com/v3';
  throw new ApiError(503,'billing_invalid_environment');
}

/** Request shape is server-owned. No user-provided URL, account or price. */
export async function asaasRequest<T extends Record<string,unknown>>(
  env:Env,method:AsaasMethod,resource:AsaasResource,body?:Record<string,unknown>,
  transport:typeof fetch=fetch
):Promise<T>{
  if(!asaasConfigured(env))throw new ApiError(503,'billing_unavailable');
  if(!(['/customers','/checkouts','/subscriptions'] as string[]).includes(resource) ||
    !(['GET','POST'] as string[]).includes(method) || (method==='GET'&&body!==undefined))
    throw new ApiError(400,'billing_invalid_request');
  const url=baseUrl(env)+resource;
  let response:Response;
  try{
    response=await transport(url,{
      method,redirect:'manual',headers:{
        access_token:env.ASAAS_API_KEY!,
        Accept:'application/json','Content-Type':'application/json',
        'User-Agent':'Roteiva/1.0'
      }, ...(body===undefined?{}:{body:JSON.stringify(body)}),
      signal:AbortSignal.timeout(10000),
    });
  }catch{throw new ApiError(503,'billing_provider_unavailable');}
  // A network timeout after POST has an unknown result: NEVER retry blindly.
  if(!response.ok)throw new ApiError(502,'billing_provider_unavailable');
  let data:unknown;
  try{data=await response.json();}catch{throw new ApiError(502,'billing_provider_invalid_response');}
  if(!data||typeof data!=='object'||Array.isArray(data))
    throw new ApiError(502,'billing_provider_invalid_response');
  return data as T;
}
