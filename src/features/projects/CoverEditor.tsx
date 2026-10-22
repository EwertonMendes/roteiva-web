import { AppSelect } from "../ui/AppSelect";
import {useCallback,useEffect,useRef,useState} from 'react';
import {ArrowLeft,Check,LoaderCircle,ChevronDown,Search,Trash2,X} from 'lucide-react';
import type {Project,ProjectCover} from '../../domain/workspace';
import {useDriveApi} from '../drive/drive-api';
import type {DriveItem} from '../drive/DriveLibraryUI';
import {DriveThumbnail} from '../drive/DriveThumbnail';
import {useDriveThumbnailFetch} from '../drive/useDriveThumbnailFetch';
import {useCoverImage,useDriveCovers} from './DriveCoversProvider';
import {CoverFrame} from './CoverFrame';
function CoverLoading({children}:{children:string}){return <div className="pc-loading-fill" role="status"><LoaderCircle size={25} className="pc-spin" aria-hidden="true"/><span>{children}</span></div>;}

type Page={files:DriveItem[];nextPageToken:string|null;incompleteSearch?:boolean};
export function CoverEditor({project,onClose,onSave}:{project:Project;onClose:()=>void;onSave:(cover:ProjectCover|undefined)=>void}){
 const context=useDriveCovers()!;const call=useDriveApi();const getThumbnail=useDriveThumbnailFetch();
 const dialog=useRef<HTMLDialogElement>(null);
 const existingConnection=context.connections.some(c=>c.id===project.cover?.connectionId);
 const [account,setAccount]=useState(existingConnection?project.cover!.connectionId:context.connections[0]?.id||'');
 const [cover,setCover]=useState<ProjectCover|undefined>(project.cover);
 const [choosing,setChoosing]=useState(!project.cover||!existingConnection);
 const [search,setSearch]=useState('');const [term,setTerm]=useState('');
 const [page,setPage]=useState<Page>({files:[],nextPageToken:null});const [busy,setBusy]=useState(true),[error,setError]=useState('');
 const [moreToken,setMoreToken]=useState('');const [retry,setRetry]=useState(0);const {src,error:imageError}=useCoverImage(cover);
 const currentAccount=context.connections.find(c=>c.id===account);
 const canRead=currentAccount?.scopes.split(' ').includes('https://www.googleapis.com/auth/drive.readonly');
 const thumbnail=useCallback((file:DriveItem,signal?:AbortSignal)=>getThumbnail(file,signal,account),[getThumbnail,account]);
 useEffect(()=>{const el=dialog.current!;el.showModal();const old=document.body.style.overflow;document.body.style.overflow='hidden';return ()=>{document.body.style.overflow=old;el.close();};},[]);
 useEffect(()=>{if(search.trim()===term)return;const timer=setTimeout(()=>{setPage({files:[],nextPageToken:null});setMoreToken('');setTerm(search.trim());},300);return ()=>clearTimeout(timer);},[search,term]);
 useEffect(()=>{
  if(!choosing||!account||!canRead)return;
  const controller=new AbortController();setBusy(true);setError('');
  const params=new URLSearchParams({search:term,...(moreToken?{pageToken:moreToken}:{})});
  void call<Page>('/integrations/drive/'+encodeURIComponent(account)+'/cover-images?'+params,'GET',undefined,controller.signal).then(data=>{if(!controller.signal.aborted)setPage(old=>({...data,files:moreToken?[...old.files,...data.files.filter(f=>!old.files.some(p=>p.id===f.id))]:data.files}));}).catch(e=>{if(!controller.signal.aborted)setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setBusy(false);});
  return ()=>controller.abort();
 },[account,canRead,choosing,term,moreToken,call,retry]);
 function select(file:DriveItem){setCover({connectionId:account,fileId:file.id,name:file.name,x:50,y:50,zoom:1});setChoosing(false);}
 return <dialog data-native-cursor ref={dialog} className="pc-dialog" aria-labelledby="pc-editor-title" onCancel={e=>{e.preventDefault();onClose();}} onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
  <header><div><span className="eyebrow">CAPA DO PROJETO</span><h2 id="pc-editor-title">{choosing?'Escolha uma imagem':'Encontre o melhor enquadramento'}</h2><p>{project.name}</p></div><button className="icon-button" type="button" onClick={onClose} aria-label="Fechar editor de capa"><X size={20}/></button></header>
  <div className={"pc-editor-body "+(choosing?"pc-editor-body--picker":"pc-editor-body--crop")}>
   {choosing?<>
    <div className="pc-picker-tools"><label>Conta do Drive<AppSelect aria-label="Conta do Drive" value={account} onValueChange={value=>{setAccount(value);setPage({files:[],nextPageToken:null});setMoreToken('');}}>{context.connections.map(c=><option key={c.id} value={c.id}>{c.google_email}</option>)}</AppSelect></label><label className="pc-image-search"><span>Buscar imagens no Drive</span><div><Search size={18}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Nome da imagem" maxLength={100}/></div></label></div>
    <p className="pc-helper">JPG, PNG, WebP ou AVIF de até 8 MB. O arquivo permanece privado no seu Drive.</p>
    {!canRead?<p role="status">Autorize a leitura do Drive na <a href="/biblioteca">Biblioteca</a> para escolher suas imagens.</p>:<>
     <div className="pc-picker-results" aria-busy={busy}>
     {error&&<p role="alert">{error} <button type="button" className="secondary-button" onClick={()=>{setRetry(n=>n+1);}}>Tentar novamente</button></p>}
     {busy&&!page.files.length?<CoverLoading>Carregando imagens…</CoverLoading>:<>
     <div className="pc-image-grid">{page.files.map(file=><button type="button" key={file.id} onClick={()=>select(file)} title={file.name}><DriveThumbnail item={file} scope={context.uid+':'+account} getThumbnail={thumbnail}/><span>{file.name}</span></button>)}</div>
     {!page.files.length&&!error&&<p className="pc-empty">Nenhuma imagem encontrada. Tente outro nome ou confira os formatos e tamanhos.</p>}
     </>}
     {page.incompleteSearch&&<p role="status">O Drive retornou resultados parciais. Refine a busca pelo nome.</p>}
     {page.nextPageToken&&<div className="pc-image-more"><button className="secondary-button" type="button" disabled={busy} onClick={()=>setMoreToken(page.nextPageToken!)}>{busy?<LoaderCircle size={18} className="pc-spin" aria-hidden="true"/>:<ChevronDown size={18} aria-hidden="true"/>}{busy?"Carregando imagens…":"Carregar mais imagens"}</button></div>}
     </div>
    </>}
   </>:cover?<>
    <button type="button" className="pc-text-button" onClick={()=>setChoosing(true)}><ArrowLeft size={16}/>Escolher outra imagem</button>
    <div className="pc-crop-content"><div className="pc-editor-preview" aria-busy={!src&&!imageError}>{src?<CoverFrame src={src} cover={cover} onChange={setCover}/>:imageError?<p className="pc-preview-error" role="alert">{imageError}</p>:<CoverLoading>Carregando imagem…</CoverLoading>}</div>
    <p id="pc-gesture-help" className="pc-helper pc-gesture-help">Arraste para reposicionar. Use a roda do mouse ou faça pinça para ajustar o zoom.<span> No teclado, use as setas para mover, + e − para ampliar e Home para redefinir.</span></p></div>
   </>:null}
  </div>
  <footer><div>{project.cover&&<button type="button" className="pc-text-button" onClick={()=>{onSave(undefined);onClose();}}><Trash2 size={16}/>Remover capa</button>}</div><button type="button" className="secondary-button" onClick={onClose}>Cancelar</button><button type="button" className="primary-button" disabled={choosing||!cover||!src||!!imageError} onClick={()=>{if(cover){onSave(cover);onClose();}}}><Check size={17}/>Salvar capa</button></footer>
 </dialog>;
}
