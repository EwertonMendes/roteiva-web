import { API_BASE_URL } from "../../lib/environment.ts";
import {AppButton} from "../ui/AppButton";
import {createContext,useContext,useEffect,useRef,useState,type ReactNode} from "react";
import {watchAccess,type AccessInfo} from "../../data/access-watch";
import {Crown,Gift,RefreshCw} from "lucide-react";
import {firebaseServices} from "../../lib/firebase";
import {useAuth} from "../auth/AuthProvider";
import {AuthLayout} from "../auth/AuthLayout";
import {billingInThisBuild,billingRequest,type CheckoutReturn} from "./billing-data";
import {RestrictedAccessPage} from "./RestrictedAccessPage";
import "./access.css";
import {entryToken,entryRequest,entryErrorMessage,EntryError} from '../../data/bootstrap-request.ts';

const BASE=API_BASE_URL;
const AccessContext=createContext<AccessInfo|null>(null);
export const useAccess=()=>useContext(AccessContext);
export async function ensureUserAccess():Promise<void>{
  const user=firebaseServices().auth.currentUser;
  if(!user)throw new Error("Sua sessão expirou. Entre novamente.");
  const token=await entryToken(()=>user.getIdToken());
  if(firebaseServices().auth.currentUser?.uid!==user.uid)throw new Error('Sessão alterada. Entre novamente.');
  await entryRequest(BASE+"/access/ensure",{
    method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},
    cache:"no-store"
  },'access-ensure',45000);
}
export function AccessGate({children}:{children:ReactNode}){
  const {user,logout,busy}=useAuth();
  const [observed,setObserved]=useState<{uid:string;access:AccessInfo}|null>(null);
  const access=observed?.uid===user?.uid?observed?.access??null:null;
  const [checkoutReturn,setCheckoutReturn]=useState<CheckoutReturn|null>(null);
  const [checking,setChecking]=useState(false);
  const [returnParams]=useState(()=>{
    const query=new URLSearchParams(window.location.search);
    return billingInThisBuild&&query.get("billing")==="return"?{intentId:query.get("intent")}:null;
  });
  const returnRequest=useRef<{key:string;promise:Promise<CheckoutReturn>}|null>(null);
  const [error,setError]=useState("");
  const [attempt,setAttempt]=useState(0);
  const [now,setNow]=useState(Date.now());
  const usable=!!access&&!access.suspended&&(access.unlimited||access.accessUntil.getTime()>now);
  useEffect(()=>{
    if(!user||!billingInThisBuild||returnParams&&!checkoutReturn)return;
    const url=new URL(window.location.href);
    if(url.searchParams.has("billing")){
      url.searchParams.delete("billing");
      url.searchParams.delete("intent");
      window.history.replaceState(window.history.state,"",url);
    }
  },[user?.uid,returnParams,checkoutReturn]);
  useEffect(()=>{
    const clock=setInterval(()=>setNow(Date.now()),30000);
    const onFocus=()=>setNow(Date.now());
    window.addEventListener("focus",onFocus);
    return()=>{clearInterval(clock);window.removeEventListener("focus",onFocus);};
  },[]);
  useEffect(()=>{
    if(!user)return;
    let active=true,unsubscribe=()=>{};
    const controller=new AbortController();
    const returning=!!returnParams;
    const pause=(ms:number)=>new Promise<void>(resolve=>{
      const timer=setTimeout(resolve,ms);
      controller.signal.addEventListener("abort",()=>{clearTimeout(timer);resolve();},{once:true});
    });
    setChecking(true);setError("");
    const run=async()=>{
      // A projection update can temporarily fence /access/ensure. The return
      // verification is owner-authenticated and may safely run before ensure.
      if(returnParams){
        const key=user.uid+":"+attempt;
        if(returnRequest.current?.key!==key){
          const promise=billingRequest<{status:string}>("/billing/return/verify",user.uid,returnParams)
            .then(({status}):CheckoutReturn=>status==="not_found"?"not_found":status==="closed"?"closed":"verifying")
            .catch(():CheckoutReturn=>"verifying");
          returnRequest.current={key,promise};
        }
        const outcome=await returnRequest.current.promise;
        if(!active)return;
        setCheckoutReturn(outcome);
      }
      try{
        for(const delay of returning?[0,750,1400,2500,4000,6000]:[0]){
          if(delay)await pause(delay);
          if(!active)return;
          try{
            await ensureUserAccess();
            if(!active)return;
            unsubscribe=watchAccess(firebaseServices().db,user.uid,value=>{
              if(active){setObserved({uid:user.uid,access:value});setError("");setChecking(false);setNow(Date.now());}
            },reason=>{if(active){setError(reason.message);setChecking(false);}});
            return;
          }catch(reason){
            // Retry only this known billing fence, and only after a checkout
            // return. All other failures retain the normal fail-closed path.
            if(!returning||!(reason instanceof EntryError)||reason.serviceCode!=="access_sync_pending")throw reason;
          }
        }
        throw new Error("O pagamento ainda está sendo conciliado. Não pague novamente. Tente verificar seu acesso em instantes.");
      }catch(reason){
        if(active){
          setChecking(false);
          setError(entryErrorMessage(reason)??(reason instanceof Error?reason.message:
            "Não foi possível confirmar seu acesso. Tente novamente."));
        }
      }
    };
    void Promise.resolve().then(()=>{if(active)return run();});
    return()=>{active=false;controller.abort();unsubscribe();};
  },[user?.uid,attempt,returnParams]);
  if(error&&(!access||usable))return <AuthLayout section="ACESSO" title="Não conseguimos validar sua assinatura." description="Por segurança, seu espaço fica protegido até a confirmação. Nenhum dado será apagado.">
    <p role="alert" className="auth-error">{error}</p>
    <div className="auth-row-actions">
      <AppButton className="auth-primary" onClick={()=>setAttempt(n=>n+1)}><RefreshCw size={16}/> Tentar novamente</AppButton>
      <AppButton className="auth-link" disabled={busy} onClick={()=>void logout()}>Trocar conta</AppButton>
    </div>
  </AuthLayout>;
  if(!access||!user)return <main className="studio-loading" role="status">{returnParams?"Conferindo seu pagamento…":"Confirmando seu acesso ao Roteiva…"}</main>;
  if(!usable)return <RestrictedAccessPage account={user} access={access} busy={busy} checking={checking} accessError={error}
    checkoutReturn={checkoutReturn} onRetry={()=>setAttempt(n=>n+1)} onLogout={()=>void logout()}/>;
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
