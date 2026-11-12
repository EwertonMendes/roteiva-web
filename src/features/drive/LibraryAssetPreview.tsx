import {useEffect,useState} from 'react';
import {X} from 'lucide-react';
import {useAuth} from '../auth/AuthProvider';
import {AppButton} from '../ui/AppButton';
import {useOverlayFocus} from './DriveLibraryUI';
import {authenticatedMedia} from './authenticated-media';
import {ReviewPdfViewer} from '../reviews/ReviewPdfViewer';
export function LibraryAssetPreview({projectId,node,onClose}:{projectId:number;node:{id:string;name:string;mime_type?:string};onClose:()=>void}){
 const {user}=useAuth(),dialog=useOverlayFocus(onClose);
 const [url,setURL]=useState(''),[error,setError]=useState('');
 useEffect(()=>{
 if(!user)return;let alive=true,release:(()=>void)|undefined;
 void authenticatedMedia(projectId,node.id,()=>user.getIdToken()).then(result=>{if(!alive){result.close();return;}release=result.close;setURL(result.url);})
 .catch(e=>{if(alive)setError(e instanceof Error?e.message:'Não foi possível preparar a prévia.');});
 return()=>{alive=false;release?.();};
 },[user,projectId,node.id]);
 const mime=node.mime_type||'';
 const fail=()=>setError('O arquivo está indisponível ou o formato não pode ser reproduzido neste navegador. Feche a prévia e tente novamente.');
 return <div className="virtual-library-backdrop"><div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label={'Prévia de '+node.name} className="virtual-library-editor virtual-library-preview">
 <header className="vl-preview-head"><h3>{node.name}</h3><AppButton className="vl-icon-action" type="button" aria-label="Fechar prévia" title="Fechar prévia" onClick={onClose}><X size={20} aria-hidden="true"/></AppButton></header>
 {error?<p role="alert" className="virtual-library-error">{error}</p>:!url?<p role="status">Preparando prévia protegida…</p>:
 mime==='application/pdf'?<ReviewPdfViewer src={url} name={node.name}/>:mime.startsWith('image/')?<img src={url} alt={node.name} onError={fail}/>:mime.startsWith('video/')?<video src={url} controls playsInline preload="metadata" onError={fail}/>:mime.startsWith('audio/')?<audio src={url} controls preload="metadata" onError={fail}/>:<p>Este formato ainda não possui prévia integrada.</p>}
 </div></div>;
}
