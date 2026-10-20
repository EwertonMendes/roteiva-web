import {useCallback,useEffect,useRef,useState} from "react";
import {sendToDrive,UploadFailure,type UploadSession,type UploadedFile} from "./drive-upload-client";

export type UploadDestination={
  connectionId:string;linkedFolderId:string;targetFolderId:string;projectId:number;folderName:string;
};
export type UploadEntry={
  id:string;name:string;size:number;sent:number;destination:UploadDestination;
  status:"queued"|"starting"|"uploading"|"verifying"|"completed"|"failed"|"unconfirmed"|"cancelled";
  error?:string;
  canVerify?:boolean;
};
type Task={entry:UploadEntry;file:File|undefined;controller:AbortController;session?:UploadSession;uploaded?:UploadedFile};

export function useDriveUploads(
  create:(file:File,destination:UploadDestination,attemptId:string,signal:AbortSignal)=>Promise<UploadSession>,
  confirm:(uploaded:UploadedFile,size:number,destination:UploadDestination,session:UploadSession,signal:AbortSignal)=>Promise<UploadedFile>,
  completed:(file:UploadedFile,destination:UploadDestination)=>void,
  ownerUid:string,
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
    const beforeStatus=task.entry.status;
    const beforePct=Math.floor(100*task.entry.sent/task.entry.size);
    Object.assign(task.entry,patch);
    const afterPct=Math.floor(100*task.entry.sent/task.entry.size);
    if(!disposed.current&&(beforeStatus!==task.entry.status||beforePct!==afterPct||patch.error!==undefined||patch.sent===0))publish();
  },[publish]);
  const run=useCallback(async(task:Task)=>{
    let sessionStarted=Boolean(task.session);
    try{
      if(!task.uploaded){
        if(!task.file)throw new Error('Selecione o arquivo novamente.');
        update(task,{status:"starting",error:undefined,sent:0});
        const session=await callbacks.current.create(task.file,task.entry.destination,task.entry.id,task.controller.signal);
        task.session=session;sessionStarted=true;
        if(task.controller.signal.aborted)throw new UploadFailure("cancelled","Envio cancelado.");
        update(task,{status:"uploading"});
        task.uploaded=await sendToDrive(task.file,session,task.controller.signal,bytes=>{
          update(task,{sent:Math.min(bytes,task.entry.size)});
        });
        task.file=undefined; // Release the browser's file handle as soon as bytes finish.
      }
      if(task.controller.signal.aborted)throw new UploadFailure("cancelled","Envio cancelado.");
      update(task,{status:"verifying",sent:task.entry.size});
      const verified=await callbacks.current.confirm(task.uploaded,task.entry.size,task.entry.destination,task.session!,task.controller.signal);
      if(task.controller.signal.aborted)throw new UploadFailure("cancelled","Envio cancelado.");
      update(task,{status:"completed"});
      task.session=undefined;task.uploaded=undefined;
      callbacks.current.completed(verified,task.entry.destination);
    }catch(error){
      if(task.controller.signal.aborted){
        task.file=undefined;task.session=undefined;
        update(task,{status:"cancelled",error:sessionStarted?'Envio interrompido. Confira a pasta: o Google pode ter recebido o arquivo.':undefined});
      }else{
        if(sessionStarted)task.file=undefined;
        const message=error instanceof Error?error.message:"Não foi possível enviar o arquivo.";
        update(task,{status:sessionStarted?"unconfirmed":"failed",canVerify:Boolean(task.uploaded),error:sessionStarted
          ?"Não foi possível confirmar o estado do arquivo no Google. Verifique a pasta antes de tentar outro envio. "+message
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
    if(disposed.current)return {added:0,rejected:files.length};
    const added=files.filter(file=>file.size>0 && Number.isSafeInteger(file.size)
      && file.size<=5_000_000_000_000).slice(0,Math.max(0,100-tasks.current.length)).map(file=>{
      const entry:UploadEntry={id:crypto.randomUUID(),name:file.name,size:file.size,
        sent:0,status:"queued",destination:{...destination}};
      return {entry,file,controller:new AbortController()};
    });
    if(added.length){tasks.current.push(...added);pumpRef.current();}
    return {added:added.length,rejected:files.length-added.length};
  },[]);

  const cancel=useCallback((id:string)=>{
    const task=tasks.current.find(t=>t.entry.id===id);
    if(!task||["completed","cancelled","unconfirmed","verifying"].includes(task.entry.status))return;
    task.controller.abort();
    if(task.entry.status==="queued"){task.file=undefined;update(task,{status:"cancelled"});}
  },[update]);
  const retry=useCallback((id:string)=>{
    const task=tasks.current.find(t=>t.entry.id===id);
    if(!task||(task.entry.status!=="failed"&&!(task.entry.status==="unconfirmed"&&task.uploaded)))return;
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
    const warn=(event:BeforeUnloadEvent)=>{
      if(tasks.current.some(t=>['queued','starting','uploading','verifying'].includes(t.entry.status))){event.preventDefault();event.returnValue='';}
    };
    window.addEventListener('beforeunload',warn);
    return ()=>{disposed.current=true;tasks.current.forEach(t=>t.controller.abort());tasks.current=[];
      window.removeEventListener('beforeunload',warn);};
  },[ownerUid]);
  const cancelAll=useCallback((connectionId:string)=>{
    tasks.current.filter(t=>t.entry.destination.connectionId===connectionId).forEach(t=>{
      t.controller.abort();t.file=undefined;t.session=undefined;
      t.uploaded=undefined;t.entry.canVerify=false;
      if(['queued','failed','unconfirmed'].includes(t.entry.status))t.entry.status='cancelled';
    });publish();
  },[publish]);
  return {uploads,enqueue,cancel,retry,dismiss,cancelAll};
}
