import {trustedCheckoutPrice,TEST_BILLING_VERSION,type BillingPlanCode} from './billing-catalog.ts';
import {ApiError,type Env} from './types.ts';
import {environment} from '../../shared/environments.ts';

type CheckoutEnv=Pick<Env,'ENVIRONMENT'|'FRONTEND_ORIGIN'>;
type CheckoutInput={planCode:BillingPlanCode;pricingVersion?:string;intentId:string;nextDueDate:string};

const labels:Record<BillingPlanCode,string>={
  monthly:'Mensal',quarterly:'Trimestral',yearly:'Anual'
};
/** Strict calendar validation without treating an Asaas local datetime as UTC. */
function checkLocalDueDate(value:string):void{
  if(!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value))
    throw new ApiError(400,'billing_invalid_first_due_date');
  const [date,time]=value.split(' ');
  const [year,month,day]=date.split('-').map(Number);
  const [hour,minute,second]=time.split(':').map(Number);
  const parsed=new Date(Date.UTC(year,month-1,day,hour,minute,second));
  if(year<2026||year>2100||parsed.getUTCFullYear()!==year||
    parsed.getUTCMonth()!==month-1||parsed.getUTCDate()!==day||
    parsed.getUTCHours()!==hour||parsed.getUTCMinutes()!==minute||parsed.getUTCSeconds()!==second)
    throw new ApiError(400,'billing_invalid_first_due_date');
}
/**
 * Pure request builder for Asaas /v3/checkouts (no I/O or customer/card data).
 * This must receive a trusted first-charge date calculated by the server.
 * The environment's checkout gate controls when offers can be created.
 */
export function buildRecurringCardCheckout(env:CheckoutEnv,input:CheckoutInput){
  const plan=trustedCheckoutPrice(input.planCode,input.pricingVersion);
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.intentId))
    throw new ApiError(400,'billing_invalid_intent');
  checkLocalDueDate(input.nextDueDate);
  let origin:string;
  try{
    const config=environment(env.ENVIRONMENT);
    if(config.frontendOrigin!==env.FRONTEND_ORIGIN)throw Error('wrong origin');
    origin=config.frontendOrigin;
  }catch{throw new ApiError(503,'billing_invalid_environment');}
  return {
    billingTypes:['CREDIT_CARD'],
    chargeTypes:['RECURRENT'],
    externalReference:input.intentId,
    minutesToExpire:30,
    callback:{
      // The opaque intent ID routes the browser to its own existing checkout.
      // Neither the URL nor a success callback is evidence of a paid charge.
      cancelUrl:origin+'/?billing=cancelled&intent='+input.intentId,
      expiredUrl:origin+'/?billing=expired&intent='+input.intentId,
      successUrl:origin+'/?billing=return&intent='+input.intentId
    },
    items:[{
      name:plan.version===TEST_BILLING_VERSION?'Roteiva Teste (temporario)':'Roteiva '+labels[plan.code],
      description:'Acesso completo ao Roteiva — plano '+labels[plan.code].toLowerCase(),
      quantity:1,
      value:plan.amountCents/100
    }],
    subscription:{cycle:plan.cycle,nextDueDate:input.nextDueDate}
  };
}


/**
 * Manual one-period purchase. This intentionally contains NO subscription
 * object: a Pix payment must never create automatic renewals.
 */
export function buildDetachedPixCheckout(env:CheckoutEnv,input:CheckoutInput){
  const plan=trustedCheckoutPrice(input.planCode,input.pricingVersion);
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.intentId))
    throw new ApiError(400,'billing_invalid_intent');
  let origin:string;
  try{
    const config=environment(env.ENVIRONMENT);
    if(config.frontendOrigin!==env.FRONTEND_ORIGIN)throw Error('wrong origin');
    origin=config.frontendOrigin;
  }catch{throw new ApiError(503,'billing_invalid_environment');}
  return {
    billingTypes:['PIX'],chargeTypes:['DETACHED'],
    externalReference:input.intentId,minutesToExpire:30,
    callback:{
      cancelUrl:origin+'/?billing=cancelled&intent='+input.intentId,
      expiredUrl:origin+'/?billing=expired&intent='+input.intentId,
      successUrl:origin+'/?billing=return&intent='+input.intentId
    },
    items:[{
      name:plan.version===TEST_BILLING_VERSION?'Roteiva Teste (Pix manual)':'Roteiva '+labels[plan.code]+' (Pix manual)',
      description:'Um período de acesso ao Roteiva, sem renovação automática',
      quantity:1,value:plan.amountCents/100
    }]
  };
}
