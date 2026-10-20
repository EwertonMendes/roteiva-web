export type UploadSession = {sessionUrl:string;chunkSize:number};
export type UploadedFile = {id:string;name:string;mimeType:string;size:string;webViewLink?:string};
type Reply = {status:number;range:string|null;text:string};

const MAX_RETRIES=4;
const RETRYABLE=new Set([408,429,500,502,503,504]);

export class UploadFailure extends Error {
  constructor(public code:string,message:string){super(message);}
}

export function validSession(value:string):string {
  let url:URL;
  try{url=new URL(value);}catch{throw new UploadFailure('invalid_session','O Google devolveu uma sessão inválida.');}
  if(url.protocol!=="https:"||!["www.googleapis.com","content.googleapis.com"].includes(url.hostname)||
     url.port||url.username||url.password||url.hash||
     !url.pathname.startsWith("/upload/drive/v3/files")||!url.searchParams.has("upload_id"))
    throw new UploadFailure("invalid_session","O endereço do upload não é confiável.");
  return url.href;
}

function abortError():Error {
  return new UploadFailure("cancelled","Envio cancelado.");
}

function request(url:string,file:File,start:number,end:number,statusQuery:boolean,
  signal:AbortSignal,progress:(bytes:number)=>void):Promise<Reply> {
  return new Promise((resolve,reject)=>{
    if(signal.aborted){reject(abortError());return;}
    const xhr=new XMLHttpRequest();
    let settled=false;
    const finish=(reply?:Reply,error?:Error)=>{
      if(settled)return;
      settled=true;
      signal.removeEventListener("abort",abort);
      if(error)reject(error);else resolve(reply!);
    };
    const abort=()=>{xhr.abort();finish(undefined,abortError());};
    xhr.open("PUT",url,true);
    xhr.timeout=90_000;
    xhr.setRequestHeader("Content-Range",statusQuery
      ?"bytes */"+file.size
      :"bytes "+start+"-"+(end-1)+"/"+file.size);
    if(!statusQuery)xhr.setRequestHeader("Content-Type",file.type||"application/octet-stream");
    xhr.upload.onprogress=e=>{
      if(e.lengthComputable&&!statusQuery)progress(Math.min(end,start+e.loaded));
    };
    xhr.onload=()=>finish({status:xhr.status,range:xhr.getResponseHeader("Range"),text:xhr.responseText||""});
    xhr.onerror=()=>finish(undefined,new UploadFailure("network","Não foi possível alcançar o Google Drive. Confira a conexão e as permissões do navegador."));
    xhr.ontimeout=()=>finish(undefined,new UploadFailure("timeout","O envio excedeu o tempo de resposta do Google Drive."));
    xhr.onabort=()=>finish(undefined,abortError());
    signal.addEventListener("abort",abort,{once:true});
    if(signal.aborted){abort();return;}
    xhr.send(statusQuery?null:file.slice(start,end));
  });
}

function parseUploaded(reply:Reply):UploadedFile {
  let value:unknown;
  try{value=JSON.parse(reply.text);}catch{throw new UploadFailure("invalid_response","O Google não confirmou os dados do arquivo.");}
  const obj=value as Partial<UploadedFile>|null;
  if(!obj||typeof obj.id!=="string"||!(/^[A-Za-z0-9_-]{10,200}$/).test(obj.id)||
     typeof obj.name!=="string"||typeof obj.mimeType!=="string"||
     typeof obj.size!=="string")
    throw new UploadFailure("invalid_response","O Google retornou metadados inesperados.");
  return obj as UploadedFile;
}

function nextOffset(reply:Reply,size:number):number {
  if(reply.status!==308)throw new UploadFailure("upload_failed","Não foi possível retomar o envio.");
  if(!reply.range)return 0; // The Google API uses absent Range to mean no bytes saved.
  const match=/^bytes=0-(\d+)$/.exec(reply.range);
  if(!match)throw new UploadFailure("invalid_range","O Google retornou um progresso inválido.");
  const next=Number(match[1])+1;
  if(!Number.isSafeInteger(next)||next<=0||next>=size)
    throw new UploadFailure("invalid_range","O Google retornou um progresso inconsistente.");
  return next;
}

function wait(ms:number,signal:AbortSignal):Promise<void>{
  return new Promise((resolve,reject)=>{
    if(signal.aborted){reject(abortError());return;}
    const timer=window.setTimeout(()=>{signal.removeEventListener("abort",abort);resolve();},ms);
    const abort=()=>{window.clearTimeout(timer);reject(abortError());};
    signal.addEventListener("abort",abort,{once:true});
  });
}

/** Bounded resumable chunking: query server state after uncertain writes, never guess bytes. */
export async function sendToDrive(file:File,session:UploadSession,signal:AbortSignal,
  onProgress:(bytes:number)=>void):Promise<UploadedFile>{
  if(!Number.isSafeInteger(file.size)||file.size<=0)throw new UploadFailure("empty_file","Não é possível enviar arquivos vazios.");
  const url=validSession(session.sessionUrl);
  const chunkSize=session.chunkSize;
  if(!Number.isSafeInteger(chunkSize)||chunkSize<262144||chunkSize%262144!==0||chunkSize>64*1024*1024)
    throw new UploadFailure("invalid_session","O tamanho dos blocos de envio é inválido.");
  let offset=0;
  let failures=0;
  while(offset<file.size) {
    if(signal.aborted)throw abortError();
    const end=Math.min(file.size,offset+chunkSize);
    let result:Reply;
    try{
      result=await request(url,file,offset,end,false,signal,onProgress);
      if(result.status===200||result.status===201){
        onProgress(file.size);
        return parseUploaded(result);
      }
      if(result.status===308){
        const next=nextOffset(result,file.size);
        if(next<=offset)throw new UploadFailure("invalid_range","O Google não confirmou o progresso do bloco.");
        offset=next;onProgress(offset);failures=0;continue;
      }
      if(!RETRYABLE.has(result.status))throw new UploadFailure("google_rejected",
        result.status===403?"O Google recusou a permissão de envio.":"O Google recusou o arquivo (HTTP "+result.status+").");
    }catch(error){
      if(signal.aborted)throw abortError();
      if(error instanceof UploadFailure && !["network","timeout"].includes(error.code))throw error;
    }
    if(++failures>MAX_RETRIES)throw new UploadFailure("retries_exhausted","O envio não pôde ser retomado após várias tentativas.");
    await wait(Math.min(500*2**(failures-1)+Math.random()*300,6500),signal);
    let state:Reply;
    try{state=await request(url,file,0,0,true,signal,()=>{});}
    catch(error){if(signal.aborted)throw abortError();continue;}
    if(state.status===200||state.status===201)return parseUploaded(state);
    if(state.status===308){offset=nextOffset(state,file.size);onProgress(offset);continue;}
    if(!RETRYABLE.has(state.status))throw new UploadFailure("google_rejected","O Google encerrou a sessão de envio.");
  }
  throw new UploadFailure("unconfirmed","O Google não confirmou o upload completo.");
}
