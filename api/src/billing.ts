import {billingCatalog} from './billing-catalog.ts';

/** Read-only preview; a configured key never implies checkouts are implemented. */
export function billingPlansResponse():Response{
  return Response.json({
    checkoutAvailable:false,
    currency:'BRL',
    plans:billingCatalog(),
  });
}
