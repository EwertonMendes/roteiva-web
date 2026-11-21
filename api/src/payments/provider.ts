import type {BillingPlanCode} from '../billing-catalog.ts';

/**
 * Provider-neutral contract for financial orchestration. The Roteiva domain
 * never accepts a browser redirect or a webhook payload as proof of payment.
 * Gateway payment IDs and metadata are immutable external references.
 */
export type PaymentMethod='CREDIT_CARD'|'PIX';
export type RenewalMode='automatic'|'manual';
export type GatewayPaymentStatus='PENDING'|'CONFIRMED'|'RECEIVED'|'REFUNDED'|'OTHER';
export type GatewayPayment={
  id:string;checkoutRef:string|null;customerRef:string|null;
  subscriptionRef:string|null;method:PaymentMethod|null;
  amountCents:number|null;status:GatewayPaymentStatus;raw:Readonly<Record<string,unknown>>;
};
export type CheckoutRequest=Readonly<{
  planCode:BillingPlanCode;pricingVersion:string;intentId:string;nextDueDate:string;
  method:PaymentMethod;customerRef?:string;
}>;
export interface PaymentGateway {
  readonly code:string;
  /** Validate input before persisting the pending intent, submit only after the fence exists. */
  prepareCheckout(input:CheckoutRequest):()=>Promise<{id:string;link?:unknown}>;
  checkoutPath(id:string,link?:unknown):string;
  checkoutUrl(id:string,path?:string|null):string;
  invoicePath(link:unknown):string|null;
  invoiceUrl(path:string|null):string|null;
  cancelCheckout(id:string):Promise<'canceled'|'unconfirmed'>;
  listCheckoutPayments(id:string):Promise<readonly GatewayPayment[]>;
  payment(id:string):Promise<GatewayPayment>;
}
