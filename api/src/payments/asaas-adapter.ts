import {asaasRequest,providerRef} from '../billing-asaas.ts';
import {buildDetachedPixCheckout,buildRecurringCardCheckout} from '../billing-checkout-contract.ts';
import {cents} from '../billing-period.ts';
import {ApiError,type Env} from '../types.ts';
import type {GatewayPayment,GatewayPaymentStatus,PaymentGateway,PaymentMethod} from './provider.ts';

function payment(record:Record<string,unknown>):GatewayPayment {
  const id=providerRef(record.id);
  if(!id)throw new ApiError(502,'billing_provider_invalid_response');
  const method:PaymentMethod|null=record.billingType==='PIX'||record.billingType==='CREDIT_CARD'?record.billingType:null;
  const states:Record<string,GatewayPaymentStatus>={
    PENDING:'PENDING',CONFIRMED:'CONFIRMED',RECEIVED:'RECEIVED',REFUNDED:'REFUNDED',
  };
  return {
    id,checkoutRef:providerRef(record.checkoutSession),
    subscriptionRef:providerRef(record.subscription),customerRef:providerRef(record.customer),
    method,amountCents:cents(record.value),
    status:states[String(record.status)]??'OTHER',raw:record
  };
}

const hostedOrigin=(env:Env)=>env.ENVIRONMENT==='prod'?'https://asaas.com':'https://sandbox.asaas.com';
const sameHostedEnvironment=(expected:string,actual:string)=>actual===expected||
  expected==='https://asaas.com'&&actual==='https://www.asaas.com';

function hostedCheckout(origin:string,id:string,link?:unknown):URL {
  if(!providerRef(id))throw new ApiError(502,'billing_provider_invalid_response');
  if(link===undefined||link===null)return new URL(origin+(origin==='https://sandbox.asaas.com'?
    '/000/checkoutSession/show/'+id:'/checkoutSession/show?id='+id));
  const url=typeof link==='string'?URL.parse(link):null;
  if(url&&sameHostedEnvironment(origin,url.origin)&&!url.username&&!url.password&&!url.hash&&
    ((['/checkoutSession/show/'+id,'/000/checkoutSession/show/'+id].includes(url.pathname)&&!url.search)||
     (url.pathname==='/checkoutSession/show'&&url.search==='?id='+id)))return url;
  throw new ApiError(502,'billing_provider_invalid_response');
}

function hostedInvoice(origin:string,link:unknown):string|null {
  const url=typeof link==='string'?URL.parse(link):null;
  return url&&sameHostedEnvironment(origin,url.origin)&&!url.username&&!url.password&&!url.search&&!url.hash&&
    /^\/i\/[A-Za-z0-9_-]{1,120}$/.test(url.pathname)?url.pathname:null;
}

/** Translate checkout commands and allowlist hosted redirects at the provider boundary. */
export function asaasGateway(env:Env):PaymentGateway {
  const origin=hostedOrigin(env);
  const invoiceOrigin=env.ENVIRONMENT==='prod'?'https://www.asaas.com':origin;
  return {
    code:'asaas',
    prepareCheckout(input) {
      const payload=input.method==='PIX'?buildDetachedPixCheckout(env,input):buildRecurringCardCheckout(env,input);
      return async()=>{
        const response=await asaasRequest(env,'POST','/checkouts',{
          ...payload,...(input.customerRef?{customer:input.customerRef}:{}),
        });
        const id=providerRef(response.id);
        if(!id)throw new ApiError(502,'billing_provider_invalid_response');
        return {id,link:response.link};
      };
    },
    checkoutPath(id,link) {
      const url=hostedCheckout(origin,id,link);
      return url.pathname+url.search;
    },
    checkoutUrl(id,path) { return hostedCheckout(origin,id,path?origin+path:undefined).href; },
    invoicePath(link) { return hostedInvoice(origin,link); },
    invoiceUrl(path) { return path&&hostedInvoice(origin,invoiceOrigin+path)?invoiceOrigin+path:null; },
    async cancelCheckout(id) {
      const response=await asaasRequest(env,'POST',`/checkouts/${id}/cancel`);
      return response.id===id&&response.status==='CANCELED'?'canceled':'unconfirmed';
    },
    async listCheckoutPayments(id) {
      const response=await asaasRequest(env,'GET',`/payments?checkoutSession=${id}&limit=2`);
      if(!Array.isArray(response.data)||response.hasMore!==false||response.data.length>1)
        throw new ApiError(503,'billing_checkout_payment_review');
      return response.data.map(item=>{
        if(!item||typeof item!=='object'||Array.isArray(item))
          throw new ApiError(502,'billing_provider_invalid_response');
        return payment(item as Record<string,unknown>);
      });
    },
    async payment(id) { return payment(await asaasRequest(env,'GET',`/payments/${id}`)); }
  };
}

/** Single composition root. Other providers plug in here, never into domain logic. */
export function paymentGateway(env:Env):PaymentGateway {
  return asaasGateway(env);
}
