export type UploadSession = {attemptId:string;sessionUrl:string;chunkSize:number};
export type UploadedFile = {id:string;name:string;mimeType:string;size:string;webViewLink?:string;thumbnailTicket?:string;modifiedTime?:string};
type Reply = {status:number;range:string|null;text:string};

const MAX_RETRIES=4;
const RETRYABLE=new Set([408,429,500,502,503,504]);

export class UploadFailure extends Error {
  public code:string;
  constructor(code:string,message:string){super(message);this.code=code;}
}

export function validSession(value:string):string {
  let url:URL;
  try{url=new URL(value);}catch{throw new UploadFailure('invalid_session','O Google devolveu uma sessão inválida.');}
  if(url.protocol!=="https:"||!["www.googleapis.com","content.googleapis.com"].includes(url.hostname)||
     url.port||url.username||url.password||url.hash||
     url.pathname!=="/upload/drive/v3/files"||!url.searchParams.get("upload_id"))
    throw new UploadFailure("invalid_session","O endereço do upload não é confiável.");
  return url.href;
}

function abortError():Error {
  return new UploadFailure("cancelled","Envio cancelado.");
}

async function request(url:string,file:File,start:number,end:number,statusQuery:boolean,
  signal:AbortSignal):Promise<Reply> {
  if(signal.aborted)throw abortError();
  try{
    const response=await fetch(url,{method:'PUT',mode:'cors',credentials:'omit',redirect:'error',
      referrerPolicy:'no-referrer',signal:AbortSignal.any([signal,AbortSignal.timeout(90_000)]),
      headers:{'Content-Range':statusQuery?'bytes */'+file.size:'bytes '+start+'-'+(end-1)+'/'+file.size,
        ...(statusQuery?{}:{'Content-Type':file.type||'application/octet-stream'})},
      body:statusQuery?null:file.slice(start,end)});
    return {status:response.status,range:response.headers.get('Range'),text:await response.text()};
  }catch(error){
    if(signal.aborted)throw abortError();
    if(error instanceof Error&&error.name==='TimeoutError')
      throw new UploadFailure('timeout','O envio excedeu o tempo de resposta do Google Drive.');
    throw new UploadFailure('network','Não foi possível alcançar o Google Drive. Confira a conexão e as permissões do navegador.');
  }
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
    const timer=globalThis.setTimeout(()=>{signal.removeEventListener("abort",abort);resolve();},ms);
    const abort=()=>{globalThis.clearTimeout(timer);reject(abortError());};
    signal.addEventListener("abort",abort,{once:true});
  });
}

function rejection(reply:Reply):UploadFailure|null {
  let reasons:string[]=[];
  try{reasons=JSON.parse(reply.text)?.error?.errors?.map((entry:{reason:string})=>entry.reason)||[];}catch{/* no raw provider text */}
  if(RETRYABLE.has(reply.status)||reasons.some(reason=>['rateLimitExceeded','userRateLimitExceeded'].includes(reason)))return null;
  if(reply.status===507||reasons.includes('storageQuotaExceeded'))return new UploadFailure('storage_full','Seu Google Drive está sem espaço disponível.');
  if(reply.status===401)return new UploadFailure('authorization_expired','A autorização do Google expirou. Reconecte sua conta.');
  if(reply.status===404||reply.status===410)return new UploadFailure('session_expired','A sessão de envio expirou. Confira a pasta antes de iniciar outro envio.');
  if(reply.status===403)return new UploadFailure('permission_denied','O Google recusou a permissão de envio. Confira o acesso à pasta.');
  return new UploadFailure('google_rejected','O Google recusou o arquivo (HTTP '+reply.status+').');
}

/** Bounded resumable chunking: query server state after uncertain writes, never guess bytes. */
export async function sendToDrive(file:File,session:UploadSession,signal:AbortSignal,
  onProgress:(bytes:number)=>void,resume=false):Promise<UploadedFile>{
  if(!Number.isSafeInteger(file.size)||file.size<=0)throw new UploadFailure("empty_file","Não é possível enviar arquivos vazios.");
  const url=validSession(session.sessionUrl);
  const chunkSize=session.chunkSize;
  if(!Number.isSafeInteger(chunkSize)||chunkSize<262144||chunkSize%262144!==0||chunkSize>64*1024*1024)
    throw new UploadFailure("invalid_session","O tamanho dos blocos de envio é inválido.");
  let offset=0;
  let failures=0;
  let uncertain=resume;
  while(offset<file.size) {
    if(signal.aborted)throw abortError();
    const end=Math.min(file.size,offset+chunkSize);
    let result:Reply;
    try{
      // Once a write is uncertain, ONLY status probes may run until one succeeds.
      result=await request(url,file,offset,end,uncertain,signal);
      if(result.status===200||result.status===201){
        const uploaded=parseUploaded(result);
        if(uploaded.size!==String(file.size))throw new UploadFailure('invalid_response','O tamanho confirmado pelo Google não corresponde ao arquivo.');
        onProgress(file.size);return uploaded;
      }
      if(result.status===308){
        const next=nextOffset(result,file.size);
        if((!uncertain&&next>end) || next<offset)throw new UploadFailure('invalid_range','O Google retornou um progresso inconsistente.');
        if(!uncertain && next===offset)throw new UploadFailure("invalid_range","O Google não confirmou o progresso do bloco.");
        const progressed=next>offset;
        offset=next;onProgress(offset);uncertain=false;
        if(progressed)failures=0;
        continue;
      }
      const error=rejection(result);if(error)throw error;
    }catch(error){
      if(signal.aborted)throw abortError();
      if(error instanceof UploadFailure && !["network","timeout"].includes(error.code))throw error;
    }
    uncertain=true;
    if(++failures>MAX_RETRIES)throw new UploadFailure("retries_exhausted","O envio não pôde ser retomado após várias tentativas.");
    await wait(Math.min(500*2**(failures-1)+Math.random()*300,6500),signal);
  }
  throw new UploadFailure("unconfirmed","O Google não confirmou o upload completo.");
}
