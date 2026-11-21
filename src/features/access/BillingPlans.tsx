
import {useEffect,useId,useRef,useState} from "react";
import {ArrowRight,Check,CreditCard,LockKeyhole,QrCode} from "lucide-react";
import {AppButton} from "../ui/AppButton";
import {AppInput} from "../ui/AppInput";
import {AppModal,AppModalBody,AppModalFooter,AppModalHeader} from "../ui/AppModal";
import {BillingArt} from "./BillingArt";
import {billingDate,cadence,money,planNames,productionBilling,type Plan,type PlanCode,type UpgradeOffer,type PaymentMethod} from "./billing-data";

const months:Record<PlanCode,number> = {monthly:1,quarterly:3,yearly:12};
type UpgradeComparison=UpgradeOffer&{currentPlan:PlanCode;currentAmountCents:number|null};

export function BillingPlans({catalog,canStart,pixAvailable=false,upgrade,onSelect}:{
  catalog:Plan[];canStart:boolean;pixAvailable?:boolean;upgrade?:UpgradeComparison|null;onSelect:(plan:Plan)=>void;
}) {
  const heading=useRef<HTMLHeadingElement>(null);
  const isUpgrade=!!upgrade;
  useEffect(()=>{if(isUpgrade)heading.current?.focus();},[isUpgrade]);
  const monthly = catalog.find(plan=>plan.code==="monthly")?.amountCents;
  const displayed=upgrade?catalog.filter(plan=>upgrade.plans.includes(plan.code)):catalog;
  const comparisonAmount=upgrade?upgrade.currentAmountCents:monthly;
  const comparisonMonths=upgrade?months[upgrade.currentPlan]:1;
  const reference=upgrade?"ao seu plano atual":"ao plano mensal";
  return <section className="billing-plan-section" id="billing-plan-options" aria-labelledby="billing-plans-title">
    <header className="billing-plan-head">
      <h3 id="billing-plans-title" ref={heading} tabIndex={upgrade?-1:undefined}>{upgrade?"Faça upgrade do seu plano":canStart?"Escolha seu plano":"Planos de assinatura"}</h3>
      <p>{upgrade?`O novo plano começa na renovação de ${billingDate(upgrade.effectiveOn)}.`:
        canStart?(pixAvailable?"Todos incluem acesso completo. Escolha cartão com renovação automática ou PIX com pagamento manual.":"Todos incluem acesso completo ao Roteiva, com renovação por cartão."):"Valores para novas contratações."}</p>
    </header>
    <ul className="billing-plans" data-upgrade-options={upgrade?displayed.length:undefined}>
      {displayed.map(plan => {
        const savings = comparisonAmount
          ?Math.floor(100*(1-plan.amountCents*comparisonMonths/(comparisonAmount*months[plan.code]))):0;
        const highlighted = plan.code==="yearly" && savings>0;
        return <li className="billing-plan" data-featured={highlighted || undefined} data-plan={plan.code} key={plan.code}>
          <div className="billing-plan-art"><BillingArt name={plan.code}/></div>
          <div className="billing-plan-copy">
            <div className="billing-plan-name">
              <h4>{planNames[plan.code]}</h4>
              {savings>0 && <span className="billing-pill" data-tone="positive" title={`Em relação ${reference}`}>
                {savings}% de economia<span className="billing-sr-only"> em relação {reference}</span>
              </span>}
            </div>
            <div className="billing-price"><strong>{money(plan.amountCents)}</strong><span>{cadence[plan.code]}</span></div>
          </div>
          {(canStart||upgrade)&&<AppButton variant={highlighted?"primary":"secondary"} className="billing-plan-action" onClick={()=>onSelect(plan)}>
            {upgrade?"Mudar para":"Escolher"} {planNames[plan.code].toLowerCase()} <ArrowRight size={17} aria-hidden="true"/>
          </AppButton>}
        </li>;
      })}
    </ul>
  </section>;
}

export function CheckoutConsent({plan,pixAvailable,cardAvailable,courtesyUntil,onClose,onConfirm}:{
  plan:Plan;pixAvailable:boolean;cardAvailable:boolean;courtesyUntil:string|null;onClose:()=>void;onConfirm:(method:PaymentMethod)=>Promise<void>;
}) {
  const titleId = useId(), descriptionId = useId();
  const [accepted,setAccepted] = useState(false);
  const [method,setMethod] = useState<PaymentMethod>(cardAvailable?"CREDIT_CARD":"PIX");
  const [working,setWorking] = useState(false);
  const [error,setError] = useState("");
  const pending = useRef(false);
  const close = () => {if(!pending.current) onClose();};
  async function confirm() {
    if(!accepted||pending.current) return;
    pending.current = true;
    setWorking(true);
    setError("");
    try { await onConfirm(method); }
    catch(reason){ setError(reason instanceof Error?reason.message:"Não foi possível abrir o checkout."); }
    finally { pending.current = false;setWorking(false); }
  }
  return <AppModal size="compact" className="billing-consent" aria-labelledby={titleId} aria-describedby={descriptionId} onCloseRequest={close}>
    <div className="rt-modal__layout">
      <AppModalHeader title={`Plano ${planNames[plan.code].toLowerCase()}`} titleId={titleId}
        description={method==="PIX"?"Revise o período e confirme o pagamento único por Pix.":"Revise os valores e confirme a cobrança recorrente."} descriptionId={descriptionId}
        icon={method==="PIX"?<QrCode size={21}/>:<CreditCard size={21}/>} onClose={close} closeDisabled={working}/>
      <AppModalBody>
        <div className="billing-consent-summary">
          <div className="billing-consent-details">
            <p className="billing-consent-eyebrow">Plano selecionado</p>
            <div className="billing-price">
              <strong>{money(plan.amountCents)}</strong><span>{cadence[plan.code]}</span>
            </div>
            <span className="billing-consent-security">
              <LockKeyhole size={15} aria-hidden="true"/> {productionBilling?"Pagamento em ambiente seguro":"Pagamento seguro no ambiente de teste"}
            </span>
          </div>
          <div className="billing-consent-art" aria-hidden="true">
            <BillingArt name={plan.code}/>
          </div>
        </div>
        {pixAvailable&&<div className="billing-payment-methods" role="radiogroup" aria-label="Forma de pagamento">
          {cardAvailable&&<label className="billing-payment-choice" data-selected={method==="CREDIT_CARD"}>
            <AppInput type="radio" name="billing-method" checked={method==="CREDIT_CARD"} disabled={working}
              onChange={()=>{setMethod("CREDIT_CARD");setAccepted(false);}}/>
            <CreditCard size={19} aria-hidden="true"/>
            <span><strong>Cartão de crédito</strong><small>Renovação automática a cada período</small></span>
          </label>}
          <label className="billing-payment-choice" data-selected={method==="PIX"}>
            <AppInput type="radio" name="billing-method" checked={method==="PIX"} disabled={working}
              onChange={()=>{setMethod("PIX");setAccepted(false);}}/>
            <QrCode size={19} aria-hidden="true"/>
            <span><strong>Pix</strong><small>Pagamento único, sem renovação automática</small></span>
          </label>
        </div>}
        {courtesyUntil&&<p className="billing-consent-courtesy" role="status">
          Sua cortesia está garantida até <strong>{billingDate(courtesyUntil)}</strong>.
          {method==="PIX"?" O período pago será acrescentado ao final dela.":
          " A cobrança no cartão começa agora; os dias restantes serão acrescentados ao acesso, mas a data das próximas cobranças não será adiada."}
        </p>}
        <label className="billing-consent-check">
          <AppInput type="checkbox" checked={accepted} disabled={working} onChange={event=>setAccepted(event.target.checked)}/>
          <span>{method==="PIX"
            ?`Aceito pagar ${money(plan.amountCents)} via Pix por um período ${cadence[plan.code]}. Não haverá cobrança automática. Uma nova compra só estará disponível após o término do período pago.`
            :`Aceito a cobrança de ${money(plan.amountCents)} ao concluir o checkout e a renovação automática ${cadence[plan.code]} pelo mesmo valor. Os dias gratuitos restantes não adiam as cobranças futuras.`}</span>
        </label>
        {error&&<p className="billing-inline-error" role="alert">{error}</p>}
      </AppModalBody>
      <AppModalFooter>
        <AppButton type="button" variant="secondary" onClick={close} disabled={working}>Voltar</AppButton>
        <AppButton type="button" variant="primary" disabled={!accepted||working} loading={working} onClick={()=>void confirm()}>
          <Check size={17} aria-hidden="true"/> {working?"Abrindo checkout…":"Continuar para o pagamento"}
        </AppButton>
      </AppModalFooter>
    </div>
  </AppModal>;
}
