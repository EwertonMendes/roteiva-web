import { useState } from "react";
import { ArrowRight, Check, LockKeyhole } from "lucide-react";
import { useAuth, type AuthIntent } from "./AuthProvider";
import { AuthLayout } from "./AuthLayout";

export function LoginPage() {
  const {login,busy,error}=useAuth();
  const [intent,setIntent]=useState<AuthIntent>("login");
  const joining=intent==="register";
  const deletionRequested=new URLSearchParams(window.location.search).get("deletion")==="requested";
  return <AuthLayout
    section={joining?"01 — NOVA CONTA":"01 — BOAS-VINDAS"}
    title={joining?"Comece do seu jeito.":"Tudo pronto para criar."}
    description={joining
      ?"Sua conta Google é o primeiro passo. Depois, vamos configurar seu espaço em poucos segundos."
      :"Acesse seu espaço de trabalho e continue de onde a última produção parou."}>
    {deletionRequested&&<p className="auth-invitation" role="status">Sua solicitação de exclusão permanente foi aceita. O Roteiva continuará removendo os dados mesmo com o navegador fechado. A conclusão depende da confirmação do servidor; não é possível desfazer a solicitação.</p>}
    <div className="auth-tabs" role="group" aria-label="Escolha como acessar">
      <button type="button" className={!joining?"auth-tab active":"auth-tab"} aria-pressed={!joining} disabled={busy} onClick={()=>setIntent("login")}>Entrar</button>
      <button type="button" className={joining?"auth-tab active":"auth-tab"} aria-pressed={joining} disabled={busy} onClick={()=>setIntent("register")}>Criar conta</button>
    </div>
    <div className="auth-action-panel">
      <p className="auth-section-label">{joining?"SEU NOVO ESPAÇO":"ACESSO À SUA CONTA"}</p>
      {joining&&<div className="auth-benefits"><span><Check size={15}/> Cadastro rápido</span><span><Check size={15}/> Dados privados</span></div>}
      <button className="auth-google" type="button" disabled={busy} onClick={()=>void login(intent)}>
        <span className="auth-google-g" aria-hidden="true">G</span>
        <span>{busy?"Conectando…":joining?"Cadastrar com Google":"Entrar com Google"}</span>
        <ArrowRight size={17} strokeWidth={1.8} aria-hidden="true"/>
      </button>
      {error&&<p role="alert" className="auth-error">{error}</p>}
      <p className="auth-provider-note"><LockKeyhole size={15} strokeWidth={1.7}/>
        {joining?"Sua conta no Roteiva só será criada depois que você confirmar o cadastro.":"O Google confirma sua identidade. Não pedimos sua senha."}
      </p>
    </div>
    <p className="auth-switch-note">{joining?"Já tem um espaço Roteiva?":"Ainda não usa o Roteiva?"}{" "}
      <button type="button" className="auth-text-button" onClick={()=>setIntent(joining?"login":"register")} disabled={busy}>{joining?"Entrar na minha conta":"Criar meu espaço"} <ArrowRight size={14}/></button>
    </p>
  </AuthLayout>;
}
