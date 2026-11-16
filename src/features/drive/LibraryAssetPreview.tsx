import {useEffect,useRef,useState} from 'react';
import {AlertCircle,Expand,FileAudio,LoaderCircle,Minimize,RefreshCcw,Volume2,X} from 'lucide-react';
import {useAuth} from '../auth/AuthProvider';
import {AppButton} from '../ui/AppButton';
import {useOverlayFocus} from './DriveLibraryUI';
import {authenticatedMedia} from './authenticated-media';
import {ReviewPdfViewer} from '../reviews/ReviewPdfViewer';
import {ReviewImageViewer} from '../reviews/ReviewImageViewer';

/** Image previews reuse tab-memory bytes. PDFs and video/audio stream over the
 * existing authenticated same-origin media transport, without a full PDF blob
 * download or a public provider URL.
 */
export function LibraryAssetPreview({projectId,node,onClose}:{projectId:number;node:{id:string;name:string;mime_type?:string;source_revision?:string;revision?:number};onClose:()=>void}){
 const {user}=useAuth();
 const [expanded,setExpanded]=useState(false),[muted,setMuted]=useState(true);
 const videoRef=useRef<HTMLVideoElement>(null);
 const resumeVideoTime=useRef(0);
 const playbackDiagnosticTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const networkRetryCount=useRef(0);
 const networkRetryTimer=useRef<ReturnType<typeof setTimeout>|null>(null);

 const dialog=useOverlayFocus(()=>{
  // The shared image viewer handles its own fullscreen Escape first.
  if(document.querySelector('.review-private-viewer.is-expanded'))return;
  if(expanded){setExpanded(false);return;}
  onClose();
 });
 const clearPlaybackDiagnostic=()=>{
  if(playbackDiagnosticTimer.current!==null){clearTimeout(playbackDiagnosticTimer.current);playbackDiagnosticTimer.current=null;}
 };
 const checkPlaybackStall=(video:HTMLVideoElement)=>{
  clearPlaybackDiagnostic();
  if(video.paused||video.seeking)return;
  playbackDiagnosticTimer.current=setTimeout(()=>{
   if(!video.isConnected||video.paused||video.seeking)return;
   let ahead=0;
   for(let i=0;i<video.buffered.length;i++){
    if(video.buffered.start(i)<=video.currentTime&&video.currentTime<=video.buffered.end(i)){
     ahead=Math.max(0,video.buffered.end(i)-video.currentTime);break;
    }
   }
   const quality=video.getVideoPlaybackQuality?.();
   // Diagnostics stay in the user's browser. Never include media URL, file ID,
   // account, token or project data, nor transmit analytics to a server.
   console.info('[Roteiva] Diagnóstico local de reprodução',{
    currentSecond:Math.floor(video.currentTime),bufferedAheadSeconds:Math.round(ahead*10)/10,
    readyState:video.readyState,networkState:video.networkState,
    droppedVideoFrames:quality?.droppedVideoFrames??null,
    totalVideoFrames:quality?.totalVideoFrames??null,
   });
  },800);
 };
 useEffect(()=>()=>{clearPlaybackDiagnostic();},[]);
 const [url,setURL]=useState(''),[error,setError]=useState(''),[retry,setRetry]=useState(0),[loading,setLoading]=useState(true);
 const [imageLoaded,setImageLoaded]=useState(false);
 const mime=node.mime_type||'';
 const image=mime.startsWith('image/'),pdf=mime==='application/pdf';
 const stream=pdf||mime.startsWith('audio/')||mime.startsWith('video/');
 useEffect(()=>{
  let alive=true,release:(()=>void)|undefined;
  const controller=new AbortController();
  setURL('');setError('');setLoading(true);setImageLoaded(false);setMuted(true);resumeVideoTime.current=0;
  if(!user){setLoading(false);setError('Entre novamente no Roteiva para abrir este arquivo.');return()=>controller.abort();}
  if(!image&&!stream){setLoading(false);return()=>controller.abort();}
  async function load(){
   try{
    // Use the same tab-bound, identity-verified transport as native video.
    // The <img> can decode progressively; we do not wait for response.blob().
    // Small completed image responses are reused by the SW's private memory
    // cache on re-open, without keeping a durable copy of source bytes.
    const media=await authenticatedMedia(projectId,node.id,()=>user!.getIdToken(),
     [user!.uid,node.revision||0,node.source_revision||''].join('|'));
    if(!alive){media.close();return;}
    release=media.close;setURL(media.url);
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
 const fail=()=>{setURL('');setError(image?'Não foi possível exibir a imagem. Tente novamente.':'O navegador não conseguiu reproduzir o arquivo. Tente novamente.');};
 const recoverVideo=(video:HTMLVideoElement)=>{
  // Network interruptions (MEDIA_ERR_NETWORK) can occur after the first frame.
  // Retry just once on the same authenticated URL; completed ranges remain
  // in the worker's short-lived memory cache. Codec errors fail immediately.
  if(video.error?.code!==2||networkRetryCount.current>=1){fail();return;}
  networkRetryCount.current++;
  const at=Number.isFinite(video.currentTime)?video.currentTime:resumeVideoTime.current;
  resumeVideoTime.current=at;
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
    {loading?<div className="vl-preview-state" role="status"><LoaderCircle className="vl-loading" size={27}/><span>Carregando arquivo…</span></div>:
     error?<div className="vl-preview-state vl-preview-failed" role="alert">
      <AlertCircle size={27} aria-hidden="true"/><p>{error}</p>
      <AppButton className="vl-preview-retry" type="button" onClick={()=>setRetry(n=>n+1)}><RefreshCcw size={16}/>Tentar novamente</AppButton>
     </div>:
     !url?<div className="vl-preview-state"><p>Não há prévia integrada para este formato de arquivo.</p></div>:
     pdf?<div className="vl-preview-document"><ReviewPdfViewer src={url} name={node.name}/></div>:
     image?<div className="vl-preview-image-stage">
       <ReviewImageViewer src={url} name={node.name} onLoad={()=>setImageLoaded(true)} onError={fail}/>
       {!imageLoaded&&<span className="vl-preview-image-loading" role="status">Carregando imagem…</span>}
      </div>:
     mime.startsWith('video/')?<div className="vl-preview-media-stage">
      <video ref={videoRef} className="vl-preview-video" src={url} controls autoPlay muted={muted}
        onTimeUpdate={event=>{resumeVideoTime.current=event.currentTarget.currentTime;}}
        playsInline preload="auto" onLoadedData={event=>{if(event.currentTarget.paused)void event.currentTarget.play().catch(()=>{});}}
        onVolumeChange={event=>setMuted(event.currentTarget.muted)}
        onWaiting={event=>checkPlaybackStall(event.currentTarget)}
        onStalled={event=>checkPlaybackStall(event.currentTarget)}
        onPlaying={clearPlaybackDiagnostic}
        onError={event=>{clearPlaybackDiagnostic();recoverVideo(event.currentTarget);}}/>
      {muted&&<AppButton className="vl-preview-unmute" type="button" onClick={()=>{
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
