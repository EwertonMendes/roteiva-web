import {UploadFailure,type UploadedFile} from '../drive/drive-upload-client';
export type DropboxUploadSession={attemptId:string;offset:number;chunkSize:number;completed?:boolean;fileId?:string};
const API='https://roteiva-api-dev.ewertonmendes9.workers.dev';
const MAX_RETRIES=4;
const RETRYABLE=new Set([429,500,502,503,504]);
function isSession(value:DropboxUploadSession):boolean{
 return typeof value.attemptId==='string'&&/^[0-9a-f-]{36}$/i.test(value.attemptId)&&
  Number.isSafeInteger(value.offset)&&value.offset>=0&&value.chunkSize===4*1024*1024;
}
const sleep=(ms:number,signal:AbortSignal)=>new Promise<void>((resolve,reject)=>{
 if(signal.aborted){reject(new UploadFailure('cancelled','Envio cancelado.'));return}
 const timer=setTimeout(()=>{signal.removeEventListener('abort',stop);resolve()},ms);
 const stop=()=>{clearTimeout(timer);reject(new UploadFailure('cancelled','Envio cancelado.'))};
 signal.addEventListener('abort',stop,{once:true});
});
/** The browser holds only its Firebase bearer; OAuth and upload sessions remain in the Worker. */
export async function sendToDropbox(file:File,session:DropboxUploadSession,connectionId:string,
 getToken:()=>Promise<string>,signal:AbortSignal,onProgress:(bytes:number)=>void):Promise<UploadedFile>{
 if(!isSession(session)||file.size<=0||!Number.isSafeInteger(file.size))
  throw new UploadFailure('invalid_session','A sessão de upload do Dropbox é inválida.');
 if(session.completed)throw new UploadFailure('unconfirmed','Esta tentativa já foi concluída. Atualize a pasta.');
 let offset=session.offset;
 const path=API+'/integrations/dropbox/'+encodeURIComponent(connectionId)+'/uploads/'+encodeURIComponent(session.attemptId)+'/chunk';
 while(offset<file.size){
  if(signal.aborted)throw new UploadFailure('cancelled','Envio cancelado.');
  const end=Math.min(file.size,offset+session.chunkSize);
  let sent=false;
  for(let retries=0;retries<=MAX_RETRIES&&!sent;retries++){
   try{
    const token=await getToken();
    const response=await fetch(path+'?offset='+offset,{
     method:'POST',credentials:'omit',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer',
     signal:AbortSignal.any([signal,AbortSignal.timeout(90000)]),
     headers:{Authorization:'Bearer '+token,'Content-Type':'application/octet-stream'},
     body:file.slice(offset,end)
    });
    const result=await response.json().catch(()=>null) as {offset?:number;error?:{code?:string}}|null;
    if(response.ok&&result&&result.offset===end){
     offset=end;session.offset=offset;onProgress(offset);sent=true;break;
    }
    if(response.status===409&&result?.error?.code==='dropbox_upload_invalid_offset')
     throw new UploadFailure('uncertain','O servidor não confirmou o próximo bloco. Verifique a fila antes de reiniciar.');
    if(!RETRYABLE.has(response.status))
     throw new UploadFailure('upload_failed','O Dropbox recusou o envio. Confira a pasta e as permissões.');
   }catch(err){
    if(signal.aborted)throw new UploadFailure('cancelled','Envio cancelado.');
    if(err instanceof UploadFailure)throw err;
   }
   if(!sent&&retries===MAX_RETRIES)
    throw new UploadFailure('retries_exhausted','Não foi possível concluir o bloco. Use Retomar envio.');
   await sleep(Math.min(900*2**retries,7000),signal);
  }
 }
 return {id:'',name:file.name,mimeType:file.type||'application/octet-stream',size:String(file.size)};
}
