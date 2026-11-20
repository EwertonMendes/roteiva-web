
import {useId,useRef,useState} from "react";
import {ArrowRight,Check,CreditCard,LockKeyhole} from "lucide-react";
import {AppButton} from "../ui/AppButton";
import {AppInput} from "../ui/AppInput";
import {AppModal,AppModalBody,AppModalFooter,AppModalHeader} from "../ui/AppModal";
import {BillingArt} from "./BillingArt";
import {billingDate,cadence,money,planNames,type Plan,type PlanCode,type UpgradeOffer} from "./billing-data";

const months:Record<PlanCode,number> = {monthly:1,quarterly:3,yearly:12};
export function BillingPlans({catalog,canStart,upgrade,onSelect}:{catalog:Plan[];canStart:boolean;upgrade?:UpgradeOffer|null;onSelect:(plan:Plan)=>void}) {
  const monthly = catalog.find(plan=>plan.code==="monthly")?.amountCents;
  const displayed=upgrade?catalog.filter(plan=>upgrade.plans.includes(plan.code)):catalog;
  return <section className="billing-plan-section" aria-labelledby="billing-plans-title">
    <header className="billing-plan-head">
      <h3 id="billing-plans-title">{upgrade?"Faça upgrade do seu plano":canStart?"Escolha seu plano":"Planos de assinatura"}</h3>
      <p>{upgrade?`O novo plano começa na renovação de ${billingDate(upgrade.effectiveOn)}.`:
        canStart?"Todos incluem acesso completo ao Roteiva, com renovação por cartão.":"Valores para novas contratações, com renovação por cartão."}</p>
    </header>
    <ul className="billing-plans">
      {displayed.map(plan => {
        const savings = monthly ? Math.floor(100*(1-plan.amountCents/(monthly*months[plan.code]))) : 0;
        const highlighted = plan.code==="yearly" && savings>0;
        return <li className="billing-plan" data-featured={highlighted || undefined} data-plan={plan.code} key={plan.code}>
          <div className="billing-plan-art"><BillingArt name={plan.code}/></div>
          <div className="billing-plan-copy">
            <div className="billing-plan-name">
              <h4>{planNames[plan.code]}</h4>
              {savings>0 && <span className="billing-pill" data-tone="positive" title="Em relação ao plano mensal">
                {savings}% de economia<span className="billing-sr-only"> em relação ao plano mensal</span>
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

export function CheckoutConsent({plan,onClose,onConfirm}:{
  plan:Plan;onClose:()=>void;onConfirm:()=>Promise<void>;
}) {
  const titleId = useId(), descriptionId = useId();
  const [accepted,setAccepted] = useState(false);
  const [working,setWorking] = useState(false);
  const [error,setError] = useState("");
  const pending = useRef(false);
  const close = () => {if(!pending.current) onClose();};
  async function confirm() {
    if(!accepted||pending.current) return;
    pending.current = true;
    setWorking(true);
    setError("");
    try { await onConfirm(); }
    catch(reason){ setError(reason instanceof Error?reason.message:"Não foi possível abrir o checkout."); }
    finally { pending.current = false;setWorking(false); }
  }
  return <AppModal size="compact" className="billing-consent" aria-labelledby={titleId} aria-describedby={descriptionId} onCloseRequest={close}>
    <div className="rt-modal__layout">
      <AppModalHeader title={`Plano ${planNames[plan.code].toLowerCase()}`} titleId={titleId}
        description="Revise a cobrança antes de abrir o checkout." descriptionId={descriptionId}
        icon={<CreditCard size={21}/>} onClose={close} closeDisabled={working}/>
      <AppModalBody>
        <div className="billing-consent-total">
          <div className="billing-price"><strong>{money(plan.amountCents)}</strong><span>{cadence[plan.code]}</span></div>
          <span><LockKeyhole size={15} aria-hidden="true"/> Pagamento no Asaas Sandbox</span>
        </div>
        <label className="billing-consent-check">
          <AppInput type="checkbox" checked={accepted} disabled={working} onChange={event=>setAccepted(event.target.checked)}/>
          <span>Aceito a cobrança de {money(plan.amountCents)} ao concluir o checkout e a renovação {cadence[plan.code]} pelo mesmo valor.</span>
        </label>
        {error&&<p className="billing-inline-error" role="alert">{error}</p>}
      </AppModalBody>
      <AppModalFooter>
        <AppButton variant="secondary" onClick={close} disabled={working}>Voltar</AppButton>
        <AppButton disabled={!accepted||working} loading={working} onClick={()=>void confirm()}>
          <Check size={17} aria-hidden="true"/> {working?"Abrindo checkout…":"Continuar para o Asaas Sandbox"}
        </AppButton>
      </AppModalFooter>
    </div>
  </AppModal>;
}
