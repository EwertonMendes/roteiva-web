import type {BillingPlanCode} from './billing-catalog.ts';

const months:Record<BillingPlanCode,number>={monthly:1,quarterly:3,yearly:12};

export function civilDate(value:unknown):string|null{
  if(typeof value!=='string'||!/^20\d\d-\d\d-\d\d$/.test(value))return null;
  const ms=Date.parse(value+'T00:00:00Z');
  return Number.isFinite(ms)&&new Date(ms).toISOString().slice(0,10)===value?value:null;
}

export function billingDateInstant(date:string):number{
  return Date.parse(date+'T00:00:00-03:00');
}

/** Anchor to the original provider due date, including after a delayed payment. */
export function periodEnd(dueOn:string,plan:BillingPlanCode):number{
  const [year,month,day]=dueOn.split('-').map(Number);
  const lastDay=new Date(Date.UTC(year,month+months[plan],0)).getUTCDate();
  const boundary=new Date(Date.UTC(year,month-1+months[plan],Math.min(day,lastDay)));
  return billingDateInstant(boundary.toISOString().slice(0,10));
}

export function cents(value:unknown):number|null{
  if(typeof value!=='number'||!Number.isFinite(value)||value<=0)return null;
  const rounded=Math.round(value*100);
  return Number.isSafeInteger(rounded)&&rounded/100===value?rounded:null;
}
