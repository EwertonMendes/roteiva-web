import {useId,useRef,useState} from "react";
import {createPortal} from "react-dom";
import {AlertTriangle,Check} from "lucide-react";
import {AppModal,AppModalHeader,AppModalBody,AppModalFooter} from "./AppModal";
import {AppButton} from "./AppButton";

export type ConfirmationDialogProps={
  title:string;
  description:string;
  confirmLabel?:string;
  cancelLabel?:string;
  className?:string;
  tone?:"danger"|"default";
  onCancel:()=>void;
  onConfirm:()=>void|Promise<void>;
};

/** Reusable, top-layer, accessible confirmation. Async actions stay mounted
 * until completion; cancel/backdrop/Escape cannot dismiss a pending action.
 * A rejected action stays open and displays an inline, non-native error. */
export function ConfirmationDialog({
  title,description,confirmLabel="Confirmar",cancelLabel="Cancelar",
  tone="danger",className="",onCancel,onConfirm,
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
  return createPortal(<AppModal size="compact" className={["rt-confirm-dialog",className].filter(Boolean).join(" ")}
    aria-labelledby={titleId} aria-describedby={descriptionId}
    onCloseRequest={()=>{if(!pending.current)onCancel();}}>
    <div className="rt-modal__layout">
      <AppModalHeader title={title} titleId={titleId} description={description} descriptionId={descriptionId}
        onClose={onCancel} closeDisabled={busy} closeLabel="Fechar confirmação"
        icon={<span className={"rt-confirm-symbol"+(tone==="danger"?" rt-confirm-symbol--danger":"")}>
          {tone==="danger"?<AlertTriangle size={23}/>:<Check size={23}/>}
        </span>}/>
      <AppModalBody>
        {error&&<p className="rt-confirm-error" role="alert">{error}</p>}
      </AppModalBody>
      <AppModalFooter>
        <AppButton type="button" variant="secondary" disabled={busy} onClick={onCancel}>{cancelLabel}</AppButton>
        <AppButton type="button" variant={tone==="danger"?"danger":"primary"} loading={busy}
          onClick={()=>void confirm()}>{busy?"Processando…":confirmLabel}</AppButton>
      </AppModalFooter>
    </div>
  </AppModal>,document.body);
}
