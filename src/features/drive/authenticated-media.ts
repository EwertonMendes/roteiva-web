import {API_BASE_URL} from '../../lib/environment';
const providers=new Map<string,{getToken:()=>Promise<string>;url:string}>();
let setup:Promise<void>|undefined;
let listening=false;
async function prepare(){
 if(!('serviceWorker' in navigator))throw new Error('Este navegador não permite a prévia protegida.');
 setup??=(async()=>{
 if(!listening){listening=true;navigator.serviceWorker.addEventListener('message',event=>{
 if(event.source!==navigator.serviceWorker.controller||event.data?.type!=='media-authorization'||!event.ports[0])return;
 const provider=providers.get(event.data.id),port=event.ports[0];
 if(!provider){port.postMessage({});return;}
 void provider.getToken().then(token=>port.postMessage({authorization:token?'Bearer '+token:'',url:provider.url})).catch(()=>port.postMessage({}));
 });}
 await navigator.serviceWorker.register('/roteiva-media-sw.js',{scope:'/',updateViaCache:'none'});
 await navigator.serviceWorker.ready;
 if(!navigator.serviceWorker.controller)await new Promise<void>((resolve,reject)=>{
 const changed=()=>{clearTimeout(timer);resolve();};
 const timer=setTimeout(()=>{navigator.serviceWorker.removeEventListener('controllerchange',changed);reject(new Error('Não foi possível preparar a prévia. Recarregue a página.'));},10000);
 navigator.serviceWorker.addEventListener('controllerchange',changed,{once:true});
 });
 })().catch(error=>{setup=undefined;throw error;});
 await setup;
}
function message(data:unknown):Promise<void>{
 return new Promise((resolve,reject)=>{
 const channel=new MessageChannel(),timer=setTimeout(()=>{channel.port1.close();reject(new Error('A prévia não respondeu. Tente novamente.'));},5000);
 channel.port1.onmessage=e=>{clearTimeout(timer);channel.port1.close();e.data?.ok?resolve():reject(new Error('Não foi possível abrir a prévia.'));};
 if(!navigator.serviceWorker.controller){clearTimeout(timer);reject(new Error('Recarregue a página para abrir a prévia.'));return;}
 navigator.serviceWorker.controller.postMessage(data,[channel.port2]);
 });
}
export async function authenticatedMedia(projectId:number,nodeId:string,getToken:()=>Promise<string>){
 return bindMedia(API_BASE_URL+'/library/projects/'+projectId+'/nodes/'+nodeId+'/content',getToken);
}
export async function authenticatedReviewMedia(url:string,getToken:()=>Promise<string>){
 if(!url.startsWith(API_BASE_URL+'/reviews/media?ticket='))throw new Error('Endereço de mídia inválido.');
 return bindMedia(url,getToken);
}
export async function authenticatedOwnerReviewMedia(reviewId:string,fileId:string,getToken:()=>Promise<string>){
 return bindMedia(API_BASE_URL+'/reviews/'+reviewId+'/content?fileId='+encodeURIComponent(fileId),getToken);
}
async function bindMedia(url:string,getToken:()=>Promise<string>){
 await prepare();const id=crypto.randomUUID();providers.set(id,{getToken,url});
 try{await message({type:'bind-media',id,url});}
 catch(error){providers.delete(id);throw error;}
 return {url:'/__roteiva_media/'+id,close:()=>{providers.delete(id);void message({type:'revoke-media',id}).catch(()=>{});}};
}
