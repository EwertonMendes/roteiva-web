import {useCallback,useEffect,useRef,useState} from "react";
import {sendToDrive,UploadFailure,type UploadSession,type UploadedFile} from "./drive-upload-client";

export type UploadDestination={
  connectionId:string;linkedFolderId:string;targetFolderId:string;projectId:number;folderName:string;
};
export type UploadEntry={
  id:string;name:string;size:number;sent:number;destination:UploadDestination;
  status:"queued"|"starting"|"uploading"|"verifying"|"completed"|"failed"|"unconfirmed"|"cancelled";
  error?:string;
};
type Task={entry:UploadEntry;file:File;controller:AbortController};

export function useDriveUploads(
  create:(file:File,destination:UploadDestination)=>Promise<UploadSession>,
  confirm:(uploaded:UploadedFile,file:File,destination:UploadDestination)=>Promise<UploadedFile>,
  completed:(file:UploadedFile,destination:UploadDestination)=>void,
){
  const [uploads,setUploads]=useState<UploadEntry[]>([]);
  const tasks=useRef<Task[]>([]);
  const active=useRef(0);
  const disposed=useRef(false);
  const callbacks=useRef({create,confirm,completed});
  callbacks.current={create,confirm,completed};
  const pumpRef=useRef<()=>void>(()=>{});
  const publish=useCallback(()=>{
    setUploads(tasks.current.map(t=>({...t.entry})));
  },[]);
  const update=useCallback((task:Task,patch:Partial<UploadEntry>)=>{
    Object.assign(task.entry,patch);
    if(!disposed.current)publish();
  },[publish]);
  const run=useCallback(async(task:Task)=>{
    let uploaded:UploadedFile|undefined;
    try{
      update(task,{status:"starting",error:undefined,sent:0});
      const session=await callbacks.current.create(task.file,task.entry.destination);
      if(task.controller.signal.aborted)throw new UploadFailure("cancelled","Envio cancelado.");
      update(task,{status:"uploading"});
      uploaded=await sendToDrive(task.file,session,task.controller.signal,bytes=>{
        update(task,{sent:Math.min(bytes,task.file.size)});
      });
      if(task.controller.signal.aborted)throw new UploadFailure("cancelled","Envio cancelado.");
      update(task,{status:"verifying",sent:task.file.size});
      const verified=await callbacks.current.confirm(uploaded,task.file,task.entry.destination);
      if(task.controller.signal.aborted)throw new UploadFailure("cancelled","Envio cancelado.");
      update(task,{status:"completed"});
      callbacks.current.completed(verified,task.entry.destination);
    }catch(error){
      if(task.controller.signal.aborted){
        update(task,{status:"cancelled",error:undefined});
      }else{
        const message=error instanceof Error?error.message:"Não foi possível enviar o arquivo.";
        update(task,{status:uploaded?"unconfirmed":"failed",error:uploaded
          ?"O Google recebeu o arquivo, mas a confirmação falhou. Atualize a pasta antes de tentar enviá-lo novamente."
          :message});
      }
    }finally{
      active.current--;
      pumpRef.current();
    }
  },[update]);
  const pump=useCallback(()=>{
    if(disposed.current)return;
    while(active.current<2){
      const next=tasks.current.find(t=>t.entry.status==="queued");
      if(!next)break;
      // Synchronous reservation prevents the same item from starting twice.
      next.entry.status="starting";
      active.current++;
      void run(next);
    }
    publish();
  },[run,publish]);
  pumpRef.current=pump;

  const enqueue=useCallback((files:File[],destination:UploadDestination)=>{
    if(disposed.current)return;
    const added=files.filter(file=>file.size>0 && Number.isSafeInteger(file.size)
      && file.size<=5_000_000_000_000).map(file=>{
      const entry:UploadEntry={id:crypto.randomUUID(),name:file.name,size:file.size,
        sent:0,status:"queued",destination:{...destination}};
      return {entry,file,controller:new AbortController()};
    });
    if(added.length){tasks.current.push(...added);pumpRef.current();}
    return {added:added.length,rejected:files.length-added.length};
  },[]);

  const cancel=useCallback((id:string)=>{
    const task=tasks.current.find(t=>t.entry.id===id);
    if(!task||["completed","cancelled","unconfirmed"].includes(task.entry.status))return;
    task.controller.abort();
    if(task.entry.status==="queued")update(task,{status:"cancelled"});
  },[update]);
  const retry=useCallback((id:string)=>{
    const task=tasks.current.find(t=>t.entry.id===id);
    if(!task||task.entry.status!=="failed")return;
    task.controller=new AbortController();
    update(task,{status:"queued",sent:0,error:undefined});
    pumpRef.current();
  },[update]);
  const dismiss=useCallback((id:string)=>{
    const task=tasks.current.find(t=>t.entry.id===id);
    if(!task||!["completed","failed","cancelled","unconfirmed"].includes(task.entry.status))return;
    tasks.current=tasks.current.filter(t=>t!==task);
    publish();
  },[publish]);

  useEffect(()=>{
    disposed.current=false;
    return ()=>{disposed.current=true;tasks.current.forEach(t=>t.controller.abort());};
  },[]);
  return {uploads,enqueue,cancel,retry,dismiss};
}
