import {useEffect,useRef,useState} from 'react';
import {AlertCircle,Expand,FileAudio,LoaderCircle,Minimize,RefreshCcw,Volume2,X} from 'lucide-react';
import {API_BASE_URL,appEnvironment} from '../../lib/environment';
import {useAuth} from '../auth/AuthProvider';
import {AppButton} from '../ui/AppButton';
import {useOverlayFocus} from './DriveLibraryUI';
import {authenticatedMedia} from './authenticated-media';
import {libraryPreviewCache} from './library-preview-cache';
import {messages} from './drive-api';
import {ReviewPdfViewer} from '../reviews/ReviewPdfViewer';
import {ReviewImageViewer} from '../reviews/ReviewImageViewer';

const imageLimit=24*1024*1024;
const mimeIsVideo=(mime?:string)=>Boolean(mime?.startsWith('video/'));
function validStreamEmbed(value:unknown):value is string{
 if(typeof value!=='string')return false;
 try{const u=new URL(value);return u.protocol==='https:'&&/^customer-[a-z0-9-]+\.cloudflarestream\.com$/.test(u.hostname)&&u.pathname.endsWith('/iframe');}catch{return false;}
}


/** Image previews reuse tab-memory bytes. PDFs and video/audio stream over the
 * existing authenticated same-origin media transport, without a full PDF blob
 * download or a public provider URL.
 */
export function LibraryAssetPreview({projectId,node,onClose}:{projectId:number;node:{id:string;name:string;mime_type?:string;source_revision?:string;revision?:number};onClose:()=>void}){
 const {user}=useAuth();
 const [expanded,setExpanded]=useState(false),[muted,setMuted]=useState(true);
 const videoRef=useRef<HTMLVideoElement>(null);
 // Optional DEV-only adaptive preview: no background transcoding or extra cost.
 const [optimized,setOptimized]=useState<{state:'absent'|'processing'|'ready'|'failed'|'unavailable';embedUrl?:string}>({state:'absent'});
 const [streamStart,setStreamStart]=useState(0);
 const [nativeFailed,setNativeFailed]=useState(false);
 const eligible=appEnvironment.appEnv==='dev'&&mimeIsVideo(node.mime_type);

 const networkRetryCount=useRef(0);
 const networkRetryTimer=useRef<ReturnType<typeof setTimeout>|null>(null);

 const dialog=useOverlayFocus(()=>{
  // The shared image viewer handles its own fullscreen Escape first.
  if(document.querySelector('.review-private-viewer.is-expanded'))return;
  if(expanded){setExpanded(false);return;}
  onClose();
 });
 const [url,setURL]=useState(''),[error,setError]=useState(''),[retry,setRetry]=useState(0),[loading,setLoading]=useState(true);
 const mime=node.mime_type||'';
 const image=mime.startsWith('image/'),pdf=mime==='application/pdf';
 const stream=pdf||mime.startsWith('audio/')||mime.startsWith('video/');
 useEffect(()=>{
  let alive=true,release:(()=>void)|undefined;
  const controller=new AbortController();
  setURL('');setError('');setLoading(true);setMuted(true);setNativeFailed(false);setStreamStart(0);
  if(!user){setLoading(false);setError('Entre novamente no Roteiva para abrir este arquivo.');return()=>controller.abort();}
  if(!image&&!stream){setLoading(false);return()=>controller.abort();}
  libraryPreviewCache.scope(user.uid);
  const cacheKey=[projectId,node.id,node.revision||0,node.source_revision||'',mime].join(':');
  async function load(){
   try{
    if(image){
     const cached=libraryPreviewCache.get(cacheKey);
     if(cached){if(alive)setURL(cached);return;}
     const local=await libraryPreviewCache.image(cacheKey,async()=>{
      const endpoint=API_BASE_URL+'/library/projects/'+projectId+'/nodes/'+node.id+'/content';
      let response:Response|null=null;
      for(let attempt=0;attempt<2;attempt++){
       const token=await user!.getIdToken(attempt>0);
       response=await fetch(endpoint,{method:'GET',headers:{Authorization:'Bearer '+token},cache:'no-store'});
       if(response.status!==401)break;
      }
      if(!response?.ok){
       const body=await response?.json().catch(()=>null) as {error?:{code?:string}}|null;
       throw new Error(messages[body?.error?.code||'']||'Não foi possível abrir o arquivo. Confira a conexão com o provedor.');
      }
      const contentType=(response.headers.get('Content-Type')||'').split(';')[0].trim().toLowerCase();
      if(!contentType.startsWith('image/'))throw new Error('O provedor respondeu com um formato de arquivo inesperado.');
      const declared=Number(response.headers.get('Content-Length')||0);
      if(declared>imageLimit){await response.body?.cancel();throw new Error('A imagem excede o limite de visualização.');}
      const blob=await response.blob();
      if(!blob.size||blob.size>imageLimit)throw new Error('A imagem retornada está vazia ou excede o limite da prévia.');
      return blob;
     });
     if(alive)setURL(local);
    }else{
     const media=await authenticatedMedia(projectId,node.id,()=>user!.getIdToken(),[user!.uid,node.revision||0,node.source_revision||''].join('|'));
     if(!alive){media.close();return;}
     release=media.close;setURL(media.url);
    }
   }catch(e){
    if(alive&&!controller.signal.aborted)setError(e instanceof Error?e.message:'Não foi possível carregar o arquivo.');
   }finally{if(alive)setLoading(false);}
  }
  void load();
  return()=>{alive=false;controller.abort();release?.();};
 },[user,projectId,node.id,node.revision,node.source_revision,mime,retry]);
 useEffect(()=>{
  networkRetryCount.current=0;
  return()=>{if(networkRetryTimer.current)clearTimeout(networkRetryTimer.current);networkRetryTimer.current=null;};
 },[url]);
 // Only opening a video can start the DEV optimization. The read-only GET is
 // cheap and reuses an already encoded revision; an absent revision is ingested
 // automatically once on the backend, never from a folder listing or prefetch.
 useEffect(()=>{
  if(!eligible||!user)return;
  let cancelled=false,timer:ReturnType<typeof setTimeout>|undefined;
  const began=Date.now();
  const endpoint=API_BASE_URL+'/library/projects/'+projectId+'/nodes/'+node.id+'/stream';
  setOptimized({state:'absent'});
  async function request(method:'GET'|'POST'){
   const response=await fetch(endpoint,{method,headers:{Authorization:'Bearer '+await user!.getIdToken()},cache:'no-store'});
   if(!response.ok)throw new Error('stream_unavailable');
   return response.json() as Promise<{state:string;embedUrl?:string}>;
  }
  async function check(){
   try{
    let data=await request('GET');
    if(cancelled)return;
    if(data.state==='absent')data=await request('POST');
    if(cancelled)return;
    if(data.state==='ready'&&validStreamEmbed(data.embedUrl)){
     const video=videoRef.current;
     setStreamStart(video&&Number.isFinite(video.currentTime)?Math.floor(video.currentTime):0);
     setOptimized({state:'ready',embedUrl:data.embedUrl});return;
    }
    if(data.state==='processing'&&Date.now()-began<10*60*1000){
     setOptimized({state:'processing'});timer=setTimeout(check,5000);return;
    }
    setOptimized({state:'unavailable'});
   }catch{if(!cancelled)setOptimized({state:'unavailable'});}
  }
  void check();
  return()=>{cancelled=true;if(timer)clearTimeout(timer);};
 },[eligible,user,projectId,node.id,node.source_revision]);
 useEffect(()=>{
  if(nativeFailed&&optimized.state==='unavailable'){
   setError('Não foi possível reproduzir o vídeo. Tente novamente.');
  }
 },[nativeFailed,optimized.state]);
 const fail=()=>{
  if(eligible&&optimized.state==='processing'){setNativeFailed(true);return;}
  setURL('');setError('O navegador não conseguiu reproduzir o arquivo. Tente novamente.');
 };
 const recoverVideo=(video:HTMLVideoElement)=>{
  // Network interruptions (MEDIA_ERR_NETWORK) can occur after the first frame.
  // Retry just once on the same authenticated URL; completed ranges remain
  // in the worker's short-lived memory cache. Codec errors fail immediately.
  if(video.error?.code!==2||networkRetryCount.current>=1){fail();return;}
  networkRetryCount.current++;
  const at=Number.isFinite(video.currentTime)?video.currentTime:0;
  networkRetryTimer.current=setTimeout(()=>{
   if(!video.isConnected)return;
   video.addEventListener('loadedmetadata',()=>{
    if(at>0&&Number.isFinite(video.duration)&&at<video.duration)video.currentTime=at;
    void video.play().catch(()=>{});
   },{once:true});
   video.load();
  },350);
 };
 return <div className="virtual-library-backdrop">
  <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label={'Prévia de '+node.name}
   className={'virtual-library-editor virtual-library-preview vl-preview-modal'+(expanded?' is-expanded':'')}>
   <header className="vl-preview-head">
    <h3 title={node.name}>{node.name}</h3>
    <div className="vl-preview-header-actions">
     {!image&&<AppButton className="vl-icon-action" type="button" aria-label={expanded?'Sair da tela cheia':'Visualizar em tela cheia'}
       title={expanded?'Sair da tela cheia':'Visualizar em tela cheia'} aria-pressed={expanded}
       onClick={()=>setExpanded(v=>!v)}>{expanded?<Minimize size={18} aria-hidden="true"/>:<Expand size={18} aria-hidden="true"/>}</AppButton>}
     <AppButton className="vl-icon-action" type="button" aria-label="Fechar prévia" title="Fechar prévia" onClick={onClose}><X size={19} aria-hidden="true"/></AppButton>
    </div>
   </header>
   <div className="vl-preview-body">
    {loading&&optimized.state!=='ready'?<div className="vl-preview-state" role="status"><LoaderCircle className="vl-loading" size={27}/><span>Carregando arquivo…</span></div>:
     error&&optimized.state!=='ready'?<div className="vl-preview-state vl-preview-failed" role="alert">
      <AlertCircle size={27} aria-hidden="true"/><p>{error}</p>
      <AppButton className="vl-preview-retry" type="button" onClick={()=>setRetry(n=>n+1)}><RefreshCcw size={16}/>Tentar novamente</AppButton>
     </div>:
     !url&&optimized.state!=='ready'?<div className="vl-preview-state"><p>Não há prévia integrada para este formato de arquivo.</p></div>:
     pdf?<div className="vl-preview-document"><ReviewPdfViewer src={url} name={node.name}/></div>:
     image?<ReviewImageViewer src={url} name={node.name} onError={fail}/>:
     mime.startsWith('video/')?<div className="vl-preview-media-stage">
      {optimized.state==='ready'&&optimized.embedUrl?
       <iframe className="vl-preview-stream-frame" src={optimized.embedUrl+(streamStart>1?'&startTime='+streamStart:'')} title={'Reprodução otimizada de '+node.name}
         allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin"/>:
       nativeFailed?<div className="vl-preview-state" role="status"><LoaderCircle className="vl-loading" size={27}/><span>Preparando reprodução contínua…</span></div>:
       <video ref={videoRef} className="vl-preview-video" src={url} controls autoPlay muted={muted}
        playsInline preload="auto" onLoadedData={event=>{if(event.currentTarget.paused)void event.currentTarget.play().catch(()=>{});}}
        onVolumeChange={event=>setMuted(event.currentTarget.muted)} onError={event=>recoverVideo(event.currentTarget)}/>}
      {optimized.state!=='ready'&&muted&&<AppButton className="vl-preview-unmute" type="button" onClick={()=>{
       if(!videoRef.current)return;videoRef.current.muted=false;setMuted(false);
       if(videoRef.current.paused)void videoRef.current.play().catch(()=>{});
      }}><Volume2 size={17} aria-hidden="true"/>Ativar som</AppButton>}

     </div>:
     <div className="vl-preview-audio-stage"><FileAudio size={40} aria-hidden="true"/>
      <span>{node.name}</span>
      <audio className="vl-preview-audio" src={url} controls preload="metadata" onError={fail}/>
     </div>}
   </div>
  </div>
 </div>;
}
