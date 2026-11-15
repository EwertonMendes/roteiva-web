import {API_BASE_URL} from '../../lib/environment';

const WORKER_PATH='/roteiva-media-sw.js';
const providers=new Map<string,{getToken:()=>Promise<string>;getReviewSession?:()=>string;url:string}>();
let setup:Promise<void>|undefined;
let listening=false;

function controllerIsReady():boolean{
 const controller=navigator.serviceWorker.controller;
 return !!controller&&controller.scriptURL===new URL(WORKER_PATH,location.origin).href;
}

/** An active SW may not yet control an already-open page. Explicitly request
 * control instead of waiting ten seconds and asking users to reload.
 */
async function claimCurrentPage(registration:ServiceWorkerRegistration):Promise<void>{
 if(controllerIsReady())return;
 await new Promise<void>((resolve,reject)=>{
  let finished=false;
  const complete=(error?:Error)=>{
   if(finished)return;
   finished=true;clearTimeout(timer);
   navigator.serviceWorker.removeEventListener('controllerchange',onControllerChange);
   if(error)reject(error);else resolve();
  };
  const onControllerChange=()=>{if(controllerIsReady())complete();};
  const timer=setTimeout(()=>{
   if(controllerIsReady())complete();
   else complete(new Error('Não foi possível iniciar o visualizador de mídia neste navegador. Verifique se os Service Workers estão habilitados e tente novamente.'));
  },4000);
  navigator.serviceWorker.addEventListener('controllerchange',onControllerChange);
  if(controllerIsReady()){complete();return;}
  const worker=registration.active;
  if(!worker){complete(new Error('Não foi possível ativar o visualizador de mídia. Tente novamente.'));return;}
  // No bearer token or provider identity crosses this control handshake.
  const channel=new MessageChannel();
  channel.port1.onmessage=event=>{
   channel.port1.close();
   if(event.data?.ok===false)complete(new Error('Não foi possível ativar o visualizador de mídia.'));
   else onControllerChange();
  };
  try{worker.postMessage({type:'claim-media-clients'},[channel.port2]);}
  catch{channel.port1.close();complete(new Error('Não foi possível comunicar com o visualizador de mídia.'));}
 });
}

async function prepare(){
 if(!('serviceWorker' in navigator))throw new Error('Este navegador não oferece suporte à reprodução integrada.');
 setup??=(async()=>{
  if(!listening){
   listening=true;
   navigator.serviceWorker.addEventListener('message',event=>{
    if(event.source!==navigator.serviceWorker.controller||event.data?.type!=='media-authorization'||!event.ports[0])return;
    const provider=providers.get(event.data.id),port=event.ports[0];
    if(!provider){port.postMessage({});return;}
    void provider.getToken()
     .then(token=>port.postMessage({authorization:token?'Bearer '+token:'',reviewSession:provider.getReviewSession?.(),url:provider.url}))
     .catch(()=>port.postMessage({}));
   });
  }
  const registration=await navigator.serviceWorker.register(WORKER_PATH,{scope:'/',updateViaCache:'none'});
  // An active registration is not necessarily controlling the current document.
  const active=registration.active?registration:await navigator.serviceWorker.ready;
  await claimCurrentPage(active);
 })().catch(error=>{setup=undefined;throw error;});
 await setup;
}

function message(data:unknown):Promise<void>{
 return new Promise((resolve,reject)=>{
  const channel=new MessageChannel(),timer=setTimeout(()=>{
   channel.port1.close();reject(new Error('Não foi possível iniciar o arquivo. Tente novamente.'));
  },3500);
  channel.port1.onmessage=e=>{
   clearTimeout(timer);channel.port1.close();
   e.data?.ok?resolve():reject(new Error('Não foi possível iniciar o arquivo.'));
  };
  if(!controllerIsReady()){
   clearTimeout(timer);channel.port1.close();
   reject(new Error('O visualizador de mídia perdeu a conexão. Tente abrir o arquivo novamente.'));
   return;
  }
  navigator.serviceWorker.controller!.postMessage(data,[channel.port2]);
}

/** Warm up once, without interrupting navigation. The interactive path retries. */
export function warmAuthenticatedMedia(){void prepare().catch(()=>{});}
export async function authenticatedMedia(projectId:number,nodeId:string,getToken:()=>Promise<string>){
 return bindMedia(API_BASE_URL+'/library/projects/'+projectId+'/nodes/'+nodeId+'/content',getToken);
}
export async function authenticatedReviewMedia(url:string,getToken:()=>Promise<string>,getReviewSession:()=>string){
 if(!url.startsWith(API_BASE_URL+'/reviews/media?ticket='))throw new Error('Endereço de mídia inválido.');
 return bindMedia(url,getToken,getReviewSession);
}
export async function authenticatedOwnerReviewMedia(reviewId:string,fileId:string,getToken:()=>Promise<string>){
 return bindMedia(API_BASE_URL+'/reviews/'+reviewId+'/content?fileId='+encodeURIComponent(fileId),getToken);
}
async function bindMedia(url:string,getToken:()=>Promise<string>,getReviewSession?:()=>string){
 await prepare();
 const id=crypto.randomUUID();
 providers.set(id,{getToken,url,getReviewSession});
 try{await message({type:'bind-media',id,url});}
 catch(error){providers.delete(id);throw error;}
 return {url:'/__roteiva_media/'+id,close:()=>{
  providers.delete(id);void message({type:'revoke-media',id}).catch(()=>{});
 }};
}
