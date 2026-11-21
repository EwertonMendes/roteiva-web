
import {useEffect,useId,useState} from "react";
import {ArrowUpRight,CalendarDays,ChevronDown,CreditCard,QrCode,RefreshCw,TrendingUp} from "lucide-react";
import type {AccessInfo} from "../../data/access-watch";
import {AppButton} from "../ui/AppButton";
import {ConfirmationDialog} from "../ui/ConfirmationDialog";
import {useAuth} from "../auth/AuthProvider";
import {BillingArt} from "./BillingArt";
import {BillingHistory} from "./BillingHistory";
import {BillingPlans,CheckoutConsent} from "./BillingPlans";
import {billingDate,billingInThisBuild,billingRequest,cadence,hostedPaymentLink,money,planNames,type BillingStatus,type CheckoutReturn,type Plan,type Subscription,type PaymentMethod} from "./billing-data";
import "./billing.css";

const subscriptionStates:Record<string,{label:string;tone:string}> = {
  active:{label:"Renovação ativa",tone:"positive"},
  past_due:{label:"Em atraso",tone:"critical"},
  canceled:{label:"Renovação cancelada",tone:"warning"},
  expired:{label:"Expirada",tone:"neutral"},
};
const checkoutStatusCopy:Record<NonNullable<BillingStatus["checkout"]>["status"],string>={
  ready:"Conclua o pagamento ou encerre a tentativa para escolher outra forma de pagamento.",
  pending:"Estamos verificando a tentativa de contratação.",
  closing:"Estamos confirmando o encerramento da tentativa anterior.",
  payment_pending:"Identificamos um pagamento em processamento. Aguarde a confirmação antes de contratar novamente.",
  review:"Sua tentativa precisa de conferência. Se houve cobrança, fale com o suporte.",
};

export function BillingPanel({access,locked=false,checkoutReturn=null}:{
  access:AccessInfo;locked?:boolean;checkoutReturn?:CheckoutReturn|null;
}) {
  const {user} = useAuth();
  if(!user||!billingInThisBuild) return null;
  return <BillingAccount key={user.uid} uid={user.uid} access={access} locked={locked} checkoutReturn={checkoutReturn}/>;
}

function BillingAccount({uid,access,locked,checkoutReturn}:{
  uid:string;access:AccessInfo;locked:boolean;checkoutReturn:CheckoutReturn|null;
}) {
  const heading = useId();
  const [status,setStatus] = useState<BillingStatus|null>(null);
  const [catalog,setCatalog] = useState<Plan[]>([]);
  const [attempt,setAttempt] = useState(0);
  const [selected,setSelected] = useState<Plan|null>(null);
  const [selectedUpgrade,setSelectedUpgrade] = useState<{plan:Plan;effectiveOn:string}|null>(null);
  const [canceling,setCanceling] = useState(false);
  const [switchingCheckout,setSwitchingCheckout] = useState(false);
  const [showPlans,setShowPlans] = useState(false);
  const [error,setError] = useState("");
  const [catalogError,setCatalogError] = useState(false);
  const [message,setMessage] = useState("");
  const [checkoutPending,setCheckoutPending] = useState(false);
  const [returnDelayed,setReturnDelayed] = useState(false);
  const waitingForReturn=checkoutReturn==="verifying"&&!access.suspended;
  const refreshKey = access.accessUntil.getTime();
  const subscription = status?.subscription;
  const checkoutUrl = access.suspended ? undefined : hostedPaymentLink(status?.checkout?.url,"checkout");
  const canStartCard = !waitingForReturn && !checkoutPending && !!status?.canStart && !access.suspended;
  const canStartPix = !waitingForReturn&&!checkoutPending&&!!status?.pixAvailable&&!!status?.canRenewWithPix&&!access.suspended;
  const canStart=canStartCard||canStartPix;
  const upgradeOffer = !locked&&!access.suspended ? subscription?.upgradeOffer : null;
  const upgrade = subscription?.upgrade;
  const readCatalog = !access.suspended && (locked&&canStart || showPlans);
  useEffect(()=>{
    const controller=new AbortController();
    let timer:ReturnType<typeof setTimeout>;
    const delays=waitingForReturn?[1500,2500,4000,6000,8000,10000]:[2000,5000,11000,24000,47000];
    const read=async(index:number)=>{
      if(controller.signal.aborted)return;
      let wait=waitingForReturn||index>0;
      try{
        const current=await billingRequest<BillingStatus>("/billing/status",uid,undefined,controller.signal);
        if(controller.signal.aborted)return;
        setError("");
        setCheckoutPending(false);
        setStatus(current);
        const checkoutState=current.checkout?.status;
        wait=waitingForReturn||!access.suspended&&["pending","closing","payment_pending"].some(state=>state===checkoutState);
      }catch{
        if(controller.signal.aborted)return;
        if(!wait)setError("Não foi possível consultar os dados da assinatura.");
      }
      if(!wait)return;
      if(index<delays.length)timer=setTimeout(()=>void read(index+1),delays[index]);
      else if(waitingForReturn)setReturnDelayed(true);
    };
    setReturnDelayed(false);
    setError("");
    void Promise.resolve().then(()=>read(0));
    return()=>{controller.abort();clearTimeout(timer);};
  },[uid,attempt,refreshKey,access.suspended,waitingForReturn]);

  useEffect(() => {
    if(!readCatalog||catalog.length) return;
    const controller = new AbortController();
    setCatalogError(false);
    void billingRequest<{plans:Plan[]}>("/billing/plans",uid,undefined,controller.signal).then(data=>{
      if(!controller.signal.aborted) setCatalog(data.plans);
    }).catch(()=>{
      if(!controller.signal.aborted) setCatalogError(true);
    });
    return ()=>controller.abort();
  },[uid,attempt,readCatalog,catalog.length]);

  const refresh = () => setAttempt(value=>value+1);

  async function confirmCheckout(plan:Plan,method:PaymentMethod) {
    if(method==='PIX'?!canStartPix:!canStartCard)return;
    const response = await billingRequest<{url?:string;status:string}>("/billing/checkout",uid,{
      planCode:plan.code,catalogVersion:plan.version,acceptedImmediateCharge:true,
      ...(method==='PIX'?{paymentMethod:method}:{}),
    });
    const url = hostedPaymentLink(response.url,"checkout");
    if(url){ window.location.assign(url);return; }
    setSelected(null);
    setCheckoutPending(true);
    refresh();
  }

  async function abandonCheckout() {
    if(!status?.checkout)return;
    const response=await billingRequest<{status:string}>("/billing/checkout/abandon",uid,{
      intentId:status.checkout.intentId,confirmed:true
    });
    setSwitchingCheckout(false);
    setCheckoutPending(false);
    if(response.status==="pending"){
      setStatus(previous=>previous?.checkout?{...previous,checkout:{
        ...previous.checkout,status:"closing",url:null,canCancel:false,
      }}:previous);
    }else if(response.status==="closed")setShowPlans(true);
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
    setStatus(previous=>{
      if(!previous?.subscription)return previous;
      return {...previous,subscription:{
        ...previous.subscription,upgradeOffer:null,
        upgrade:{planCode:plan.code,amountCents:plan.amountCents,effectiveOn,status:response.status},
      }};
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
    {waitingForReturn&&!returnDelayed&&<p className="billing-notice" role="status">
      Estamos conferindo o pagamento com segurança. Assim que o pagamento for confirmado, seu acesso será liberado automaticamente.
    </p>}
    {waitingForReturn&&returnDelayed&&<div className="billing-notice" role="status">
      <strong>A confirmação está demorando mais que o esperado.</strong>
      <p>Se o pagamento foi aprovado, não pague novamente. Você pode verificar outra vez ou procurar o <a href="/suporte.html">suporte</a>. Seus dados estão preservados.</p>
      <AppButton variant="secondary" onClick={refresh}><RefreshCw size={16} aria-hidden="true"/> Verificar novamente</AppButton>
    </div>}
    {checkoutReturn==="not_found"&&<p className="billing-notice" role="alert">
      Não localizamos uma contratação em andamento para esta conta. Confira se você voltou com a mesma conta usada no pagamento. Se houve cobrança, fale com o <a href="/suporte.html">suporte</a> antes de tentar de novo.
    </p>}
    {message&&<p className="billing-notice" role="status">{message}</p>}
    {upgrade&&!access.suspended&&<div className="billing-notice" role="status">
      {upgrade.status==="scheduled"?<p><strong>Upgrade agendado.</strong> O plano {planNames[upgrade.planCode].toLowerCase()} começa em {billingDate(upgrade.effectiveOn)}. A próxima cobrança será de {money(upgrade.amountCents)}.</p>:
        upgrade.status==="pending"?<p>O upgrade aguarda confirmação do pagamento.</p>:
          <p>O upgrade precisa de revisão. <a className="billing-support-link" href="/suporte.html">Fale com o suporte</a>.</p>}
    </div>}
    {checkoutPending&&!status?.checkout&&!access.suspended&&<p className="billing-notice" role="status">Estamos verificando a criação do checkout.</p>}
    {!status&&!error&&!waitingForReturn&&<p className="billing-notice" role="status">Consultando assinatura…</p>}
    {error&&<p className="billing-inline-error" role="alert">{error}</p>}
    {status?.checkout&&!access.suspended&&!waitingForReturn&&<div className="billing-notice billing-next-action">
      <div><strong>Checkout {planNames[status.checkout.planCode].toLowerCase()} · {status.checkout.paymentMethod==="PIX"?"Pix":"Cartão de crédito"}</strong>
        <p role={checkoutUrl?undefined:"status"}>{checkoutStatusCopy[status.checkout.status]}</p>
      </div>
      <div className="billing-checkout-actions">
        {checkoutUrl&&<a className="billing-text-link" href={checkoutUrl} rel="noreferrer">Retomar checkout <ArrowUpRight size={17}/></a>}
        {(status.checkout.canCancel??!!checkoutUrl)&&<AppButton variant="secondary" onClick={()=>setSwitchingCheckout(true)}>Trocar plano ou pagamento</AppButton>}
        {!checkoutUrl&&<AppButton variant="secondary" onClick={refresh}><RefreshCw size={16} aria-hidden="true"/> Atualizar situação</AppButton>}
        {status.checkout.status==="review"&&<a className="billing-text-link" href="/suporte.html">Fale com o suporte</a>}
      </div>
    </div>}
    {locked&&status&&!access.suspended&&!status.checkout&&!canStart&&!status.checkoutAvailable&&
      <p className="billing-notice">Contratação online indisponível no momento.</p>}
    {!locked&&!upgradeOffer&&!upgrade&&status?.checkoutAvailable&&!status.checkout&&
      <AppButton variant="secondary" className="billing-toggle-plans" aria-expanded={showPlans} onClick={()=>setShowPlans(value=>!value)}>
        {showPlans?"Ocultar planos":access.source==="trial"||access.source==="complimentary"?"Conhecer planos e contratar":canStartPix?"Renovar com Pix":"Ver planos"} <ChevronDown size={17} aria-hidden="true"/>
      </AppButton>}
    {showPlans&&status?.courtesyUntil&&canStart&&<p className="billing-notice" role="status">
      Sua cortesia continua até {billingDate(status.courtesyUntil)}. Ao contratar agora, os dias restantes serão preservados.
      No cartão a cobrança é realizada agora e a renovação continua na periodicidade escolhida.
      No Pix o período pago começa após a cortesia e a renovação é manual.
    </p>}
    {readCatalog&&catalog.length>0&&<BillingPlans catalog={catalog} canStart={canStart} pixAvailable={!!status?.pixAvailable}
      upgrade={upgradeOffer&&subscription?{...upgradeOffer,currentPlan:subscription.planCode,currentAmountCents:subscription.amountCents}:null}
      onSelect={plan=>upgradeOffer?setSelectedUpgrade({plan,effectiveOn:upgradeOffer.effectiveOn}):setSelected(plan)}/>}
    {readCatalog&&!catalog.length&&!catalogError&&<p className="billing-notice" role="status">Consultando os planos…</p>}
    {catalogError&&readCatalog&&<p className="billing-inline-error" role="alert">Não foi possível carregar os planos.</p>}
    {(error||(catalogError&&readCatalog)||subscription?.cancellation==="pending"||(upgrade?.status==="pending"&&!access.suspended)||
      (!access.suspended&&checkoutPending&&!status?.checkout))&&
      <AppButton variant="secondary" className="billing-refresh" onClick={refresh}><RefreshCw size={16} aria-hidden="true"/> Atualizar assinatura</AppButton>}
    {status&&(!locked||status.payments.length>0)&&<BillingHistory firstPage={status} uid={uid}/>}
    {selected&&canStart&&<CheckoutConsent plan={selected} courtesyUntil={status?.courtesyUntil??null} pixAvailable={canStartPix} cardAvailable={canStartCard}
      onClose={()=>setSelected(null)} onConfirm={method=>confirmCheckout(selected,method)}/>}
    {switchingCheckout&&status?.checkout&&<ConfirmationDialog
      title="Trocar plano ou pagamento?"
      description="Vamos cancelar a tentativa de pagamento atual antes de permitir uma nova escolha. Caso exista pagamento ou uma confirmação em andamento, a troca será bloqueada para evitar duas cobranças."
      confirmLabel="Cancelar tentativa e escolher" cancelLabel="Manter checkout"
      onCancel={()=>setSwitchingCheckout(false)} onConfirm={abandonCheckout}/>}
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
  const isPix=subscription.paymentMethod==="PIX";
  const status = isPix
    ?(subscription.paidUntil&&Date.parse(subscription.paidUntil)>Date.now()
      ?{label:"Período pago por Pix",tone:"positive"}
      :{label:"Período expirado",tone:"neutral"})
    :subscriptionStates[subscription.status] ?? {label:"Em análise",tone:"neutral"};
  const next = !isPix&&subscription.status==="active" ? subscription.nextDueOn : null;
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
      {isPix&&<div><QrCode size={19} aria-hidden="true"/><div>
        <dt>Forma de pagamento</dt><dd>Pix · renovação manual</dd>
      </div></div>}
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
      {subscription.cancellation==="pending"&&<p role="status">O cancelamento está sendo confirmado.</p>}
      {subscription.cancellation==="review"&&<p>O cancelamento precisa de revisão. <a href="/suporte.html">Fale com o suporte</a>.</p>}
      {canCancel&&<AppButton variant="secondary" onClick={onCancel}>Cancelar renovação</AppButton>}
      {onUpgrade&&<AppButton variant="primary" onClick={onUpgrade} aria-expanded={showPlans} aria-controls={showPlans?"billing-plan-options":undefined}>
        <TrendingUp size={17} aria-hidden="true"/>{showPlans?"Ocultar opções":"Fazer upgrade"}
      </AppButton>}
    </div>}
  </div>;
}
