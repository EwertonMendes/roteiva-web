
import {useEffect,useId,useState} from "react";
import {ArrowUpRight,CalendarDays,ChevronDown,CreditCard,RefreshCw,TrendingUp} from "lucide-react";
import type {AccessInfo} from "../../data/access-watch";
import {AppButton} from "../ui/AppButton";
import {ConfirmationDialog} from "../ui/ConfirmationDialog";
import {useAuth} from "../auth/AuthProvider";
import {BillingArt} from "./BillingArt";
import {BillingHistory} from "./BillingHistory";
import {BillingPlans,CheckoutConsent} from "./BillingPlans";
import {billingDate,billingInThisBuild,billingRequest,cadence,money,planNames,sandboxLink,type BillingStatus,type Plan,type Subscription} from "./billing-data";
import "./billing.css";

const subscriptionStates:Record<string,{label:string;tone:string}> = {
  active:{label:"Renovação ativa",tone:"positive"},
  past_due:{label:"Em atraso",tone:"critical"},
  canceled:{label:"Renovação cancelada",tone:"warning"},
  expired:{label:"Expirada",tone:"neutral"},
};
const callbacks:Record<string,string> = {
  cancelled:"O checkout foi interrompido. Se você chegou a pagar, sua confirmação continuará sendo processada. Consulte o histórico antes de tentar novamente.",
  expired:"O prazo do checkout terminou. Se houve cobrança, aguarde a confirmação antes de iniciar outra contratação.",
};

export function BillingPanel({access,locked=false}:{access:AccessInfo;locked?:boolean}) {
  const {user} = useAuth();
  if(!user||!billingInThisBuild) return null;
  return <BillingAccount key={user.uid} uid={user.uid} access={access} locked={locked}/>;
}

function BillingAccount({uid,access,locked}:{uid:string;access:AccessInfo;locked:boolean}) {
  const heading = useId();
  const [result,setResult] = useState<{status:BillingStatus;revision:number}|null>(null);
  const [catalog,setCatalog] = useState<Plan[]>([]);
  const [attempt,setAttempt] = useState(0);
  const [selected,setSelected] = useState<Plan|null>(null);
  const [selectedUpgrade,setSelectedUpgrade] = useState<{plan:Plan;effectiveOn:string}|null>(null);
  const [canceling,setCanceling] = useState(false);
  const [showPlans,setShowPlans] = useState(false);
  const [error,setError] = useState("");
  const [catalogError,setCatalogError] = useState(false);
  const [message,setMessage] = useState("");
  const [checkoutPending,setCheckoutPending] = useState(false);
  const [returnState,setReturnState] = useState<"idle"|"checking"|"delayed"|"unavailable">("idle");
  const refreshKey = access.accessUntil.getTime();
  const callback = locked ? new URLSearchParams(window.location.search).get("billing") : null;
  const returnIntent = locked ? new URLSearchParams(window.location.search).get("intent") : null;
  const status = result?.status;
  const subscription = status?.subscription;
  const checkoutUrl = access.suspended ? undefined : sandboxLink(status?.checkout?.url,"checkout");
  const canStart = locked && callback!=="return" && !!status?.canStart && !access.suspended;
  const upgradeOffer = !locked&&!access.suspended ? subscription?.upgradeOffer : null;
  const upgrade = subscription?.upgrade;
  const readCatalog = !access.suspended && (canStart || showPlans);

  useEffect(() => {
    if(callback==="return")return; // The bounded callback recovery owns status reads.
    const controller = new AbortController();
    setError("");
    void billingRequest<BillingStatus>("/billing/status",uid,undefined,controller.signal).then(data=>{
      if(!controller.signal.aborted) setResult(previous=>({status:data,revision:(previous?.revision??0)+1}));
    }).catch(()=>{
      if(!controller.signal.aborted) setError("Não foi possível consultar os dados da assinatura.");
    });
    return ()=>controller.abort();
  },[uid,attempt,refreshKey,access.suspended,callback]);

  useEffect(() => {
    if(callback!=="return"||!locked||access.suspended)return;
    const controller=new AbortController();
    let timer:ReturnType<typeof setTimeout>|null=null;
    const pause=(ms:number)=>new Promise<void>(resolve=>{timer=setTimeout(resolve,ms);});
    const run=async()=>{
      setReturnState("checking");
      setError("");
      try {
        // This asks the Worker to reconcile the existing checkout using Asaas.
        // Neither the URL parameter nor this request may activate access.
        const result=await billingRequest<{status:string}>("/billing/return/verify",uid,{intentId:returnIntent},controller.signal);
        if(result.status==="not_found"||result.status==="closed"){
          if(!controller.signal.aborted)setReturnState("unavailable");
          return;
        }
      }catch{
        // Keep reading the server's canonical billing status: the webhook may
        // already be processing even if the verification nudge could not run.
      }
      // Only on returning from checkout; finite backoff, no ambient polling.
      for(const delay of [0,1500,2500,4000,6000,8000,10000]){
        if(delay)await pause(delay);
        if(controller.signal.aborted)return;
        try{
          const current=await billingRequest<BillingStatus>("/billing/status",uid,undefined,controller.signal);
          if(controller.signal.aborted)return;
          setResult(previous=>({status:current,revision:(previous?.revision??0)+1}));
          // AccessGate continues to enforce the Firestore server projection.
          // The component unmounts automatically when that verified projection
          // becomes active; never open the workspace based on this response.
        }catch{
          if(controller.signal.aborted)return;
        }
      }
      if(!controller.signal.aborted)setReturnState("delayed");
    };
    void run();
    return()=>{controller.abort();if(timer)clearTimeout(timer);};
  },[uid,callback,returnIntent,locked,access.suspended,attempt]);

  useEffect(() => {
    if(!readCatalog) return;
    const controller = new AbortController();
    setCatalogError(false);
    void billingRequest<{plans:Plan[]}>("/billing/plans",uid,undefined,controller.signal).then(data=>{
      if(!controller.signal.aborted) setCatalog(data.plans);
    }).catch(()=>{
      if(!controller.signal.aborted) setCatalogError(true);
    });
    return ()=>controller.abort();
  },[uid,attempt,readCatalog]);

  const refresh = () => setAttempt(value=>value+1);

  async function confirmCheckout(plan:Plan) {
    if(!canStart) return;
    const response = await billingRequest<{url?:string;status:string}>("/billing/checkout",uid,{
      planCode:plan.code,catalogVersion:plan.version,acceptedImmediateCharge:true,
    });
    const url = sandboxLink(response.url,"checkout");
    if(url){ window.location.assign(url);return; }
    setSelected(null);
    setCheckoutPending(true);
    refresh();
  }

  async function cancelRenewal() {
    const response = await billingRequest<{status:string}>("/billing/cancel",uid,{confirmed:true});
    if(response.status==="canceled") setMessage("Renovação cancelada. Seu acesso pago continua até o fim do período.");
    setCanceling(false);
    refresh();
  }

  async function confirmUpgrade(plan:Plan,effectiveOn:string) {
    const response = await billingRequest<{status:"scheduled"|"pending"}>("/billing/upgrade",uid,{
      planCode:plan.code,catalogVersion:plan.version,effectiveOn,confirmed:true,
    });
    setSelectedUpgrade(null);
    setShowPlans(false);
    setResult(previous=>{
      if(!previous?.status.subscription)return previous;
      return {...previous,status:{...previous.status,subscription:{
        ...previous.status.subscription,upgradeOffer:null,
        upgrade:{planCode:plan.code,amountCents:plan.amountCents,effectiveOn,status:response.status},
      }}};
    });
    refresh();
  }

  return <section className="billing-panel" aria-labelledby={heading}>
    {!locked&&<h2 id={heading} className="billing-section-title">Assinatura</h2>}
    {locked&&<h2 id={heading} className="billing-sr-only">Assinatura</h2>}
    {!locked&&!subscription&&<TrialOrComplimentary access={access} ending={status?.notice?.code.endsWith("_ending")??false}/>}
    {subscription&&<PlanSummary subscription={subscription} illustrated={!locked} access={access} locked={locked}
      grace={status?.notice?.code==="payment_grace"} onCancel={()=>setCanceling(true)}
      onUpgrade={upgradeOffer?()=>setShowPlans(value=>!value):undefined} showPlans={showPlans}/>}
    {callback==="return"&&returnState==="checking"&&<p className="billing-notice" role="status">
      Estamos conferindo o pagamento com segurança. Assim que o Asaas confirmar, seu acesso será liberado automaticamente.
    </p>}
    {callback==="return"&&returnState==="delayed"&&<div className="billing-notice" role="status">
      <strong>A confirmação está demorando mais que o esperado.</strong>
      <p>Se o pagamento foi aprovado, não pague novamente. Você pode verificar outra vez ou procurar o <a href="/suporte.html">suporte</a>. Seus dados estão preservados.</p>
      <AppButton variant="secondary" onClick={refresh}><RefreshCw size={16} aria-hidden="true"/> Verificar novamente</AppButton>
    </div>}
    {callback==="return"&&returnState==="unavailable"&&<p className="billing-notice" role="alert">
      Não localizamos uma contratação em andamento para esta conta. Confira se você voltou com a mesma conta usada no pagamento. Se houve cobrança, fale com o <a href="/suporte.html">suporte</a> antes de tentar de novo.
    </p>}
    {callback&&callbacks[callback]&&<p className="billing-notice" role="status">{callbacks[callback]}</p>}
    {message&&<p className="billing-notice" role="status">{message}</p>}
    {upgrade&&!access.suspended&&<div className="billing-notice" role="status">
      {upgrade.status==="scheduled"?<p><strong>Upgrade agendado.</strong> O plano {planNames[upgrade.planCode].toLowerCase()} começa em {billingDate(upgrade.effectiveOn)}. A próxima cobrança será de {money(upgrade.amountCents)}.</p>:
        upgrade.status==="pending"?<p>O upgrade aguarda confirmação do Asaas.</p>:
          <p>O upgrade precisa de revisão. <a className="billing-support-link" href="/suporte.html">Fale com o suporte</a>.</p>}
    </div>}
    {checkoutPending&&!status?.checkout&&!access.suspended&&<p className="billing-notice" role="status">Estamos verificando a criação do checkout.</p>}
    {!status&&!error&&<p className="billing-notice" role="status">Consultando assinatura…</p>}
    {error&&<p className="billing-inline-error" role="alert">{error}</p>}
    {status?.checkout&&!access.suspended&&callback!=="return"&&<div className="billing-notice billing-next-action">
      <div><strong>Checkout {planNames[status.checkout.planCode].toLowerCase()}</strong>
        <p role={checkoutUrl?undefined:"status"}>{checkoutUrl?"Conclua o pagamento no Asaas.":"Estamos verificando a tentativa de contratação."}</p>
      </div>
      {checkoutUrl&&<a className="billing-text-link" href={checkoutUrl} rel="noreferrer">Retomar checkout <ArrowUpRight size={17}/></a>}
    </div>}
    {locked&&status&&!access.suspended&&!status.checkout&&!canStart&&!status.checkoutAvailable&&
      <p className="billing-notice">Contratação online indisponível no momento.</p>}
    {!locked&&!upgradeOffer&&!upgrade&&status?.checkoutAvailable&&!status.checkout&&
      <AppButton variant="secondary" className="billing-toggle-plans" aria-expanded={showPlans} onClick={()=>setShowPlans(value=>!value)}>
        {showPlans?"Ocultar planos":"Ver planos"} <ChevronDown size={17} aria-hidden="true"/>
      </AppButton>}
    {readCatalog&&catalog.length>0&&<BillingPlans catalog={catalog} canStart={canStart}
      upgrade={upgradeOffer&&subscription?{...upgradeOffer,currentPlan:subscription.planCode,currentAmountCents:subscription.amountCents}:null}
      onSelect={plan=>upgradeOffer?setSelectedUpgrade({plan,effectiveOn:upgradeOffer.effectiveOn}):setSelected(plan)}/>}
    {readCatalog&&!catalog.length&&!catalogError&&<p className="billing-notice" role="status">Consultando os planos…</p>}
    {catalogError&&readCatalog&&<p className="billing-inline-error" role="alert">Não foi possível carregar os planos.</p>}
    {(error||(catalogError&&readCatalog)||subscription?.cancellation==="pending"||(upgrade?.status==="pending"&&!access.suspended)||
      (!access.suspended&&(callback!=="return"&&status?.checkout?.status==="pending"||(checkoutPending&&!status?.checkout))))&&
      <AppButton variant="secondary" className="billing-refresh" onClick={refresh}><RefreshCw size={16} aria-hidden="true"/> Atualizar assinatura</AppButton>}
    {status&&(!locked||status.payments.length>0)&&<BillingHistory key={result?.revision} firstPage={status} uid={uid}/>}
    {selected&&canStart&&<CheckoutConsent plan={selected} onClose={()=>setSelected(null)} onConfirm={()=>confirmCheckout(selected)}/>}
    {selectedUpgrade&&upgradeOffer&&<ConfirmationDialog title={`Upgrade para o plano ${planNames[selectedUpgrade.plan.code].toLowerCase()}`}
      description={`Em ${billingDate(selectedUpgrade.effectiveOn)}, a renovação será de ${money(selectedUpgrade.plan.amountCents)} ${cadence[selectedUpgrade.plan.code]}, no cartão atual. Nenhum valor será cobrado agora.`}
      className="billing-upgrade-confirmation" tone="default" confirmLabel="Confirmar upgrade" cancelLabel="Voltar" onCancel={()=>setSelectedUpgrade(null)}
      onConfirm={()=>confirmUpgrade(selectedUpgrade.plan,selectedUpgrade.effectiveOn)}/>}
    {subscription?.canCancel&&canceling&&<ConfirmationDialog title="Cancelar renovação?"
      description={`As cobranças futuras serão interrompidas.${subscription.upgrade?" O upgrade agendado também será cancelado.":""}${subscription.paidUntil?` Você mantém seu acesso pago até ${billingDate(subscription.paidUntil)}.`:""}`}
      confirmLabel="Confirmar cancelamento" cancelLabel="Manter assinatura" onCancel={()=>setCanceling(false)} onConfirm={cancelRenewal}/>}
  </section>;
}

function TrialOrComplimentary({access,ending}:{access:AccessInfo;ending:boolean}) {
  const trial = access.source==="trial";
  return <div className="billing-account-card billing-account-card--illustrated">
    <div className="billing-account-copy">
      <span className="billing-pill" data-tone={ending?"warning":"positive"}>{ending?"Termina em breve":"Acesso ativo"}</span>
      <h3>{trial?"Período de teste gratuito":access.unlimited||access.source==="complimentary"?"Acesso de cortesia":"Seu acesso"}</h3>
      <p className="billing-account-date"><CalendarDays size={17} aria-hidden="true"/>
        {access.unlimited?"Sem vencimento programado":`Disponível até ${billingDate(access.accessUntil)}`}
      </p>
      {trial&&<p className="billing-muted">Seu teste gratuito dura 7 dias, sem cobrança automática.</p>}
    </div>
    <div className="billing-account-art"><BillingArt name="access"/></div>
  </div>;
}

function PlanSummary({subscription,access,locked,illustrated,grace,onCancel,onUpgrade,showPlans}:{
  subscription:Subscription;access:AccessInfo;locked:boolean;illustrated:boolean;grace:boolean;onCancel:()=>void;
  onUpgrade?:()=>void;showPlans:boolean;
}) {
  const status = subscriptionStates[subscription.status] ?? {label:"Em análise",tone:"neutral"};
  const next = subscription.status==="active" ? subscription.nextDueOn : null;
  const paidUntil = subscription.paidUntil;
  const canCancel = subscription.canCancel;
  return <div className="billing-current">
    <div className={`billing-account-card${illustrated?" billing-account-card--illustrated":""}`}>
      <div className="billing-account-copy">
        <span className="billing-pill" data-tone={status.tone}>{status.label}</span>
        <h3>Plano {planNames[subscription.planCode].toLowerCase()}</h3>
        {subscription.amountCents!==null&&<div className="billing-price">
          <strong>{money(subscription.amountCents)}</strong><span>{cadence[subscription.planCode]}</span>
        </div>}
      </div>
      {illustrated&&<div className="billing-account-art"><BillingArt name={subscription.planCode}/></div>}
    </div>
    <dl className="billing-details">
      {paidUntil&&<div><CalendarDays size={19} aria-hidden="true"/><div>
        <dt>{locked||Date.parse(paidUntil)<=Date.now()?"Período pago até":"Acesso pago até"}</dt>
        <dd><time dateTime={paidUntil}>{billingDate(paidUntil)}</time></dd>
      </div></div>}
      {next&&<div><CalendarDays size={19} aria-hidden="true"/><div><dt>Próxima cobrança</dt>
        <dd><time dateTime={next}>{billingDate(next)}</time></dd></div></div>}
      {subscription.paymentMethod==="CREDIT_CARD"&&<div><CreditCard size={19} aria-hidden="true"/><div>
        <dt>Forma de pagamento</dt><dd>Cartão de crédito</dd>
      </div></div>}
      {!locked&&access.source!=="subscription"&&<div><CalendarDays size={19} aria-hidden="true"/><div>
        <dt>{access.source==="trial"?"Teste gratuito":access.source==="complimentary"?"Acesso de cortesia":"Acesso atual"}</dt>
        <dd>{access.unlimited?"Sem vencimento programado":`Até ${billingDate(access.accessUntil)}`}</dd>
      </div></div>}
    </dl>
    {(subscription.status==="past_due"||subscription.cancellation||canCancel||onUpgrade)&&<div className="billing-manage">
      {subscription.status==="past_due"&&<p>{grace?`Seu acesso continua até ${billingDate(access.accessUntil)}. `:""}Consulte o histórico para regularizar a cobrança em atraso.</p>}
      {subscription.cancellation==="pending"&&<p role="status">O cancelamento aguarda confirmação do Asaas.</p>}
      {subscription.cancellation==="review"&&<p>O cancelamento precisa de revisão. <a href="/suporte.html">Fale com o suporte</a>.</p>}
      {canCancel&&<AppButton variant="secondary" onClick={onCancel}>Cancelar renovação</AppButton>}
      {onUpgrade&&<AppButton variant="primary" onClick={onUpgrade} aria-expanded={showPlans} aria-controls={showPlans?"billing-plan-options":undefined}>
        <TrendingUp size={17} aria-hidden="true"/>{showPlans?"Ocultar opções":"Fazer upgrade"}
      </AppButton>}
    </div>}
  </div>;
}
