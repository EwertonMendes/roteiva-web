import {asaasRequest,providerRef} from '../billing-asaas.ts';
import {cents} from '../billing-period.ts';
import {ApiError,type Env} from '../types.ts';
import type {GatewayPayment,GatewayPaymentStatus,PaymentGateway,PaymentMethod} from './provider.ts';

function payment(record:Record<string,unknown>):GatewayPayment {
  const id=providerRef(record.id);
  if(!id)throw new ApiError(502,'billing_provider_invalid_response');
  const method:PaymentMethod=record.billingType==='PIX'?'PIX':'CREDIT_CARD';
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

/** Only adapter knows Asaas URLs/response field names. */
export function asaasGateway(env:Env):PaymentGateway {
  return {
    code:'asaas',
    async createCheckout(payload) {
      const response=await asaasRequest(env,'POST','/checkouts',payload);
      const id=providerRef(response.id);
      if(!id)throw new ApiError(502,'billing_provider_invalid_response');
      return {id,link:response.link};
    },
    async cancelCheckout(id) {
      const response=await asaasRequest(env,'POST',`/checkouts/${id}/cancel`);
      return response.id===id&&response.status==='CANCELED'?'canceled':'unconfirmed';
    },
    async checkoutState(id) {
      const response=await asaasRequest(env,'GET',`/checkouts/${id}`);
      return response.id===id&&['ACTIVE','PAID','CANCELED','EXPIRED'].includes(String(response.status))
        ?response.status as 'ACTIVE'|'PAID'|'CANCELED'|'EXPIRED':'UNKNOWN';
    },
    async listCheckoutPayments(id) {
      const response=await asaasRequest(env,'GET',`/payments?checkoutSession=${id}&limit=2`);
      if(!Array.isArray(response.data)||response.hasMore===true||response.data.length>1)
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
