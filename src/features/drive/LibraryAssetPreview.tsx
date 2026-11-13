import {useEffect,useState} from 'react';
import {AlertCircle,LoaderCircle,RefreshCcw,X} from 'lucide-react';
import {API_BASE_URL} from '../../lib/environment';
import {useAuth} from '../auth/AuthProvider';
import {AppButton} from '../ui/AppButton';
import {useOverlayFocus} from './DriveLibraryUI';
import {authenticatedMedia} from './authenticated-media';
import {messages} from './drive-api';
import {ReviewPdfViewer} from '../reviews/ReviewPdfViewer';

const imageLimit=24*1024*1024,pdfLimit=64*1024*1024;

/** Images and PDF are read directly with a short-lived Firebase bearer token.
 * No SW registration, additional page reload or publicly exposed provider URL is required.
 * Large video/audio retain the authenticated range-streaming service worker.
 */
export function LibraryAssetPreview({projectId,node,onClose}:{projectId:number;node:{id:string;name:string;mime_type?:string};onClose:()=>void}){
 const {user}=useAuth(),dialog=useOverlayFocus(onClose);
 const [url,setURL]=useState(''),[error,setError]=useState(''),[retry,setRetry]=useState(0),[loading,setLoading]=useState(true);
 const mime=node.mime_type||'';
 const image=mime.startsWith('image/'),pdf=mime==='application/pdf';
 const stream=mime.startsWith('audio/')||mime.startsWith('video/');
 useEffect(()=>{
  let alive=true,release:(()=>void)|undefined;
  const controller=new AbortController();
  setURL('');setError('');setLoading(true);
  if(!user){setLoading(false);setError('Entre novamente no Roteiva para abrir este arquivo.');return()=>controller.abort();}
  if(!image&&!pdf&&!stream){setLoading(false);return()=>controller.abort();}
  async function load(){
   try{
    if(image||pdf){
     const endpoint=API_BASE_URL+'/library/projects/'+projectId+'/nodes/'+node.id+'/content';
     let response:Response|null=null;
     for(let attempt=0;attempt<2;attempt++){
      const token=await user!.getIdToken(attempt>0);
      response=await fetch(endpoint,{method:'GET',headers:{Authorization:'Bearer '+token},signal:controller.signal,cache:'no-store'});
      if(response.status!==401)break;
     }
     if(!response?.ok){
      const body=await response?.json().catch(()=>null) as {error?:{code?:string}}|null;
      throw new Error(messages[body?.error?.code||'']||'Não foi possível abrir o arquivo. Confira a conexão com o provedor.');
     }
     const contentType=(response.headers.get('Content-Type')||'').split(';')[0].trim().toLowerCase();
     if(!(image&&contentType.startsWith('image/')||pdf&&contentType==='application/pdf'))
      throw new Error('O provedor respondeu com um formato de arquivo inesperado.');
     const limit=image?imageLimit:pdfLimit,declared=Number(response.headers.get('Content-Length')||0);
     if(declared>limit)throw new Error('O arquivo excede o limite da visualização protegida.');
     const blob=await response.blob();
     if(!blob.size||blob.size>limit)throw new Error('O arquivo retornado está vazio ou excede o limite da prévia.');
     if(!alive)return;
     const local=URL.createObjectURL(blob);release=()=>URL.revokeObjectURL(local);setURL(local);
    }else{
     const media=await authenticatedMedia(projectId,node.id,()=>user!.getIdToken());
     if(!alive){media.close();return;}
     release=media.close;setURL(media.url);
    }
   }catch(e){
    if(alive&&!controller.signal.aborted)setError(e instanceof Error?e.message:'Não foi possível preparar a prévia.');
   }finally{if(alive)setLoading(false);}
  }
  void load();
  return()=>{alive=false;controller.abort();release?.();};
 },[user,projectId,node.id,mime,retry]);
 const fail=()=>{setURL('');setError('O navegador não conseguiu reproduzir o arquivo. Tente novamente.');};
 return <div className="virtual-library-backdrop">
  <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label={'Prévia de '+node.name}
   className="virtual-library-editor virtual-library-preview vl-preview-modal">
   <header className="vl-preview-head">
    <h3 title={node.name}>{node.name}</h3>
    <AppButton className="vl-icon-action" type="button" aria-label="Fechar prévia" title="Fechar prévia" onClick={onClose}><X size={19} aria-hidden="true"/></AppButton>
   </header>
   <div className="vl-preview-body">
    {loading?<div className="vl-preview-state" role="status"><LoaderCircle className="vl-loading" size={27}/><span>Preparando prévia protegida…</span></div>:
     error?<div className="vl-preview-state vl-preview-failed" role="alert">
      <AlertCircle size={27} aria-hidden="true"/><p>{error}</p>
      <AppButton className="vl-preview-retry" type="button" onClick={()=>setRetry(n=>n+1)}><RefreshCcw size={16}/>Tentar novamente</AppButton>
     </div>:
     !url?<div className="vl-preview-state"><p>Não há prévia integrada para este formato de arquivo.</p></div>:
     pdf?<div className="vl-preview-document"><ReviewPdfViewer src={url} name={node.name}/></div>:
     image?<img className="vl-preview-image" src={url} alt={node.name} onError={fail}/>:
     mime.startsWith('video/')?<video className="vl-preview-video" src={url} controls playsInline preload="metadata" onError={fail}/>:
     <audio className="vl-preview-audio" src={url} controls preload="metadata" onError={fail}/>}
   </div>
  </div>
 </div>;
}
