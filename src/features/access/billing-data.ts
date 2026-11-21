
import {API_BASE_URL,appEnvironment} from "../../lib/environment";
import {firebaseServices} from "../../lib/firebase";

export type PlanCode = "monthly" | "quarterly" | "yearly";
export type CheckoutReturn="verifying"|"closed"|"not_found";
export type PaymentMethod="CREDIT_CARD"|"PIX";
export type Plan = {code:PlanCode;amountCents:number;version:string};
export type UpgradeOffer = {effectiveOn:string;plans:PlanCode[]};
export type ScheduledUpgrade = {planCode:PlanCode;amountCents:number;effectiveOn:string;status:"pending"|"scheduled"|"review"};
export type Payment = {state:string;amountCents:number;refundedAmountCents?:number;dueOn:string|null;invoiceUrl:string|null;paymentMethod?:PaymentMethod};
export type PaymentPage = {payments:Payment[];nextPaymentCursor?:string|null};
export type Subscription = {
  planCode:PlanCode;
  status:string;
  paidUntil:string|null;
  nextDueOn:string|null;
  amountCents:number|null;
  paymentMethod:PaymentMethod|null;
  renewalMode?:"automatic"|"manual";
  canCancel:boolean;
  cancellation:"pending"|"review"|null;
  upgradeOffer?:UpgradeOffer|null;
  upgrade?:ScheduledUpgrade|null;
};
export type BillingStatus = PaymentPage & {
  checkoutAvailable:boolean;
  cardAvailable:boolean;
  pixAvailable:boolean;
  canRenewWithPix:boolean;
  canStart:boolean;
  notice:{code:string}|null;
  checkout:{intentId:string;planCode:PlanCode;paymentMethod:PaymentMethod;status:"ready"|"pending"|"closing"|"payment_pending"|"review";url:string|null;canCancel?:boolean}|null;
  subscription:Subscription|null;
};
export const planNames:Record<PlanCode,string> = {monthly:"Mensal",quarterly:"Trimestral",yearly:"Anual"};
export const cadence:Record<PlanCode,string> = {monthly:"por mês",quarterly:"a cada 3 meses",yearly:"por ano"};
export const productionBilling = appEnvironment.appEnv==="prod";
export const billingInThisBuild = appEnvironment.appEnv==="dev" || appEnvironment.appEnv==="emulator" ||
  productionBilling && import.meta.env.VITE_PRODUCTION_BILLING_ENABLED==="true";
const currency = new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"});
const dateFormat = new Intl.DateTimeFormat("pt-BR",{timeZone:"America/Sao_Paulo",dateStyle:"medium"});
export const money = (cents:number) => currency.format(cents/100);
export function billingDate(value:string|Date) {
  const date = value instanceof Date ? value : new Date(value.length===10 ? value+"T12:00:00-03:00" : value);
  return Number.isFinite(date.getTime()) ? dateFormat.format(date) : "Data indisponível";
}

const upgradeErrors:Record<string,string> = {
  billing_catalog_changed:"Os valores mudaram. Atualize a assinatura para comparar os planos novamente.",
  billing_upgrade_terms_changed:"A data da renovação mudou. Atualize a assinatura para conferir a nova data.",
  billing_upgrade_invoice_conflict:"Há uma fatura que precisa ser conferida antes da mudança. Consulte o histórico ou fale com o suporte.",
  billing_upgrade_provider_rejected:"Não foi possível atualizar a renovação no cartão. Fale com o suporte para verificar a assinatura.",
  billing_upgrade_in_progress:"Já existe uma mudança em andamento. Atualize a assinatura para acompanhar.",
  billing_upgrade_unavailable:"A assinatura não está elegível para essa mudança. Atualize a assinatura para conferir a situação.",
  billing_checkout_already_open:"Já existe um checkout para outro plano ou forma de pagamento. Retorne e escolha Trocar plano.",
  billing_checkout_not_switchable:"A tentativa anterior está sendo verificada. Confira o pagamento antes de trocar.",
  billing_checkout_payment_verifying:"Pode existir um pagamento dessa tentativa. Não faça outra compra; verifique o histórico e tente novamente.",
  billing_checkout_cancel_unconfirmed:"O cancelamento da tentativa não foi confirmado. Por segurança, o pagamento anterior continua protegido; verifique novamente.",
  billing_access_still_active:"Você já possui acesso pago. Para mudar a forma de pagamento, verifique a renovação atual primeiro.",
  billing_account_ineligible:"Esta conta não pode iniciar outra contratação neste momento. Atualize sua assinatura.",
  billing_pix_checkout_rejected:"O Pix não pôde ser iniciado no ambiente de testes. Nenhuma cobrança foi criada. Você pode voltar e escolher cartão de crédito.",
  billing_provider_unavailable:"Não foi possível confirmar a solicitação de pagamento. Atualize a assinatura antes de tentar novamente, para evitar cobranças duplicadas.",
};

export async function billingRequest<T>(path:string,uid:string,body?:object,signal?:AbortSignal):Promise<T> {
  const {auth} = firebaseServices();
  const user = auth.currentUser;
  if(user?.uid!==uid) throw Error("Entre novamente para consultar sua assinatura.");
  const token = await user.getIdToken();
  if(auth.currentUser?.uid!==uid) throw Error("Sua sessão mudou. Entre novamente.");
  const timeout = AbortSignal.timeout(path==="/billing/upgrade"?60000:18000);
  const response = await fetch(API_BASE_URL+path,{
    method:body?"POST":"GET",cache:"no-store",
    headers:{Authorization:"Bearer "+token,...(body?{"Content-Type":"application/json"}:{})},
    body:body?JSON.stringify(body):undefined,
    signal:signal?AbortSignal.any([signal,timeout]):timeout,
  });
  if(!response.ok) {
    if(path.startsWith("/billing/")){
      const failure=await response.json().catch(()=>null) as {error?:{code?:string}}|null;
      const message=upgradeErrors[failure?.error?.code??""];
      if(message)throw Error(message);
    }
    throw Error("A área de assinatura está temporariamente indisponível. Tente novamente.");
  }
  const data = await response.json() as T;
  if(auth.currentUser?.uid!==uid) throw Error("Sua sessão mudou. Entre novamente.");
  return data;
}

export function hostedPaymentLink(value:string|null|undefined,kind:"checkout"|"invoice"):string|undefined {
  const url = value?URL.parse(value):null;
  const origins=productionBilling?["https://asaas.com","https://www.asaas.com"]:["https://sandbox.asaas.com"];
  if(!url||!origins.includes(url.origin)||url.username||url.password||url.hash) return;
  if(kind==="invoice"&&/^\/i\/[A-Za-z0-9_-]+$/.test(url.pathname)&&!url.search) return url.href;
  if(kind==="checkout"&&(
    /^(?:\/000)?\/checkoutSession\/show\/[A-Za-z0-9_-]+$/.test(url.pathname)&&!url.search||
    url.pathname==="/checkoutSession/show"&&/^\?id=[A-Za-z0-9_-]+$/.test(url.search)
  )) return url.href;
}
