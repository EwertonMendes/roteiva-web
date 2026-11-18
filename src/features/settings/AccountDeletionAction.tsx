import {ShieldAlert as ModalShieldAlert} from "lucide-react";
import { API_BASE_URL } from "../../lib/environment.ts";
import {AppInput} from "../ui/AppInput";
import {AppButton} from "../ui/AppButton";
import {AppModal,AppModalHeader,AppModalBody,AppModalFooter} from "../ui/AppModal";
import { useEffect, useState } from "react";
import { CheckCircle2, LoaderCircle, ShieldAlert, Trash2 } from "lucide-react";
import { GoogleAuthProvider, reauthenticateWithPopup, signOut } from "firebase/auth";
import { useAuth } from "../auth/AuthProvider";
import { firebaseServices, persistentCacheEnabled, purgePrivateCache } from "../../lib/firebase";
import "./account-deletion.css";
import {entryToken,entryRequest} from '../../data/bootstrap-request.ts';

const BASE=API_BASE_URL;
const CONFIRM="EXCLUIR MINHA CONTA";
export type StatusResponse={available:boolean;operation:{id:string;status:"processing"|"completed"|"manual_review"}|null};
class DeletionApiError extends Error{
  constructor(readonly code:string,message:string){super(message);}
}
async function api<T>(path:string,method:"GET"|"POST",body?:unknown):Promise<T>{
  const {auth}=firebaseServices();
  if(!auth.currentUser)throw new Error("Sua sessão expirou. Entre novamente.");
  const user=auth.currentUser;
  const token=method==='GET'?await entryToken(()=>user.getIdToken()):await user.getIdToken(true);
  if(auth.currentUser?.uid!==user.uid)throw new Error('Sessão alterada.');
  if(method==='GET')return entryRequest<T>(BASE+path,{method,headers:{Authorization:'Bearer '+token},cache:'no-store'},'account-status');
  let r:Response;
  try{
    r=await fetch(BASE+path,{method,headers:{"Authorization":"Bearer "+token,"Content-Type":"application/json"},
      ...(body?{body:JSON.stringify(body)}:{}),cache:"no-store"});
  }catch{
    throw new Error("Não foi possível enviar a solicitação com segurança. Tente novamente.");
  }
  if(!r.ok){
    const data=await r.json().catch(()=>({})) as {error?:{code?:string}};
    const code=data.error?.code||"";
    if(code==="deletion_unavailable")throw new Error("Não foi possível solicitar a exclusão agora. Tente novamente mais tarde.");
    if(r.status===401&&code==="invalid_identity")throw new DeletionApiError(code,"Para proteger sua conta, confirme sua identidade com o Google antes de continuar.");
    throw new Error("Não foi possível concluir a solicitação com segurança. Tente novamente.");
  }
  return await r.json() as T;
}
export async function fetchAccountDeletionStatus():Promise<StatusResponse>{
  return api<StatusResponse>("/account/deletion/status","GET");
}
export function AccountDeletionAction(){
  const {user}=useAuth();
  const [ready,setReady]=useState(false);
  const [available,setAvailable]=useState(false);
  const [progress,setProgress]=useState<StatusResponse["operation"]>(null);
  const [opened,setOpened]=useState(false);
  const [text,setText]=useState("");
  const [checked,setChecked]=useState(false);
  const [busy,setBusy]=useState(false);
  const [needsIdentityConfirmation,setNeedsIdentityConfirmation]=useState(false);
  const [error,setError]=useState("");
  const canConfirm=text===CONFIRM&&checked&&!busy;
  useEffect(()=>{
    let active=true;
    void api<StatusResponse>("/account/deletion/status","GET")
      .then(result=>{if(active){setAvailable(result.available);setProgress(result.operation);}})
      .catch(()=>{if(active)setAvailable(false);})
      .finally(()=>{if(active)setReady(true);});
    return ()=>{active=false;};
  },[user?.uid]);
  function dismiss(){if(busy)return;setOpened(false);setError("");setText("");setChecked(false);}
  async function request(){
    if(!canConfirm||!user)return;
    setBusy(true);setError("");
    try{
      // The server is the source of truth for signed auth_time <= 5 minutes.
      // A recent login needs no second popup. If rejected, the next explicit
      // click opens Google synchronously, preserving the browser user gesture.
      if(needsIdentityConfirmation){
        const provider=new GoogleAuthProvider();
        if(user.email)provider.setCustomParameters({login_hint:user.email});
        await reauthenticateWithPopup(user,provider);
      }
      if(firebaseServices().auth.currentUser?.uid!==user.uid)throw new Error("A conta Google autenticada é diferente da sua conta Roteiva.");
      const response=await api<{status:"processing"|"completed"|"manual_review";operationId:string}>("/account/deletion","POST",
        {phrase:CONFIRM,acknowledged:true});
      if(!["processing","completed","manual_review"].includes(response.status))throw new Error("Não foi possível confirmar seu pedido. Tente novamente.");
      setProgress({id:response.operationId,status:response.status});
      setOpened(false);
      // Once accepted, no local copy should remain available to the next login.
      try{await signOut(firebaseServices().auth);}catch{/* server blocks all account writes */}
      if(persistentCacheEnabled()){
        try{await purgePrivateCache();}catch{/* user's other browser tabs may hold cache; show privacy notice */}
      }
      window.location.replace("/?deletion=requested");
    }catch(e){
      if(e instanceof DeletionApiError)setNeedsIdentityConfirmation(true);
      const message=e instanceof Error?e.message:"Não foi possível confirmar a operação.";
      const code=(e as {code?:string})?.code;
      if(code==='auth/user-mismatch')setError('Essa conta Google é diferente da conta que você quer excluir. Use '+(user.email||'a mesma conta aberta no Roteiva')+'.');
      else if(code==='auth/popup-blocked')setError('Seu navegador bloqueou a confirmação do Google. Permita a abertura da janela e tente novamente.');
      else if(!/popup-closed|cancelled-popup-request/.test(message))
        setError(message.startsWith("Firebase:")?"Não foi possível confirmar sua identidade Google. Tente novamente.":message);
    }finally{setBusy(false);}
  }
  return <div className="account-delete">
    <div className="settings-privacy-row">
      <div><strong>Excluir conta</strong>
        <p>Exclusão permanente dos dados do Roteiva. Arquivos originais no Google Drive serão preservados.</p>
      </div>
      <AppButton type="button" className="secondary-button" disabled={!ready||!available||!!progress} onClick={()=>{setError("");setText("");setChecked(false);setNeedsIdentityConfirmation(false);setOpened(true);}}>
        <Trash2 size={15}/> Excluir conta
      </AppButton>
    </div>
    {ready&&!available&&<p className="settings-note">Não foi possível solicitar a exclusão agora. Tente novamente mais tarde.</p>}
    {progress&&<div role="status" className="account-delete-state"><ShieldAlert size={17}/>
      {progress.status==="manual_review"?"A exclusão está demorando mais que o esperado. Não é necessário repetir o pedido."
        :progress.status==="completed"?"Sua conta foi excluída.":"Recebemos seu pedido de exclusão. Você pode fechar esta página."}</div>}
    {opened&&<AppModal size="medium" className="account-delete-dialog" onCloseRequest={dismiss}
      aria-labelledby="delete-title" aria-describedby="delete-desc">
      <div className="rt-modal__layout">
        <AppModalHeader icon={<ModalShieldAlert size={26}/>} title="Excluir sua conta?" titleId="delete-title" description="Confira os dados antes de confirmar esta ação permanente."
          eyebrow="CONFIRMAÇÃO DE SEGURANÇA" onClose={dismiss} closeDisabled={busy}/>
        <AppModalBody>
        <p id="delete-desc">Esta ação é <strong>permanente</strong>. Seu perfil, projetos, clientes, agenda, financeiro e demais informações no Roteiva serão eliminados. Não será possível recuperá-los. Um marcador pseudonimizado da identidade utilizada no teste gratuito será preservado para evitar novas concessões gratuitas.</p>
        {user?.email&&<p>Você está excluindo a conta <strong>{user.email}</strong>.</p>}
        <div className="account-delete-preserve"><CheckCircle2 size={17}/><span>Os arquivos originais do seu Google Drive não serão apagados.</span></div>
        <p>Se precisar de uma cópia dos seus registros, cancele e exporte os dados antes de continuar.</p>
        <label htmlFor="delete-confirm">Digite <strong>{CONFIRM}</strong> para confirmar:</label>
        <AppInput id="delete-confirm" value={text} onChange={e=>setText(e.target.value)} placeholder={CONFIRM} autoComplete="off" spellCheck={false} disabled={busy}/>
        <label className="account-delete-check"><AppInput type="checkbox" checked={checked} disabled={busy} onChange={e=>setChecked(e.target.checked)}/>
          <span>Entendo que esta exclusão é irreversível.</span>
        </label>
        {error&&<p className="account-delete-error" role="alert">{error}</p>}
        </AppModalBody>
        <AppModalFooter><AppButton type="button" variant="secondary" disabled={busy} onClick={dismiss}>Cancelar</AppButton>
          <AppButton type="button" variant="danger" disabled={!canConfirm} onClick={()=>void request()}>
            {busy?<><LoaderCircle size={16} className="account-delete-spin"/> Confirmando…</>:<><Trash2 size={16}/> {needsIdentityConfirmation?'Confirmar com Google':'Excluir definitivamente'}</>}
          </AppButton></AppModalFooter>
      </div>
    </AppModal>}
  </div>;
}
