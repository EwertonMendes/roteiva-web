/**
 * Provider-neutral contract for financial orchestration. The Roteiva domain
 * never accepts a browser redirect or a webhook payload as proof of payment.
 * Gateway payment IDs and metadata are immutable external references.
 */
export type PaymentMethod='CREDIT_CARD'|'PIX';
export type RenewalMode='automatic'|'manual';
export type GatewayCheckoutState='ACTIVE'|'PAID'|'CANCELED'|'EXPIRED'|'UNKNOWN';
export type GatewayPaymentStatus='PENDING'|'CONFIRMED'|'RECEIVED'|'REFUNDED'|'OTHER';
export type GatewayPayment={
  id:string;checkoutRef:string|null;customerRef:string|null;
  subscriptionRef:string|null;method:PaymentMethod;
  amountCents:number|null;status:GatewayPaymentStatus;raw:Readonly<Record<string,unknown>>;
};
export interface PaymentGateway {
  readonly code:string;
  createCheckout(payload:Record<string,unknown>):Promise<{id:string;link?:unknown}>;
  cancelCheckout(id:string):Promise<'canceled'|'unconfirmed'>;
  checkoutState(id:string):Promise<GatewayCheckoutState>;
  listCheckoutPayments(id:string):Promise<readonly GatewayPayment[]>;
  payment(id:string):Promise<GatewayPayment>;
}
