import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {ChevronRight,File,FileAudio,FileImage,FileText,FileVideo,Folder,Search,X} from 'lucide-react';
import {AppButton} from '../ui/AppButton';
import {AppInput} from '../ui/AppInput';
import {useDriveApi} from './drive-api';
import {useOverlayFocus,type DriveItem} from './DriveLibraryUI';
import {useAuth} from '../auth/AuthProvider';
import {cacheKey,getCachedFolder,setCachedFolder,onceFolderRequest} from './storage-folder-cache';
import {LibraryLoadingRows} from './LibraryLoadingRows';
import './library-dialog.css';
type Item={id:string;name:string;isFolder:boolean};
type Page={files:Item[];nextPageToken:string|null};
const MAX_SELECTED=100;
function fileIcon(name:string){
 const ext=name.split('.').at(-1)?.toLowerCase();
 if(['png','jpg','jpeg','webp','gif','avif'].includes(ext||''))return FileImage;
 if(['mp4','mov','webm','avi','mkv'].includes(ext||''))return FileVideo;
 if(['m4a','mp3','wav','ogg','flac'].includes(ext||''))return FileAudio;
 if(['pdf','doc','docx','txt','ppt','pptx'].includes(ext||''))return FileText;
 return File;
}
/** Provider metadata stays cached by owner and connection; selected items survive folder navigation. */
export function DropboxLibraryPicker({connectionId,onClose,onSelect,includeFolders=false}:{connectionId:string;onClose:()=>void;onSelect:(ids:string[],names:Map<string,string>,folders:Set<string>)=>void;includeFolders?:boolean}){
 const call=useDriveApi(),dialog=useOverlayFocus(onClose),{user}=useAuth();
 const [trail,setTrail]=useState([{id:'root',name:'Meu Dropbox'}]),[loaded,setPage]=useState<(Page&{scope:string})|null>(null);
 const [selected,setSelected]=useState<Map<string,string>>(new Map()),[loading,setLoading]=useState(true),[paging,setPaging]=useState(false);
 const [error,setError]=useState(''),[filter,setFilter]=useState('');
 const generation=useRef(0),selectedFolders=useRef(new Set<string>());
 const folder=trail.at(-1)!.id,scope=cacheKey(user?.uid||'anonymous',connectionId,folder,'library-picker','','dropbox');
 const stored=getCachedFolder(scope);
 const page=loaded?.scope===scope?loaded:stored?{files:stored.files as unknown as Item[],nextPageToken:stored.nextPageToken,scope}:null;
 const load=useCallback(async(cursor?:string)=>{
  const request=++generation.current,cached=getCachedFolder(scope);
  if(!cursor&&cached&&Date.now()-cached.fetchedAt<45_000){
   setPage({files:cached.files as unknown as Item[],nextPageToken:cached.nextPageToken,scope});setLoading(false);setError('');return;
  }
  if(cursor)setPaging(true);else if(!cached)setLoading(true);
  setError('');
  try{
   const endpoint='/integrations/dropbox/'+connectionId+'/folders/'+encodeURIComponent(folder)+'/items'+
    (cursor?'?pageToken='+encodeURIComponent(cursor):'');
   const result=await onceFolderRequest(scope+':'+(cursor||'first'),()=>call<Page>(endpoint));
   if(request!==generation.current)return;
   const previous=cursor?getCachedFolder(scope)?.files as Item[]|undefined:undefined;
   const next={...result,scope,files:cursor?[...(previous||[]),...result.files]:result.files};
   setCachedFolder(scope,{files:next.files as unknown as DriveItem[],nextPageToken:next.nextPageToken});setPage(next);
  }catch(e){if(request===generation.current)setError(e instanceof Error?e.message:'Não foi possível abrir esta pasta.');}
  finally{if(request===generation.current){setLoading(false);setPaging(false);}}
 },[call,connectionId,folder,scope]);
 useEffect(()=>{
  const cached=getCachedFolder(scope);
  setPage(cached?{files:cached.files as unknown as Item[],nextPageToken:cached.nextPageToken,scope}:null);
  setFilter('');setLoading(!cached);void load();
  return()=>{++generation.current;};
 },[load,scope]);
 const shown=useMemo(()=>{
  const needle=filter.trim().toLocaleLowerCase('pt-BR');
  return [...(page?.files||[])].filter(x=>!needle||x.name.toLocaleLowerCase('pt-BR').includes(needle))
   .sort((a,b)=>Number(b.isFolder)-Number(a.isFolder)||a.name.localeCompare(b.name,'pt-BR',{numeric:true,sensitivity:'base'}));
 },[page?.files,filter]);
 function toggle(item:Item){
  if(!selected.has(item.id)&&selected.size>=MAX_SELECTED)return;
  setSelected(prev=>{
   const next=new Map(prev);
   if(next.has(item.id)){next.delete(item.id);selectedFolders.current.delete(item.id);}
   else{next.set(item.id,item.name);if(item.isFolder)selectedFolders.current.add(item.id);}
   return next;
  });
 }
 function chooseFolder(id:string,name:string){setTrail(old=>[...old,{id,name}]);}
 return <div className="lib-dialog-backdrop">
  <div ref={dialog} tabIndex={-1} className="lib-dialog lib-dialog--dropbox" role="dialog" aria-modal="true" aria-labelledby="dropbox-library-title" aria-describedby="dropbox-library-description">
   <header className="lib-dialog-header">
    <div><h3 id="dropbox-library-title">{includeFolders?'Importar do Dropbox':'Adicionar do Dropbox'}</h3>
     <p id="dropbox-library-description">{includeFolders?'Selecione pastas ou arquivos. As subpastas serão conferidas antes da importação.':'Escolha arquivos para adicionar à Biblioteca.'} Os originais não serão alterados.</p></div>
    <AppButton type="button" aria-label="Fechar seletor Dropbox" className="lib-icon-button" onClick={onClose}><X size={18}/></AppButton>
   </header>
   <div className="lib-dialog-content">
    <nav aria-label="Pastas do Dropbox" className="lib-breadcrumb">
     {trail.map((item,i)=><span className="lib-crumb" key={item.id}>{i>0&&<ChevronRight size={15} aria-hidden="true"/>}
      <AppButton type="button" aria-current={i===trail.length-1?'location':undefined} onClick={()=>setTrail(items=>items.slice(0,i+1))}>{item.name}</AppButton></span>)}
    </nav>
    <label className="lib-picker-search"><Search size={18} aria-hidden="true"/>
     <AppInput type="search" value={filter} onChange={e=>setFilter(e.target.value)} aria-label="Filtrar itens carregados" placeholder="Filtrar nesta pasta…" autoComplete="off"/></label>
    {page?.nextPageToken&&filter&&<p className="lib-picker-note">Filtro aplicado apenas aos itens carregados. Use “Carregar mais” para ver os próximos.</p>}
    <div className="lib-picker-list" aria-busy={loading||paging}>
     {loading&&!page?<LibraryLoadingRows count={5} label="Carregando pasta do Dropbox…"/>:error&&!page?
      <div role="alert" className="lib-message lib-message--error"><p>{error}</p><AppButton type="button" onClick={()=>void load()}>Tentar novamente</AppButton></div>:
      shown.length?<ul className="lib-browser-list">
       {shown.map(item=><li key={item.id} className={'lib-picker-row '+(item.isFolder?'lib-picker-row--folder':'lib-picker-row--file')}>
        {item.isFolder?<>
         {includeFolders&&<label className="lib-picker-select"><AppInput type="checkbox" aria-label={'Selecionar pasta '+item.name}
          checked={selected.has(item.id)} disabled={!selected.has(item.id)&&selected.size>=MAX_SELECTED} onChange={()=>toggle(item)}/></label>}
         <AppButton type="button" className="lib-picker-entry" onClick={()=>chooseFolder(item.id,item.name)}>
          <Folder size={20} aria-hidden="true"/><span>{item.name}</span><ChevronRight size={16} aria-hidden="true"/></AppButton>
        </>:<label><AppInput type="checkbox" aria-label={item.name} checked={selected.has(item.id)}
          disabled={!selected.has(item.id)&&selected.size>=MAX_SELECTED} onChange={()=>toggle(item)}/>
          {(()=>{const Icon=fileIcon(item.name);return <Icon size={19} aria-hidden="true"/>;})()}<span title={item.name}>{item.name}</span></label>}
       </li>)}
      </ul>:<div className="lib-message"><Folder size={27} aria-hidden="true"/><p>{filter?'Nenhum item carregado corresponde à pesquisa.':'Esta pasta está vazia.'}</p></div>}
     {page?.nextPageToken&&!loading&&<div className="lib-load-more"><AppButton type="button" disabled={paging} onClick={()=>void load(page.nextPageToken!)}>{paging?'Carregando…':'Carregar mais'}</AppButton></div>}
    </div>
    {error&&page&&<div role="alert" className="lib-picker-error">{error} <AppButton type="button" onClick={()=>void load()}>Tentar novamente</AppButton></div>}
    {loading&&page&&<p role="status" className="lib-picker-note">Atualizando pasta…</p>}
   </div>
   <footer className="lib-dialog-footer"><span role="status" className="lib-picker-count"><strong>{selected.size}</strong> de {MAX_SELECTED} selecionados</span>
    <AppButton type="button" className="lib-secondary-button" onClick={onClose}>Cancelar</AppButton>
    <AppButton type="button" className="lib-primary-button" disabled={!selected.size} onClick={()=>onSelect([...selected.keys()],selected,new Set(selectedFolders.current))}>Adicionar selecionados</AppButton>
   </footer>
  </div>
 </div>;
}
