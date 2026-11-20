import {asaasRequest} from './billing-asaas.ts';
import {cents} from './billing-period.ts';
import {ApiError,type Env} from './types.ts';

function completedTotal(value:unknown,amount:number):number|null{
  if(!Array.isArray(value))return null;
  let total=0;
  for(const entry of value){
    if(!entry||typeof entry!=='object'||typeof entry.status!=='string')return null;
    if(entry.status!=='DONE')continue;
    const part=cents(entry.value);
    if(!part||part>amount-total)return null;
    total+=part;
  }
  return total;
}

/** Only authoritative provider reads count. Earlier verified completed refunds never roll back. */
export async function refundedSoFar(env:Env,payment:Record<string,unknown>,ref:string,amount:number,recorded:number,eventType?:string):Promise<number>{
  if(payment.status==='REFUNDED')return amount;
  const partial=eventType==='PAYMENT_PARTIALLY_REFUNDED'||payment.status==='PARTIALLY_REFUNDED';
  const embedded=completedTotal(payment.refunds,amount);
  if(!partial&&payment.refunds==null)return recorded;
  if(!partial&&embedded!==null)return Math.max(recorded,embedded);
  if(embedded&&embedded>recorded)return embedded;
  const refunds=await asaasRequest(env,'GET',`/payments/${ref}/refunds`);
  const total=refunds.hasMore!==true?completedTotal(refunds.data??refunds.refunds,amount):null;
  if(total===null||(partial&&total===0&&recorded===0))throw new ApiError(503,'billing_refund_not_verified');
  return Math.max(recorded,total);
}
