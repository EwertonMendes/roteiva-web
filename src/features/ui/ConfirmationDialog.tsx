import {useId,useRef,useState} from "react";
import {createPortal} from "react-dom";
import {AlertTriangle,Check,X} from "lucide-react";
import {AppDialog} from "./AppDialog";
import {AppButton} from "./AppButton";

export type ConfirmationDialogProps={
  title:string;
  description:string;
  confirmLabel?:string;
  cancelLabel?:string;
  tone?:"danger"|"default";
  onCancel:()=>void;
  onConfirm:()=>void|Promise<void>;
};

/** Reusable, top-layer, accessible confirmation. Async actions stay mounted
 * until completion; cancel/backdrop/Escape cannot dismiss a pending action.
 * A rejected action stays open and displays an inline, non-native error. */
export function ConfirmationDialog({
  title,description,confirmLabel="Confirmar",cancelLabel="Cancelar",
  tone="danger",onCancel,onConfirm,
}:ConfirmationDialogProps){
  const titleId=useId(),descriptionId=useId();
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  const pending=useRef(false);
  async function confirm(){
    if(pending.current)return;
    pending.current=true;setBusy(true);setError("");
    try{await onConfirm();}
    catch(cause){
      setError(cause instanceof Error?cause.message:"Não foi possível concluir. Tente novamente.");
    }finally{pending.current=false;setBusy(false);}
  }
  return createPortal(<AppDialog className="rt-confirm-dialog"
    aria-labelledby={titleId} aria-describedby={descriptionId}
    onCloseRequest={()=>{if(!pending.current)onCancel();}}>
    <div className={"rt-confirm-symbol"+(tone==="danger"?" rt-confirm-symbol--danger":"")} aria-hidden="true">
      {tone==="danger"?<AlertTriangle size={23}/>:<Check size={23}/>}
    </div>
    <AppButton type="button" className="rt-confirm-close" aria-label="Fechar confirmação"
      disabled={busy} onClick={onCancel}><X size={19}/></AppButton>
    <h2 id={titleId}>{title}</h2>
    <p id={descriptionId}>{description}</p>
    {error&&<p className="rt-confirm-error" role="alert">{error}</p>}
    <div className="rt-confirm-actions">
      <AppButton type="button" className="rt-confirm-cancel" disabled={busy} onClick={onCancel}>{cancelLabel}</AppButton>
      <AppButton type="button" className={"rt-confirm-submit"+(tone==="danger"?" rt-confirm-submit--danger":"")} loading={busy}
        onClick={()=>void confirm()}>{busy?"Processando…":confirmLabel}</AppButton>
    </div>
  </AppDialog>,document.body);
}
