
import {useEffect} from "react";
import {ArrowUpRight,Clock3,LogOut,RefreshCw,ShieldAlert} from "lucide-react";
import type {AccessInfo} from "../../data/access-watch";
import {AccountDeletionAction} from "../settings/AccountDeletionAction";
import {AppButton} from "../ui/AppButton";
import {BrandLogo} from "../ui/BrandLogo";
import {BillingArt} from "./BillingArt";
import {BillingPanel} from "./BillingPanel";
import {billingInThisBuild,type CheckoutReturn} from "./billing-data";

export function RestrictedAccessPage({access,busy,checking,accessError,checkoutReturn,onRetry,onLogout}:{
  access:AccessInfo;busy:boolean;checking:boolean;accessError:string;checkoutReturn:CheckoutReturn|null;
  onRetry:()=>void;onLogout:()=>void;
}) {
  useEffect(() => {
    document.documentElement.setAttribute("data-roteiva-ready","true");
    window.dispatchEvent(new Event("roteiva:ready"));
  },[]);
  const suspended = access.suspended;
  return <main className="billing-access">
    <div className="billing-access-inner">
      <header className="billing-access-nav">
        <BrandLogo theme="light" className="billing-logo-light"/>
        <BrandLogo theme="dark" className="billing-logo-dark"/>
        <AppButton variant="ghost" disabled={busy} onClick={onLogout}><LogOut size={17} aria-hidden="true"/> Sair da conta</AppButton>
      </header>
      <section className="billing-access-hero" aria-labelledby="billing-access-title">
        <div className="billing-access-copy">
          <span className="billing-pill" data-tone={suspended?"critical":"warning"}>
            {suspended?<ShieldAlert size={15} aria-hidden="true"/>:<Clock3 size={15} aria-hidden="true"/>}
            {suspended?"Conta suspensa":"Acesso expirado"}
          </span>
          <h1 id="billing-access-title">{suspended?"Acesso temporariamente suspenso.":"Seu período de acesso terminou."}</h1>
          <p>Seu cadastro e seus projetos estão preservados.</p>
          {suspended&&<a className="billing-text-link" href="/suporte.html">Fale com o suporte <ArrowUpRight size={17}/></a>}
        </div>
        <div className="billing-access-art"><BillingArt name="access" priority/></div>
      </section>
      {billingInThisBuild&&<BillingPanel access={access} locked checkoutReturn={checkoutReturn}/>}
      <footer className="billing-access-footer">
        {accessError&&<p className="billing-inline-error" role="alert">{accessError}</p>}
        <div className="billing-access-footer-actions">
          <AppButton variant="secondary" disabled={checking} onClick={onRetry}><RefreshCw size={16} aria-hidden="true"/>
            {checking?"Verificando acesso…":"Verificar acesso novamente"}
          </AppButton>
          <nav aria-label="Informações do serviço">
            {!suspended&&<a href="/suporte.html">Suporte</a>}
            <a href="/termos.html">Termos</a>
            <a href="/privacidade.html">Privacidade</a>
          </nav>
        </div>
        {!suspended&&billingInThisBuild&&<div className="billing-account-deletion">
          <AccountDeletionAction/>
          <p>Excluir e recriar a conta não libera outro teste.</p>
        </div>}
      </footer>
    </div>
  </main>;
}
