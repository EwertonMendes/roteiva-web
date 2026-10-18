import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, LoaderCircle, ShieldAlert, Trash2, X } from "lucide-react";
import { GoogleAuthProvider, reauthenticateWithPopup, signOut } from "firebase/auth";
import { useAuth } from "../auth/AuthProvider";
import { firebaseServices, persistentCacheEnabled, purgePrivateCache } from "../../lib/firebase";
import "./account-deletion.css";

const BASE="https://roteiva-api-dev.ewertonmendes9.workers.dev";
const CONFIRM="EXCLUIR MINHA CONTA";
type StatusResponse={available:boolean;operation:{id:string;status:"processing"|"completed"|"manual_review"}|null};
async function api<T>(path:string,method:"GET"|"POST",body?:unknown):Promise<T>{
  const {auth}=firebaseServices();
  if(!auth.currentUser)throw new Error("Sua sessão expirou. Entre novamente.");
  const token=await auth.currentUser.getIdToken(true);
  const r=await fetch(BASE+path,{method,headers:{"Authorization":"Bearer "+token,"Content-Type":"application/json"},
    ...(body?{body:JSON.stringify(body)}:{}),cache:"no-store"});
  if(!r.ok){
    const data=await r.json().catch(()=>({})) as {error?:{code?:string}};
    const code=data.error?.code||"";
    if(code==="deletion_unavailable")throw new Error("A exclusão ainda não está habilitada neste ambiente.");
    if(code==="deletion_not_locked")throw new Error("A solicitação foi recebida, mas ainda não foi possível bloquear a conta. Acompanhe o estado antes de tentar novamente.");
    if(code==="invalid_identity")throw new Error("Confirme sua identidade Google novamente.");
    throw new Error("Não foi possível concluir a solicitação com segurança. Tente novamente.");
  }
  return await r.json() as T;
}
export function AccountDeletionAction({compact=false}:{compact?:boolean}){
  const {user}=useAuth();
  const [ready,setReady]=useState(false);
  const [available,setAvailable]=useState(false);
  const [progress,setProgress]=useState<StatusResponse["operation"]>(null);
  const [opened,setOpened]=useState(false);
  const [text,setText]=useState("");
  const [checked,setChecked]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const dialogRef=useRef<HTMLDivElement>(null);
  const canConfirm=text===CONFIRM&&checked&&!busy;
  useEffect(()=>{
    let active=true;
    void api<StatusResponse>("/account/deletion/status","GET")
      .then(result=>{if(active){setAvailable(result.available);setProgress(result.operation);}})
      .catch(()=>{if(active)setAvailable(false);})
      .finally(()=>{if(active)setReady(true);});
    return ()=>{active=false;};
  },[user?.uid]);
  useEffect(()=>{
    if(!opened)return;
    const old=document.body.style.overflow,previous=document.activeElement instanceof HTMLElement?document.activeElement:null;
    document.body.style.overflow="hidden";
    dialogRef.current?.focus();
    function keydown(event:KeyboardEvent){
      if(event.key==="Escape"&&!busy){event.preventDefault();setOpened(false);return;}
      if(event.key!=="Tab")return;
      const dialog=dialogRef.current;
      const focusable=dialog?[...dialog.querySelectorAll<HTMLElement>('input:not([disabled]),button:not([disabled])')]:[];
      if(!focusable.length)return;
      if(event.shiftKey&&(document.activeElement===dialog||document.activeElement===focusable[0])){
        event.preventDefault();focusable.at(-1)?.focus();
      }else if(!event.shiftKey&&document.activeElement===focusable.at(-1)){
        event.preventDefault();focusable[0].focus();
      }
    }
    document.addEventListener("keydown",keydown);
    return ()=>{document.body.style.overflow=old;previous?.focus();document.removeEventListener("keydown",keydown);};
  },[opened,busy]);
  function dismiss(){if(busy)return;setOpened(false);setError("");setText("");setChecked(false);}
  async function request(){
    if(!canConfirm||!user)return;
    setBusy(true);setError("");
    try{
      // The confirmation phrase prevents mistakes; Google popup proves user
      // presence. The backend independently checks JWT auth_time <= 5 minutes.
      const provider=new GoogleAuthProvider();
      provider.setCustomParameters({prompt:"select_account"});
      await reauthenticateWithPopup(user,provider);
      if(firebaseServices().auth.currentUser?.uid!==user.uid)throw new Error("A conta Google autenticada é diferente da sua conta Roteiva.");
      const response=await api<{status:"processing"|"completed"|"manual_review";operationId:string}>("/account/deletion","POST",
        {phrase:CONFIRM,acknowledged:true});
      if(!["processing","completed","manual_review"].includes(response.status))throw new Error("Não recebemos confirmação do servidor.");
      setProgress({id:response.operationId,status:response.status});
      setOpened(false);
      // Once accepted, no local copy should remain available to the next login.
      try{await signOut(firebaseServices().auth);}catch{/* server blocks all account writes */}
      if(persistentCacheEnabled()){
        try{await purgePrivateCache();}catch{/* user's other browser tabs may hold cache; show privacy notice */}
      }
      window.location.replace("/?deletion=requested");
    }catch(e){
      const message=e instanceof Error?e.message:"Não foi possível confirmar a operação.";
      if(!/popup-closed|cancelled-popup-request|popup-blocked/.test(message))
        setError(message.startsWith("Firebase:")?"Não foi possível confirmar sua identidade Google. Tente novamente.":message);
    }finally{setBusy(false);}
  }
  return <div className={"account-delete"+(compact?" account-delete-compact":"")}>
    <div className="settings-privacy-row">
      <div><strong><Trash2 size={16}/> Excluir minha conta</strong>
        {!compact&&<p>Exclusão permanente da conta e dos dados armazenados no Roteiva. Seus arquivos originais no Google Drive serão preservados.</p>}
      </div>
      <button type="button" className="secondary-button" disabled={!ready||!available||!!progress} onClick={()=>{setError("");setOpened(true);}}>
        <Trash2 size={15}/> Excluir conta
      </button>
    </div>
    {ready&&!available&&<p className="settings-note">Exclusão temporariamente indisponível. Nenhuma informação será removida enquanto o serviço seguro não estiver habilitado.</p>}
    {progress&&<div role="status" className="account-delete-state"><ShieldAlert size={17}/>
      {progress.status==="manual_review"?"Solicitação bloqueada para revisão técnica. Seus dados não serão tratados como excluídos até a conclusão."
        :progress.status==="completed"?"Exclusão concluída pelo servidor.":"Exclusão solicitada. O processamento continuará mesmo que você feche o navegador."}</div>}
    {opened&&<div className="account-delete-overlay" onMouseDown={e=>{if(e.target===e.currentTarget)dismiss();}}>
      <div className="account-delete-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="delete-title" aria-describedby="delete-desc" tabIndex={-1}>
        <header><div><AlertTriangle size={22}/><h2 id="delete-title">Excluir sua conta?</h2></div><button type="button" disabled={busy} onClick={dismiss} aria-label="Fechar"><X size={19}/></button></header>
        <p id="delete-desc">Esta ação é <strong>permanente</strong>. Seu perfil, projetos, clientes, agenda, financeiro e demais informações no Roteiva serão eliminados. Não será possível recuperá-los.</p>
        <div className="account-delete-preserve"><CheckCircle2 size={17}/><span>Os arquivos originais do seu Google Drive não serão apagados.</span></div>
        <p>Se precisar de uma cópia dos seus registros, cancele e exporte os dados antes de continuar.</p>
        <label htmlFor="delete-confirm">Digite <strong>{CONFIRM}</strong> para confirmar:</label>
        <input id="delete-confirm" value={text} onChange={e=>setText(e.target.value)} placeholder={CONFIRM} autoComplete="off" spellCheck={false} disabled={busy}/>
        <label className="account-delete-check"><input type="checkbox" checked={checked} disabled={busy} onChange={e=>setChecked(e.target.checked)}/>
          <span>Entendo que esta exclusão é irreversível.</span>
        </label>
        {error&&<p className="account-delete-error" role="alert">{error}</p>}
        <footer><button type="button" className="secondary-button" disabled={busy} onClick={dismiss}>Cancelar</button>
          <button type="button" className="account-delete-danger" disabled={!canConfirm} onClick={()=>void request()}>
            {busy?<><LoaderCircle size={16} className="account-delete-spin"/> Confirmando…</>:<><Trash2 size={16}/> Excluir definitivamente</>}
          </button></footer>
      </div>
    </div>}
  </div>;
}
