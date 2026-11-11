import { API_BASE_URL } from "../../lib/environment.ts";
import {AppButton} from "../ui/AppButton";
import {createContext,useContext,useEffect,useState,type ReactNode} from "react";
import {watchAccess,type AccessInfo} from "../../data/access-watch";
import {ArrowRight,Crown,Gift,ShieldAlert,RefreshCw,LogOut} from "lucide-react";
import {firebaseServices} from "../../lib/firebase";
import {useAuth} from "../auth/AuthProvider";
import {AuthLayout} from "../auth/AuthLayout";
import "./access.css";

const BASE=API_BASE_URL;
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
      <AppButton className="auth-primary" onClick={()=>setAttempt(n=>n+1)}><RefreshCw size={16}/> Tentar novamente</AppButton>
      <AppButton className="auth-link" disabled={busy} onClick={()=>void logout()}>Trocar conta</AppButton>
    </div>
  </AuthLayout>;
  if(!access)return <main className="studio-loading" role="status">Confirmando seu acesso ao Roteiva…</main>;
  if(access.suspended||(!access.unlimited&&access.accessUntil.getTime()<=now))return <AuthLayout
    section="ACESSO À CONTA" title={access.suspended?"Acesso temporariamente suspenso.":"Seu período de acesso terminou."}
    description={access.suspended?"Seu espaço está protegido. Consulte o suporte do Roteiva para esclarecer a suspensão.":"O teste gratuito é concedido uma única vez por identidade. Excluir e recriar a conta não libera outro teste. Seu cadastro e seus projetos estão preservados; você poderá continuar quando um novo período de acesso for ativado."}>
    <div className="access-locked">
      <ShieldAlert size={26}/><div><strong>{access.suspended?"Acesso suspenso":"Acesso expirado"}</strong>
        <span>Seus dados não foram excluídos. A contratação online ainda não está disponível nesta versão de testes.</span></div>
    </div>
    <div className="access-actions">
      <AppButton className="auth-primary" onClick={()=>setAttempt(n=>n+1)}><RefreshCw size={16}/> Verificar acesso novamente <ArrowRight size={16}/></AppButton>
      <AppButton className="auth-link" disabled={busy} onClick={()=>void logout()}><LogOut size={16}/> Sair da conta</AppButton>
    </div>
  </AuthLayout>;
  return <AccessContext.Provider value={access}>{children}</AccessContext.Provider>;
}
export function AccessSummary(){
  const access=useAccess();
  if(!access)return null;
  const title=access.unlimited?"Acesso de cortesia":
    access.source==="trial"?"Período de teste gratuito":
    access.source==="complimentary"?"Acesso de cortesia":"Seu acesso";
  return <section className="settings-editor access-settings" aria-labelledby="settings-access-title">
    <header className="settings-section-head">
      <span className="settings-index"><Crown size={18} aria-hidden="true"/> 04 / SEU ACESSO</span>
      <h3 id="settings-access-title">{title}</h3>
      <p>Você tem acesso completo ao Roteiva.</p>
    </header>
    <div className="access-settings-detail">
      <span className="access-settings-gift" aria-hidden="true"><Gift size={22}/></span>
      <span className="access-settings-divider" aria-hidden="true"/>
      <span>{access.unlimited?"Sem vencimento programado":
        `Disponível até ${access.accessUntil.toLocaleDateString("pt-BR",{day:"numeric",month:"long",year:"numeric"})}.`}</span>
    </div>
    {access.source==="trial"&&!access.unlimited&&<p className="settings-note">Seu teste gratuito dura 7 dias e não exige cartão. Não haverá cobrança automática quando ele terminar.</p>}
  </section>;
}
