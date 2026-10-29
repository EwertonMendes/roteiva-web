import { AppSelect } from "../ui/AppSelect";
import {useCallback,useEffect,useRef,useState} from 'react';
import {ArrowLeft,Check,LoaderCircle,ChevronDown,Search,Trash2,X} from 'lucide-react';
import type {Project,ProjectCover,Client} from '../../domain/workspace';
import {useDriveApi} from '../drive/drive-api';
import type {DriveItem} from '../drive/DriveLibraryUI';
import {DriveThumbnail} from '../drive/DriveThumbnail';
import {useDriveThumbnailFetch} from '../drive/useDriveThumbnailFetch';
import {useCoverImage,useDriveCovers} from './DriveCoversProvider';
import {CoverFrame} from './CoverFrame';
import {useAuth} from '../auth/AuthProvider';
import {isStorageFolder} from '../drive/DriveLibraryUI';
import {Folder,ChevronRight} from 'lucide-react';
function CoverLoading({children}:{children:string}){return <div className="pc-loading-fill" role="status"><LoaderCircle size={25} className="pc-spin" aria-hidden="true"/><span>{children}</span></div>;}

type Page={files:DriveItem[];nextPageToken:string|null;incompleteSearch?:boolean};
export function CoverEditor({project,client,onClose,onSave}:{project?:Project;client?:Client;onClose:()=>void;onSave:(cover:ProjectCover|undefined)=>void}){
 const subject=client||project!;
 const context=useDriveCovers()!;const call=useDriveApi();const getDriveThumbnail=useDriveThumbnailFetch();
 const {user}=useAuth();
 const choices=context.connections.filter(c=>client||c.provider==='google_drive');
 const stored=client?.photo||project?.cover;
 const dialog=useRef<HTMLDialogElement>(null);
 const [account,setAccount]=useState(stored?.connectionId||'');
 const [cover,setCover]=useState<ProjectCover|undefined>(stored);
 const [choosing,setChoosing]=useState(!stored);
 const [folderTrail,setFolderTrail]=useState<{id:string;name:string}[]>([]);
 const driveBrowserVersion=useRef(new Map<string,number>());
 useEffect(()=>{
   if(!choices.length)return;
   if(!choices.some(c=>c.id===account))setAccount(choices[0].id);
 },[account,choices.map(c=>c.id).join('|')]);
 const [search,setSearch]=useState('');const [term,setTerm]=useState('');
 const [page,setPage]=useState<Page>({files:[],nextPageToken:null});const [busy,setBusy]=useState(true),[error,setError]=useState('');
 const [moreToken,setMoreToken]=useState('');const [retry,setRetry]=useState(0);const {src,error:imageError}=useCoverImage(cover);
 const storedConnectionAvailable=!cover||choices.some(c=>c.id===cover.connectionId&&c.provider===(cover.provider||'google_drive'));
 const currentAccount=choices.find(c=>c.id===account);
 const provider=currentAccount?.provider||'google_drive';
 const canRead=provider==='dropbox'||currentAccount?.scopes.split(' ').includes('https://www.googleapis.com/auth/drive.readonly');
 const thumbnail=useCallback(async(file:DriveItem,signal?:AbortSignal)=>{
   if(provider==='google_drive')return getDriveThumbnail(file,signal,account);
   if(!user)return null;
   const url='https://roteiva-api-dev.ewertonmendes9.workers.dev/integrations/dropbox/'+encodeURIComponent(account)+'/files/'+encodeURIComponent(file.id)+'/thumbnail';
   let response=await fetch(url,{headers:{Authorization:'Bearer '+await user.getIdToken()},signal,cache:'no-store'});
   if(response.status===401)response=await fetch(url,{headers:{Authorization:'Bearer '+await user.getIdToken(true)},signal,cache:'no-store'});
   if(!response.ok||response.status===204)return null;
   const blob=await response.blob();
   return blob.type.startsWith('image/')&&blob.size<=1024*1024?blob:null;
 },[getDriveThumbnail,provider,account,user]);
 useEffect(()=>{const el=dialog.current!;el.showModal();const old=document.body.style.overflow;document.body.style.overflow='hidden';return ()=>{document.body.style.overflow=old;el.close();};},[]);
 useEffect(()=>{if(search.trim()===term)return;const timer=setTimeout(()=>{setPage({files:[],nextPageToken:null});setMoreToken('');setTerm(search.trim());},300);return ()=>clearTimeout(timer);},[search,term]);
 useEffect(()=>{
  if(!choosing||!account||!canRead)return;
  const controller=new AbortController();setBusy(true);setError('');
  const request=async():Promise<Page>=>{
   if(provider==='dropbox'){
    const path='/integrations/dropbox/'+encodeURIComponent(account)+(folderTrail.length?'/folders/'+encodeURIComponent(folderTrail[folderTrail.length-1].id)+'/items':'/folders')+'?'+new URLSearchParams({
     ...(folderTrail.length?{}:{parentId:'root'}),...(term.length>=2?{search:term}:{}),...(moreToken?{pageToken:moreToken}:{})
    });
    return call<Page>(path,'GET',undefined,controller.signal);
   }
   const base='/integrations/drive/'+encodeURIComponent(account);
   const parent=folderTrail.length?folderTrail[folderTrail.length-1].id:'root';
   const knownVersion=driveBrowserVersion.current.get(account);
   const filter:Record<string,string>=term.length>=2?{search:term}:{};
   // Transitional capability detection: the currently deployed Worker may
   // support image search but not folder browsing on that same endpoint.
   if(knownVersion===1&&parent!=='root'){
    return call<Page>(base+'/folders/'+encodeURIComponent(parent)+'/items?'+new URLSearchParams({...filter,...(moreToken?{pageToken:moreToken}:{})}),'GET',undefined,controller.signal);
   }
   const tokenSet=knownVersion===1&&moreToken&&parent==='root'
     ?JSON.parse(moreToken) as {images:string|null;folders:string|null}
     :null;
   const needsImages=!tokenSet||!!tokenSet.images;
   const result:Page&{browserVersion?:number}=needsImages
     ?await call<Page&{browserVersion?:number}>(base+'/cover-images?'+new URLSearchParams({
       parentId:parent,...filter,...(tokenSet?.images?{pageToken:tokenSet.images}:!tokenSet&&moreToken?{pageToken:moreToken}:{})
      }),'GET',undefined,controller.signal)
     :{files:[],nextPageToken:null};
   if('browserVersion' in result&&result.browserVersion===2){
    driveBrowserVersion.current.set(account,2);
    return result;
   }
   driveBrowserVersion.current.set(account,1);
   if(parent!=='root'){
    return call<Page>(base+'/folders/'+encodeURIComponent(parent)+'/items?'+new URLSearchParams({...filter,...(moreToken?{pageToken:moreToken}:{})}),'GET',undefined,controller.signal);
   }
   const folders=(!tokenSet||tokenSet.folders)
    ?await call<{folders:DriveItem[];nextPageToken:string|null}>(base+'/folders?'+new URLSearchParams({
       parentId:'root',...(tokenSet?.folders?{pageToken:tokenSet.folders}:{})
      }),'GET',undefined,controller.signal)
    :{folders:[],nextPageToken:null};
   const items=[...folders.folders.filter(f=>!term||f.name.toLowerCase().includes(term.toLowerCase())),...result.files];
   const unique=[...new Map(items.map(f=>[f.id,f])).values()];
   const next={images:result.nextPageToken,folders:folders.nextPageToken};
   return {files:unique,nextPageToken:next.images||next.folders?JSON.stringify(next):null,
    incompleteSearch:result.incompleteSearch};
  };
  void request().then(data=>{
   if(!controller.signal.aborted)setPage(old=>({...data,files:moreToken?[...old.files,...data.files.filter(f=>!old.files.some(p=>p.id===f.id))]:data.files}));
  }).catch(e=>{if(!controller.signal.aborted)setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setBusy(false);});
  return ()=>controller.abort();
 },[account,provider,canRead,choosing,term,moreToken,folderTrail,call,retry]);
 const chooseFile=(file:DriveItem)=>{
   if(isStorageFolder(file.mimeType)){
     setFolderTrail(current=>[...current,{id:file.id,name:file.name}]);setTerm('');setSearch('');
     setPage({files:[],nextPageToken:null});setMoreToken('');return;
   }
   if(!['image/jpeg','image/png','image/webp',...(provider==='google_drive'?['image/avif']:[])].includes(file.mimeType))return;
   if(file.size!==undefined && (!Number.isFinite(Number(file.size))||Number(file.size)>8*1024*1024))return;
   setCover({provider,connectionId:account,fileId:file.id,name:file.name,x:50,y:50,zoom:1});setChoosing(false);
 };
 return <dialog data-native-cursor ref={dialog} className="pc-dialog" aria-labelledby="pc-editor-title" onCancel={e=>{e.preventDefault();onClose();}} onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
  <header><div><span className="eyebrow">{client?'FOTO DO CLIENTE':'CAPA DO PROJETO'}</span><h2 id="pc-editor-title">{choosing?'Escolha uma imagem':'Encontre o melhor enquadramento'}</h2><p>{subject.name}</p></div><button className="icon-button" type="button" onClick={onClose} aria-label="Fechar editor de capa"><X size={20}/></button></header>
  <div className={"pc-editor-body "+(choosing?"pc-editor-body--picker":"pc-editor-body--crop")}>
   {choosing?<>
    {context.loadingConnections&&<p className="pc-connection-status" role="status">Verificando Google Drive e Dropbox conectados…</p>}
    {context.error&&<div className="pc-connection-status pc-connection-status--warning" role="alert"><span>{context.error}</span><button type="button" className="secondary-button" disabled={context.loadingConnections} onClick={context.retryConnections}>Atualizar conexões</button></div>}
    {!context.loadingConnections&&!choices.length&&!context.error&&<p className="pc-connection-status" role="status">Nenhuma conta com acesso ativo. Conecte o Google Drive ou Dropbox na <a href="/biblioteca">Biblioteca</a>.</p>}
    <div className="pc-picker-tools"><label>Armazenamento<AppSelect aria-label="Conta de armazenamento" value={account} onValueChange={value=>{setAccount(value);setFolderTrail([]);setPage({files:[],nextPageToken:null});setMoreToken('');}}>{choices.map(c=><option key={c.id} value={c.id}>{c.provider==='dropbox'?'Dropbox · ':'Drive · '}{c.google_email}</option>)}</AppSelect></label><label className="pc-image-search"><span>Buscar imagens {provider==='dropbox'?'no Dropbox':'no Drive'}</span><div><Search size={18}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Nome da imagem" maxLength={100}/></div></label></div>
    <p className="pc-helper pc-picker-guidance">Escolha uma pasta ou uma imagem. JPG, PNG, WebP{provider==='google_drive'?' ou AVIF':''}, até 8 MB. Seus arquivos permanecem privados.</p>
    {folderTrail.length>0&&<nav className="pc-folder-trail" aria-label="Pasta de imagens"><button type="button" onClick={()=>{setFolderTrail([]);setPage({files:[],nextPageToken:null});setMoreToken('');}}>Meu {provider==='dropbox'?'Dropbox':'Drive'}</button>{folderTrail.map((folder,i)=><span key={folder.id}><ChevronRight size={14}/><button type="button" onClick={()=>{setFolderTrail(current=>current.slice(0,i+1));setPage({files:[],nextPageToken:null});setMoreToken('');}}>{folder.name}</button></span>)}</nav>}
    {!currentAccount?null:!canRead?<p role="status">Esta conexão do Google Drive não possui permissão de leitura de imagens. Reconecte a conta na <a href="/biblioteca">Biblioteca</a> e autorize o acesso de leitura.</p>:<>
     <div className="pc-picker-results" aria-busy={busy}>
     {error&&<p role="alert">{error} <button type="button" className="secondary-button" onClick={()=>{setRetry(n=>n+1);}}>Tentar novamente</button></p>}
     {busy&&!page.files.length?<CoverLoading>Carregando imagens…</CoverLoading>:<>
     <div className="pc-image-grid">{page.files.filter(file=>isStorageFolder(file.mimeType)||(['image/jpeg','image/png','image/webp',...(provider==='google_drive'?['image/avif']:[])].includes(file.mimeType)&&(file.size===undefined&&provider==='google_drive'||Number(file.size)>0&&Number(file.size)<=8*1024*1024))).map(file=><button type="button" key={file.id} onClick={()=>chooseFile(file)} title={file.name}>{isStorageFolder(file.mimeType)?<span className="pc-folder-icon"><Folder size={30}/></span>:<DriveThumbnail item={file} scope={context.uid+':'+account} getThumbnail={thumbnail}/>}<span>{file.name}</span></button>)}</div>
     {!page.files.length&&!error&&!busy&&<p className="pc-empty">{page.nextPageToken?'Nenhuma imagem compatível nesta página. Carregue mais itens para continuar.':'Nenhuma pasta ou imagem compatível encontrada. Tente outra pasta ou pesquisa.'}</p>}
     </>}
     {page.incompleteSearch&&<p role="status">O Drive retornou resultados parciais. Refine a busca pelo nome.</p>}
     {page.nextPageToken&&<div className="pc-image-more"><button className="secondary-button" type="button" disabled={busy} onClick={()=>setMoreToken(page.nextPageToken!)}>{busy?<LoaderCircle size={18} className="pc-spin" aria-hidden="true"/>:<ChevronDown size={18} aria-hidden="true"/>}{busy?"Carregando itens…":"Carregar mais itens"}</button></div>}
     </div>
    </>}
   </>:cover?<>
    <button type="button" className="pc-text-button" onClick={()=>setChoosing(true)}><ArrowLeft size={16}/>Escolher outra imagem</button>
    <div className="pc-crop-content"><div className={'pc-editor-preview'+(client?' pc-editor-preview--portrait':'')} aria-busy={!src&&!imageError}>{src?<CoverFrame src={src} cover={cover} onChange={setCover}/>:!storedConnectionAvailable?<p className="pc-preview-error" role="status">A conexão dessa imagem não está mais disponível. Escolha outra imagem ou reconecte sua conta na Biblioteca.</p>:imageError?<p className="pc-preview-error" role="alert">{imageError}</p>:<CoverLoading>Carregando imagem…</CoverLoading>}</div>
    <p id="pc-gesture-help" className="pc-helper pc-gesture-help">Arraste para reposicionar. Use a roda do mouse ou faça pinça para ajustar o zoom.<span> No teclado, use as setas para mover, + e − para ampliar e Home para redefinir.</span></p></div>
   </>:null}
  </div>
  <footer><div>{stored&&<button type="button" className="pc-text-button" onClick={()=>{onSave(undefined);onClose();}}><Trash2 size={16}/>{client?'Remover foto':'Remover capa'}</button>}</div><button type="button" className="secondary-button" onClick={onClose}>Cancelar</button><button type="button" className="primary-button" disabled={choosing||!cover||!src||!!imageError} onClick={()=>{if(cover){onSave(cover);onClose();}}}><Check size={17}/>{client?'Salvar foto':'Salvar capa'}</button></footer>
 </dialog>;
}
