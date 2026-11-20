
import {API_BASE_URL,appEnvironment} from "../../lib/environment";
import {firebaseServices} from "../../lib/firebase";

export type PlanCode = "monthly" | "quarterly" | "yearly";
export type Plan = {code:PlanCode;amountCents:number;version:string};
export type Payment = {state:string;amountCents:number;dueOn:string|null;invoiceUrl:string|null};
export type PaymentPage = {payments:Payment[];nextPaymentCursor?:string|null};
export type Subscription = {
  planCode:PlanCode;
  status:string;
  paidUntil:string|null;
  nextDueOn:string|null;
  amountCents:number|null;
  paymentMethod:string|null;
  canCancel:boolean;
  cancellation:"pending"|"review"|null;
};
export type BillingStatus = PaymentPage & {
  checkoutAvailable:boolean;
  canStart:boolean;
  notice:{code:string}|null;
  checkout:{planCode:PlanCode;status:"ready"|"pending";url:string|null}|null;
  subscription:Subscription|null;
};
export const planNames:Record<PlanCode,string> = {monthly:"Mensal",quarterly:"Trimestral",yearly:"Anual"};
export const cadence:Record<PlanCode,string> = {monthly:"por mês",quarterly:"a cada 3 meses",yearly:"por ano"};
export const billingInThisBuild = appEnvironment.appEnv==="dev" || appEnvironment.appEnv==="emulator";
const currency = new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"});
const dateFormat = new Intl.DateTimeFormat("pt-BR",{timeZone:"America/Sao_Paulo",dateStyle:"medium"});
export const money = (cents:number) => currency.format(cents/100);
export function billingDate(value:string|Date) {
  const date = value instanceof Date ? value : new Date(value.length===10 ? value+"T12:00:00-03:00" : value);
  return Number.isFinite(date.getTime()) ? dateFormat.format(date) : "Data indisponível";
}

export async function billingRequest<T>(path:string,uid:string,body?:object,signal?:AbortSignal):Promise<T> {
  const {auth} = firebaseServices();
  const user = auth.currentUser;
  if(user?.uid!==uid) throw Error("Entre novamente para consultar sua assinatura.");
  const token = await user.getIdToken();
  if(auth.currentUser?.uid!==uid) throw Error("Sua sessão mudou. Entre novamente.");
  const response = await fetch(API_BASE_URL+path,{
    method:body?"POST":"GET",cache:"no-store",
    headers:{Authorization:"Bearer "+token,...(body?{"Content-Type":"application/json"}:{})},
    body:body?JSON.stringify(body):undefined,
    signal:signal?AbortSignal.any([signal,AbortSignal.timeout(18000)]):AbortSignal.timeout(18000),
  });
  if(!response.ok) throw Error("A área de assinatura está temporariamente indisponível. Tente novamente.");
  const data = await response.json() as T;
  if(auth.currentUser?.uid!==uid) throw Error("Sua sessão mudou. Entre novamente.");
  return data;
}

export function sandboxLink(value:string|null|undefined,kind:"checkout"|"invoice"):string|undefined {
  const url = value?URL.parse(value):null;
  if(url?.origin!=="https://sandbox.asaas.com"||url.username||url.password||url.hash) return;
  if(kind==="invoice"&&/^\/i\/[A-Za-z0-9_-]+$/.test(url.pathname)&&!url.search) return url.href;
  if(kind==="checkout"&&(
    /^(?:\/000)?\/checkoutSession\/show\/[A-Za-z0-9_-]+$/.test(url.pathname)&&!url.search||
    url.pathname==="/checkoutSession/show"&&/^\?id=[A-Za-z0-9_-]+$/.test(url.search)
  )) return url.href;
}
