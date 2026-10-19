import {createContext,useContext,useEffect,useState,type ReactNode} from "react";
import {watchAccess,type AccessInfo} from "../../data/access-watch";
import {Clock3,ShieldAlert,ArrowRight,RefreshCw,LogOut} from "lucide-react";
import {firebaseServices} from "../../lib/firebase";
import {useAuth} from "../auth/AuthProvider";
import {AuthLayout} from "../auth/AuthLayout";
import {AccountDeletionAction} from "../settings/AccountDeletionAction";
import "./access.css";

const BASE="https://roteiva-api-dev.ewertonmendes9.workers.dev";
const AccessContext=createContext<AccessInfo|null>(null);
export const useAccess=()=>useContext(AccessContext);
export async function ensureUserAccess():Promise<void>{
  const user=firebaseServices().auth.currentUser;
  if(!user)throw new Error("Sua sessão expirou. Entre novamente.");
  const response=await fetch(BASE+"/access/ensure",{
    method:"POST",headers:{Authorization:"Bearer "+await user.getIdToken(),"Content-Type":"application/json"},
    cache:"no-store"
  });
  if(!response.ok)throw new Error(response.status===429
    ?"Muitas tentativas. Aguarde um pouco antes de tentar novamente."
    :"Não foi possível verificar o acesso à sua conta. Tente novamente.");
}
export function AccessGate({children}:{children:ReactNode}){
  const {user,logout,busy}=useAuth();
  const [access,setAccess]=useState<AccessInfo|null>(null);
  const [error,setError]=useState("");
  const [attempt,setAttempt]=useState(0);
  const [now,setNow]=useState(Date.now());
  useEffect(()=>{
    const clock=setInterval(()=>setNow(Date.now()),30000);
    const onFocus=()=>setNow(Date.now());
    window.addEventListener("focus",onFocus);
    return()=>{clearInterval(clock);window.removeEventListener("focus",onFocus);};
  },[]);
  useEffect(()=>{
    if(!user)return;
    let active=true,unsubscribe=()=>{};
    setAccess(null);setError("");
    void ensureUserAccess().then(()=>{
      if(!active)return;
      unsubscribe=watchAccess(firebaseServices().db,user.uid,value=>{
        if(active){setAccess(value);setError("");setNow(Date.now());}
      },reason=>{if(active)setError(reason.message);});
    }).catch(reason=>{if(active)setError(reason instanceof Error?reason.message:"Falha ao verificar acesso.");});
    return()=>{active=false;unsubscribe();};
  },[user?.uid,attempt]);
  if(error)return <AuthLayout section="ACESSO" title="Não conseguimos validar sua assinatura." description="Por segurança, seu espaço fica protegido até a confirmação. Nenhum dado será apagado.">
    <p role="alert" className="auth-error">{error}</p>
    <div className="auth-row-actions">
      <button className="auth-primary" onClick={()=>setAttempt(n=>n+1)}><RefreshCw size={16}/> Tentar novamente</button>
      <button className="auth-link" disabled={busy} onClick={()=>void logout()}>Trocar conta</button>
    </div>
    <AccountDeletionAction compact/>
  </AuthLayout>;
  if(!access)return <main className="studio-loading" role="status">Confirmando seu acesso ao Roteiva…</main>;
  if(access.suspended||(!access.unlimited&&access.accessUntil.getTime()<=now))return <AuthLayout
    section="ACESSO À CONTA" title={access.suspended?"Acesso temporariamente suspenso.":"Seu período de acesso terminou."}
    description={access.suspended?"Seu espaço está protegido. Consulte o suporte do Roteiva para esclarecer a suspensão.":"Seu cadastro e seus projetos estão preservados. Você poderá continuar usando o Roteiva quando um novo período de acesso for ativado."}>
    <div className="access-locked">
      <ShieldAlert size={26}/><div><strong>{access.suspended?"Acesso suspenso":"Acesso expirado"}</strong>
        <span>Seus dados não foram excluídos. A contratação online ainda não está disponível nesta versão de testes.</span></div>
    </div>
    <div className="access-actions">
      <button className="auth-primary" onClick={()=>setAttempt(n=>n+1)}><RefreshCw size={16}/> Verificar acesso novamente <ArrowRight size={16}/></button>
      <button className="auth-link" disabled={busy} onClick={()=>void logout()}><LogOut size={16}/> Sair da conta</button>
    </div>
    <AccountDeletionAction compact/>
  </AuthLayout>;
  return <AccessContext.Provider value={access}>{children}</AccessContext.Provider>;
}
export function AccessSummary(){
  const access=useAccess();
  if(!access)return null;
  const title=access.unlimited?"Acesso cortesia sem prazo de expiração":
    access.source==="trial"?"Período de teste gratuito":
    access.source==="complimentary"?"Acesso de cortesia":"Acesso ao Roteiva";
  return <section className="settings-editor access-settings" aria-label="Condição do acesso">
    <div className="settings-section-head"><div>
      <span className="settings-index">04 / SUA ASSINATURA</span>
      <h3>Seu acesso</h3>
      <p>Uma única assinatura com todas as ferramentas do Roteiva.</p>
    </div><Clock3 size={20}/></div>
    <div className="access-settings-detail">
      <strong>{title}</strong>
      <span>{access.unlimited?"Sem vencimento programado":`Disponível até ${access.accessUntil.toLocaleDateString("pt-BR",{day:"2-digit",month:"long",year:"numeric"})}`}</span>
    </div>
    {access.source==="trial"&&!access.unlimited&&<p className="settings-note">Seu teste gratuito dura 7 dias e não exige cartão. Não haverá cobrança automática quando ele terminar.</p>}
  </section>;
}
