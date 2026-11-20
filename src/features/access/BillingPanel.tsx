import {useEffect,useState} from "react";
import {API_BASE_URL,appEnvironment} from "../../lib/environment";
import {firebaseServices} from "../../lib/firebase";
import {useAuth} from "../auth/AuthProvider";
import {AppButton} from "../ui/AppButton";
import {AppInput} from "../ui/AppInput";
import "./billing.css";

type PlanCode="monthly"|"quarterly"|"yearly";
type Plan={code:PlanCode;amountCents:number;version:string};
type BillingStatus={
  checkoutAvailable:boolean;canStart:boolean;
  access:{active:boolean}|null;
  notice:{code:string;daysRemaining:number|null}|null;
  checkout:{planCode:PlanCode;status:"ready"|"pending";url:string|null}|null;
  subscription:{planCode:PlanCode;status:string;paidUntil:string|null;nextDueOn:string|null;
    amountCents:number|null;paymentMethod:string|null;canCancel:boolean;cancellation:"pending"|"review"|null}|null;
  payments:{state:string;amountCents:number;dueOn:string|null;invoiceUrl:string|null}[];
};
const plans:Record<PlanCode,string>={monthly:"Mensal",quarterly:"Trimestral",yearly:"Anual"};
const frequency:Record<PlanCode,string>={monthly:"por mês",quarterly:"a cada 3 meses",yearly:"por ano"};
const labels:Record<string,string>={
  active:"Renovação ativa",past_due:"Em atraso",canceled:"Renovação cancelada",expired:"Expirada",
  pending:"Pendente",overdue:"Vencida",confirmed:"Confirmada",received:"Recebida",refused:"Cartão recusado",
  refunded:"Estornada",chargeback:"Contestada",review:"Em análise",
};
const notices:Record<string,string>={
  trial_ending:"Seu teste gratuito está perto de terminar.",
  complimentary_ending:"Seu acesso de cortesia está perto de terminar.",
  subscription_renewal_soon:"Sua assinatura está perto da renovação.",
  canceled_until:"A renovação foi cancelada. Seu acesso termina na data indicada.",
  payment_grace:"Seu acesso está no período de tolerância. Regularize a cobrança pendente.",
};
const currency=new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"});
const dateFormat=new Intl.DateTimeFormat("pt-BR",{timeZone:"America/Sao_Paulo",dateStyle:"medium"});
const money=(cents:number)=>currency.format(cents/100);
const dateLabel=(date:string)=>dateFormat.format(new Date(date.length===10?date+"T12:00:00-03:00":date));
export const billingInThisBuild=appEnvironment.appEnv==="dev"||appEnvironment.appEnv==="emulator";

async function call<T>(path:string,uid:string,body?:object,signal?:AbortSignal):Promise<T>{
  const {auth}=firebaseServices();
  const user=auth.currentUser;
  if(user?.uid!==uid)throw Error("Entre novamente para consultar sua assinatura.");
  const token=await user.getIdToken();
  if(auth.currentUser?.uid!==uid)throw Error("Sua sessão mudou. Entre novamente.");
  const response=await fetch(API_BASE_URL+path,{method:body?"POST":"GET",cache:"no-store",
    headers:{Authorization:"Bearer "+token,...(body?{"Content-Type":"application/json"}:{})},
    body:body?JSON.stringify(body):undefined,signal:signal??AbortSignal.timeout(18000)});
  if(!response.ok)throw Error("A área de assinatura está temporariamente indisponível. Tente novamente.");
  const data=await response.json() as T;
  if(auth.currentUser?.uid!==uid)throw Error("Sua sessão mudou. Entre novamente.");
  return data;
}

function sandboxLink(value:string|null|undefined,kind:"checkout"|"invoice"):string|undefined{
  const url=value?URL.parse(value):null;
  if(url?.origin!=="https://sandbox.asaas.com"||url.username||url.password||url.hash)return;
  if(kind==="invoice"&&/^\/i\/[A-Za-z0-9_-]+$/.test(url.pathname)&&!url.search)return url.href;
  if(kind==="checkout"&&(
    /^\/checkoutSession\/show\/[A-Za-z0-9_-]+$/.test(url.pathname)&&!url.search||
    url.pathname==="/checkoutSession/show"&&/^\?id=[A-Za-z0-9_-]+$/.test(url.search)
  ))return url.href;
}

export function BillingPanel({locked=false,refreshKey}:{locked?:boolean;refreshKey?:number}){
  const {user}=useAuth();
  const uid=user?.uid;
  const [status,setStatus]=useState<BillingStatus|null>(null);
  const [catalog,setCatalog]=useState<Plan[]>([]);
  const [attempt,setAttempt]=useState(0);
  const [selected,setSelected]=useState<Plan|null>(null);
  const [accepted,setAccepted]=useState(false);
  const [canceling,setCanceling]=useState(false);
  const [working,setWorking]=useState(false);
  const [error,setError]=useState("");
  const [message,setMessage]=useState("");
  const callback=new URLSearchParams(window.location.search).get("billing");
  useEffect(()=>{
    if(!uid||!billingInThisBuild)return;
    const controller=new AbortController();
    const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(18000)]);
    setError("");
    void call<BillingStatus>("/billing/status",uid,undefined,signal).then(async data=>{
      if(signal.aborted)return;
      setStatus(data);
      if(data.canStart){
        const result=await call<{plans:Plan[]}>("/billing/plans",uid,undefined,signal);
        if(!signal.aborted)setCatalog(result.plans);
      }
    }).catch(()=>{if(!controller.signal.aborted)setError("Não foi possível consultar sua assinatura.");});
    return ()=>controller.abort();
  },[uid,attempt,refreshKey]);

  if(!uid||!billingInThisBuild)return null;
  const account=uid;
  const subscription=status?.subscription;
  const checkoutUrl=sandboxLink(status?.checkout?.url,"checkout");

  async function confirmCheckout(){
    if(!selected||!accepted||working)return;
    setWorking(true);setError("");setMessage("");
    try{
      const result=await call<{url?:string;status:string}>("/billing/checkout",account,{
        planCode:selected.code,catalogVersion:selected.version,acceptedImmediateCharge:true,
      });
      const url=sandboxLink(result.url,"checkout");
      if(url){window.location.assign(url);return;}
      setMessage("Estamos verificando a criação do checkout. Atualize a consulta antes de tentar novamente.");
      setSelected(null);setAttempt(value=>value+1);
    }catch(reason){setError(reason instanceof Error?reason.message:"Não foi possível abrir o checkout.");}
    finally{setWorking(false);}
  }
  async function cancelRenewal(){
    setWorking(true);setError("");setMessage("");
    try{
      const result=await call<{status:string}>("/billing/cancel",account,{confirmed:true});
      if(result.status==="canceled")setMessage("Renovação cancelada. Seu período pago continua disponível até o vencimento.");
      setCanceling(false);setAttempt(value=>value+1);
    }catch(reason){setError(reason instanceof Error?reason.message:"Não foi possível cancelar a renovação.");}
    finally{setWorking(false);}
  }

  return <section className={locked?"billing-panel billing-panel--locked":"settings-editor billing-panel"} aria-labelledby="billing-title">
    <h3 id="billing-title">Assinatura</h3>
    {callback==="return"&&locked&&<p role="status">Estamos confirmando seu pagamento.</p>}
    {status?.notice&&notices[status.notice.code]&&<p>{notices[status.notice.code]}</p>}
    {callback==="cancelled"&&<p>A jornada de checkout foi interrompida. Confira a situação abaixo.</p>}
    {callback==="expired"&&<p>O prazo do checkout terminou. Confira a situação abaixo.</p>}
    {error&&<p role="alert">{error}</p>}
    {message&&<p role="status">{message}</p>}
    {!status&&!error&&<p role="status">Consultando assinatura…</p>}
    {subscription&&<>
      <dl className="billing-summary">
        <div><dt>Plano</dt><dd>{plans[subscription.planCode]}</dd></div>
        <div><dt>Situação</dt><dd>{labels[subscription.status]??"Em análise"}</dd></div>
        {subscription.amountCents!==null&&<div><dt>Preço contratado</dt><dd>{money(subscription.amountCents)} {frequency[subscription.planCode]}</dd></div>}
        {subscription.paymentMethod==="CREDIT_CARD"&&<div><dt>Forma de pagamento</dt><dd>Cartão de crédito</dd></div>}
        {subscription.nextDueOn&&<div><dt>Próxima cobrança</dt><dd>{dateLabel(subscription.nextDueOn)}</dd></div>}
        {subscription.paidUntil&&<div><dt>Acesso pago até</dt><dd>{dateLabel(subscription.paidUntil)}</dd></div>}
      </dl>
      {subscription.status==="past_due"&&<p>Há uma cobrança em atraso. Consulte o histórico para regularizar seu plano.</p>}
      {subscription.cancellation==="pending"&&<p role="status">Cancelamento solicitado. Aguardamos a confirmação do Asaas.</p>}
      {subscription.cancellation==="review"&&<p>Precisamos revisar o cancelamento. <a href="/suporte.html">Entre em contato com o suporte</a>.</p>}
      {subscription.canCancel&&!canceling&&<AppButton variant="secondary" onClick={()=>setCanceling(true)}>Cancelar renovação</AppButton>}
      {subscription.canCancel&&canceling&&<div className="billing-confirm">
        <p>{subscription.paidUntil?"Você mantém o acesso pago até "+dateLabel(subscription.paidUntil)+". ":""}
          O cancelamento interrompe futuras cobranças. Você poderá escolher outra periodicidade ao fim do acesso vigente.</p>
        <div className="billing-actions">
          <AppButton variant="secondary" disabled={working} onClick={()=>setCanceling(false)}>Manter assinatura</AppButton>
          <AppButton variant="danger" disabled={working} onClick={()=>void cancelRenewal()}>Confirmar cancelamento</AppButton>
        </div>
      </div>}
    </>}
    {status?.checkout&&(checkoutUrl?
      <a className="billing-link" href={checkoutUrl} rel="noreferrer">Retomar checkout {plans[status.checkout.planCode].toLowerCase()}</a>:
      <p role="status">Existe uma tentativa de contratação em análise.</p>)}
    {status?.checkoutAvailable&&!status.canStart&&!status.checkout&&!subscription&&
      <p>A contratação fica disponível ao término do seu acesso gratuito.</p>}
    {status&&!status.checkoutAvailable&&!subscription&&<p>Contratação online indisponível no momento.</p>}
    {status?.canStart&&catalog.length>0&&<>
      <p>Todos os planos incluem acesso completo, com renovação por cartão.</p>
      <ul className="billing-plans">
        {catalog.map(plan=><li key={plan.code}>
          <div><strong>{plans[plan.code]}</strong><span>{money(plan.amountCents)} {frequency[plan.code]}</span></div>
          <AppButton variant="secondary" aria-pressed={selected?.code===plan.code} disabled={working}
            onClick={()=>{setSelected(plan);setAccepted(false);}}>Escolher {plans[plan.code].toLowerCase()}</AppButton>
        </li>)}
      </ul>
    </>}
    {selected&&status?.canStart&&<div className="billing-confirm">
      <label>
        <AppInput type="checkbox" checked={accepted} disabled={working} onChange={event=>setAccepted(event.target.checked)}/>
        Aceito a cobrança de {money(selected.amountCents)} ao concluir o checkout e a renovação {frequency[selected.code]} pelo mesmo valor.
      </label>
      <AppButton disabled={!accepted||working} onClick={()=>void confirmCheckout()}>{working?"Abrindo checkout…":"Continuar para o Asaas Sandbox"}</AppButton>
    </div>}
    {!!status?.payments.length&&<>
      <h4>Histórico de cobranças</h4>
      <ul className="billing-history">{status.payments.map((payment,index)=>{
        const invoice=sandboxLink(payment.invoiceUrl,"invoice");
        return <li key={index}>
          <span>{payment.dueOn?dateLabel(payment.dueOn):"Data indisponível"}</span>
          <strong>{money(payment.amountCents)}</strong>
          <span>{labels[payment.state]??"Em análise"}</span>
          {invoice&&<a href={invoice} target="_blank" rel="noreferrer">Abrir fatura</a>}
        </li>;
      })}</ul>
    </>}
    {(status?.checkoutAvailable||status?.subscription||error||callback)&&(
      <AppButton variant="secondary" disabled={working} onClick={()=>setAttempt(value=>value+1)}>Atualizar assinatura</AppButton>
    )}
  </section>;
}
