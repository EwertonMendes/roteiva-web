import {useState} from "react";
import {CheckCircle2,CloudUpload,LoaderCircle,RotateCcw,X,AlertCircle,ChevronDown,ChevronUp} from "lucide-react";
import type {UploadEntry} from "./useDriveUploads";

const active=new Set(["queued","starting","uploading","verifying"]);
export function DriveUploadQueue({uploads,onCancel,onRetry,onDismiss}:{
  uploads:UploadEntry[];
  onCancel:(id:string)=>void;
  onRetry:(id:string)=>void;
  onDismiss:(id:string)=>void;
}){
  const [collapsed,setCollapsed]=useState(false);
  if(!uploads.length)return null;
  const running=uploads.filter(u=>active.has(u.status)).length;
  return <aside className="rl-upload-queue" aria-label="Transferências para Google Drive">
    <header className="rl-upload-heading"><span><CloudUpload size={17}/> Transferências</span><div className="rl-upload-heading-actions"><small aria-live="polite">{running?running+" em andamento":uploads.length+" arquivo(s)"}</small><button type="button" aria-label={collapsed?"Expandir transferências":"Recolher transferências"} aria-expanded={!collapsed} onClick={()=>setCollapsed(value=>!value)}>{collapsed?<ChevronUp size={17}/>:<ChevronDown size={17}/>}</button></div></header>
    {!collapsed&&<div className="rl-upload-items">
      {uploads.map(upload=>{
        const pct=upload.status==="completed"?100:Math.min(99,Math.floor(100*upload.sent/upload.size));
        return <div className="rl-upload-item" key={upload.id} data-status={upload.status}>
          <div className="rl-upload-item-main">
            <span className="rl-upload-glyph">{upload.status==="completed"?<CheckCircle2 size={19}/>:
              upload.status==="failed"||upload.status==="unconfirmed"?<AlertCircle size={19}/>:
              active.has(upload.status)?<LoaderCircle size={19} className="rl-spin"/>:<CloudUpload size={19}/>}</span>
            <div className="rl-upload-info">
              <strong title={upload.name}>{upload.name}</strong>
              <small>{upload.status==="queued"?"Na fila":
                upload.status==="starting"?"Preparando envio…":
                upload.status==="uploading"?"Enviando para "+upload.destination.folderName+" · "+pct+"%":
                upload.status==="verifying"?"Confirmando no Google Drive…":
                upload.status==="completed"?"Arquivo enviado para "+upload.destination.folderName:
                upload.status==="cancelled"?"Envio cancelado":
                upload.error||"Falha no envio"}</small>
            </div>
            {upload.status==="verifying"?null:active.has(upload.status)
              ?<button type="button" onClick={()=>onCancel(upload.id)} title={"Cancelar envio de "+upload.name} aria-label={"Cancelar envio de "+upload.name}><X size={16}/></button>
              :<div className="rl-upload-actions">
                {upload.status==="failed"&&<button type="button" onClick={()=>onRetry(upload.id)} title="Tentar novamente" aria-label={"Tentar novamente "+upload.name}><RotateCcw size={15}/></button>}
                <button type="button" onClick={()=>onDismiss(upload.id)} title="Dispensar" aria-label={"Dispensar "+upload.name}><X size={15}/></button>
              </div>}
          </div>
          {active.has(upload.status)&&<div className="rl-upload-progress" role="progressbar" aria-label={"Progresso de "+upload.name} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
            <span style={{width:pct+"%"}}/>
          </div>}
        </div>;
      })}
    </div>}
  </aside>;
}
