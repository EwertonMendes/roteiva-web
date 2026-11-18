/** Small, redacted errors for entry reads. Never retain URLs, tokens or raw causes. */
export type EntryStage='profile-sdk'|'profile-server'|'access-token'|'access-ensure'|'access-server'|'access-listener'|'account-status'|'registration';
type EntryCategory='transport'|'timeout'|'authentication'|'authorization'|'quota'|'server'|'invalid-response';
export class EntryError extends Error {
  readonly code:string;
  readonly stage:EntryStage;
  readonly category:EntryCategory;
  readonly status?:number;
  readonly requestId?:string;
  readonly serviceCode?:string;
  constructor(stage:EntryStage,category:EntryCategory,details:{status?:number;requestId?:unknown;serviceCode?:unknown}={}){
    const id=typeof details.requestId==='string'&&/^[a-f0-9-]{32,36}$/i.test(details.requestId)?details.requestId:undefined;
    const code=typeof details.serviceCode==='string'&&/^[a-z][a-z0-9_]{0,63}$/.test(details.serviceCode)?details.serviceCode:undefined;
    const message=category==='authentication'?'Sua sessão expirou. Entre novamente.':
      category==='authorization'?'O servidor não autorizou esta consulta. Entre novamente.':
      category==='quota'?'Muitas tentativas. Aguarde um pouco antes de tentar novamente.':
      category==='timeout'?'O serviço demorou para responder. Tente novamente.':
      'Não foi possível confirmar a conexão com o serviço. Tente novamente.';
    super(message+' Referência: '+stage+'/'+category+(id?' · '+id:''));
    this.name='EntryError';this.stage=stage;this.category=category;
    this.code=category==='timeout'?'deadline-exceeded':category==='authentication'?'unauthenticated':
      category==='authorization'?'permission-denied':category==='invalid-response'?'invalid-argument':'unavailable';
    this.status=details.status;this.requestId=id;this.serviceCode=code;
  }
}

/** Also bounds non-cancellable SDK promises. Late results never settle this promise again. */
export function entryDeadline<T>(read:()=>Promise<T>,stage:EntryStage,ms:number):Promise<T>{
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new EntryError(stage,'timeout')),ms);
    Promise.resolve().then(read).then(resolve,reject).finally(()=>clearTimeout(timer));
  });
}

export async function entryToken(read:()=>Promise<string>):Promise<string>{
  try{return await entryDeadline(read,'access-token',8000);}
  catch(error){
    if(error instanceof EntryError)throw error;
    const code=(error as {code?:unknown}|null)?.code;
    throw new EntryError('access-token',code==='auth/network-request-failed'?'transport':'authentication');
  }
}

/** One attempt, including response body. No automatic replay of POSTs. */
export async function entryRequest<T>(url:string,init:RequestInit,stage:EntryStage,ms=15000,fetcher:typeof fetch=fetch):Promise<T>{
  const controller=new AbortController();
  try{
    return await entryDeadline(async()=>{
      let response:Response;
      try{response=await fetcher(url,{...init,signal:controller.signal});}
      catch{throw new EntryError(stage,'transport');}
      let body:unknown;
      try{body=await response.json();}catch{/* Classify HTTP failures even when their body is HTML. */}
      if(!response.ok){
        const error=(body as {error?:{requestId?:unknown;code?:unknown}}|null)?.error;
        throw new EntryError(stage,response.status===408?'timeout':response.status===401?'authentication':response.status===403?'authorization':
          response.status===429?'quota':response.status>=500?'server':'invalid-response',
          {status:response.status,requestId:error?.requestId??response.headers.get('X-Request-Id'),serviceCode:error?.code});
      }
      if(body===undefined)throw new EntryError(stage,'invalid-response');
      return body as T;
    },stage,ms);
  }finally{controller.abort();}
}

export function entryErrorMessage(error:unknown):string|null{
  return error instanceof EntryError?error.message:null;
}
