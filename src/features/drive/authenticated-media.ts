import {API_BASE_URL} from '../../lib/environment';

const WORKER_PATH='/roteiva-media-sw.js';
// The query is a transport-protocol version, not a per-request cache buster.
// A version change replaces an older worker under the same '/' registration.
const WORKER_URL=WORKER_PATH+'?mediaProtocol=4';
const PUBLIC_MEDIA_ERROR='Não foi possível abrir este arquivo agora. Tente novamente.';
const providers=new Map<string,{getToken:()=>Promise<string>;getReviewSession?:()=>string;url:string;scope:string}>();
let setup:Promise<void>|undefined;
let listening=false;

function isExpectedWorker(worker:ServiceWorker|null):boolean{
 if(!worker)return false;
 try{
  const script=new URL(worker.scriptURL);
  return script.origin===location.origin&&script.pathname===WORKER_PATH&&script.searchParams.get('mediaProtocol')==='4';
 }catch{return false;}
}
function controllerIsReady():boolean{
 return isExpectedWorker(navigator.serviceWorker.controller);
}

/** Wait for the *newly activated* media worker, never issue a claim request to
 * the previous version which may not implement the current protocol. 
 * The active worker's activate event claims clients; this is a backup for
 * pages that were opened while the new registration was installing.
 */
async function awaitMediaControl(registration:ServiceWorkerRegistration):Promise<void>{
 if(controllerIsReady())return;
 await new Promise<void>((resolve,reject)=>{
  let finished=false;
  const observed=new Set<ServiceWorker>();
  let claimSent:ServiceWorker|null=null;
  const dispose=()=>{
   clearTimeout(timer);
   navigator.serviceWorker.removeEventListener('controllerchange',onController);
   registration.removeEventListener('updatefound',onUpdate);
   for(const worker of observed)worker.removeEventListener('statechange',onState);
  };
  const finish=(ready:boolean)=>{
   if(finished)return;
   finished=true;dispose();
   ready?resolve():reject(new Error(PUBLIC_MEDIA_ERROR));
  };
  const observe=(worker:ServiceWorker|null)=>{
   if(worker&&!observed.has(worker)){
    observed.add(worker);worker.addEventListener('statechange',onState);
   }
  };
  const attempt=()=>{
   if(controllerIsReady()){finish(true);return;}
   observe(registration.installing);
   observe(registration.waiting);
   observe(registration.active);
   const worker=registration.active;
   if(!worker||worker.state!=='activated'||!isExpectedWorker(worker)||claimSent===worker)return;
   claimSent=worker;
   const channel=new MessageChannel();
   const cleanup=setTimeout(()=>channel.port1.close(),1200);
   channel.port1.onmessage=()=>{
    clearTimeout(cleanup);channel.port1.close();
    if(controllerIsReady())finish(true);
   };
   try{worker.postMessage({type:'claim-media-clients'},[channel.port2]);}
   catch{clearTimeout(cleanup);channel.port1.close();}
  };
  const onController=()=>attempt();
  const onState=()=>attempt();
  const onUpdate=()=>attempt();
  const timer=setTimeout(()=>finish(controllerIsReady()),8000);
  navigator.serviceWorker.addEventListener('controllerchange',onController);
  registration.addEventListener('updatefound',onUpdate);
  attempt();
  // register() normally starts the upgrade. When an old active worker has no
  // replacement installing yet, ask the browser once to check the server.
  if(registration.active&&!isExpectedWorker(registration.active)&&!registration.installing){
   void registration.update().then(attempt).catch(()=>{});
  }
 });
}

async function prepare(){
 if(!('serviceWorker' in navigator))throw new Error(PUBLIC_MEDIA_ERROR);
 setup??=(async()=>{
  if(!listening){
   listening=true;
   navigator.serviceWorker.addEventListener('message',event=>{
    if(event.source!==navigator.serviceWorker.controller||event.data?.type!=='media-authorization'||!event.ports[0])return;
    const provider=providers.get(event.data.id),port=event.ports[0];
    if(!provider){port.postMessage({});return;}
    void provider.getToken()
     .then(token=>port.postMessage({authorization:token?'Bearer '+token:'',reviewSession:provider.getReviewSession?.(),url:provider.url,scope:provider.scope}))
     .catch(()=>port.postMessage({}));
   });
  }
  const registration=await navigator.serviceWorker.register(WORKER_URL,{scope:'/',updateViaCache:'none'});
  await awaitMediaControl(registration);
 })().catch(error=>{
  setup=undefined;
  // Only a category is logged: no filenames, accounts, tokens or provider URLs.
  console.warn('[Roteiva] A visualização de mídia não pôde ser inicializada.',{phase:'media-transport',kind:error instanceof TypeError?'browser':'activation'});
  throw new Error(PUBLIC_MEDIA_ERROR);
 });
 await setup;
}

function message(data:unknown):Promise<void>{
 return new Promise((resolve,reject)=>{
  const channel=new MessageChannel(),timer=setTimeout(()=>{
   channel.port1.close();reject(new Error(PUBLIC_MEDIA_ERROR));
  },3500);
  channel.port1.onmessage=e=>{
   clearTimeout(timer);channel.port1.close();
   e.data?.ok?resolve():reject(new Error(PUBLIC_MEDIA_ERROR));
  };
  if(!controllerIsReady()){
   clearTimeout(timer);channel.port1.close();
   reject(new Error(PUBLIC_MEDIA_ERROR));
   return;
  }
  navigator.serviceWorker.controller!.postMessage(data,[channel.port2]);
 });
}

/** Warm up once, without interrupting navigation. The interactive path retries. */
export function warmAuthenticatedMedia(){void prepare().catch(()=>{});}
export async function authenticatedMedia(projectId:number,nodeId:string,getToken:()=>Promise<string>,scope=''){
 return bindMedia(API_BASE_URL+'/library/projects/'+projectId+'/nodes/'+nodeId+'/content',getToken,undefined,scope);
}
/** Clear tab-scoped private media buffers when a user signs out or changes. */
export function clearAuthenticatedMediaCache(){
 if('caches' in window)for(const key of ['roteiva-private-media-v1','roteiva-private-media-v2'])void caches.delete(key).catch(()=>{});
 if(!('serviceWorker' in navigator))return;
 try{
  const channel=new MessageChannel();
  channel.port1.onmessage=()=>channel.port1.close();
  navigator.serviceWorker.controller?.postMessage({type:'clear-media-cache'},[channel.port2]);
 }catch{/* A missing controller has no reusable media buffers. */}
}
export async function authenticatedReviewMedia(url:string,getToken:()=>Promise<string>,getReviewSession:()=>string,scope=''){
 if(!url.startsWith(API_BASE_URL+'/reviews/media?ticket='))throw new Error('Endereço de mídia inválido.');
 return bindMedia(url,getToken,getReviewSession,scope);
}
export async function authenticatedOwnerReviewMedia(reviewId:string,fileId:string,getToken:()=>Promise<string>,scope=''){
 return bindMedia(API_BASE_URL+'/reviews/'+reviewId+'/content?fileId='+encodeURIComponent(fileId),getToken,undefined,scope);
}
async function bindMedia(url:string,getToken:()=>Promise<string>,getReviewSession?:()=>string,scope=''){
 await prepare();
 const id=crypto.randomUUID();
 providers.set(id,{getToken,url,getReviewSession,scope});
 try{await message({type:'bind-media',id,url,scope});}
 catch(error){providers.delete(id);throw error;}
 return {url:'/__roteiva_media/'+id,close:()=>{
  providers.delete(id);void message({type:'revoke-media',id}).catch(()=>{});
 }};
}
