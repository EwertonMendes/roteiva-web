import {useCallback,useEffect,useRef,useState} from 'react';
import {ChevronRight,Folder as FolderIcon,FolderOpen,LoaderCircle,MoveRight,X} from 'lucide-react';
import {AppButton} from '../ui/AppButton';
import {useDriveApi} from './drive-api';
import {useOverlayFocus} from './DriveLibraryUI';
import './library-dialog.css';

type FolderItem={id:string;name:string;kind:'folder'|'asset'};
type FolderPage={nodes:FolderItem[];trail:{id:string;name:string}[];nextPage:string|null};
type Source={id:string;name:string;parent_id:string|null;kind:'folder'|'asset'};
const ROOT={id:'root',name:'Arquivos'};

/** Select a virtual destination. No provider files are moved and no mutation is made until confirmation. */
export function MoveDestinationDialog({base,source,busy,onClose,onConfirm}:{
 base:string;source:Source;busy:boolean;onClose:()=>void;onConfirm:(destinationId:string)=>void;
}){
 const call=useDriveApi(),dialog=useOverlayFocus(()=>{if(!busy)onClose();});
 const [folder,setFolder]=useState('root'),[page,setPage]=useState<FolderPage|null>(null);
 const [loading,setLoading]=useState(true),[paging,setPaging]=useState(false),[error,setError]=useState('');
 const version=useRef(0);
 const load=useCallback(async(after?:string)=>{
  const current=++version.current,controller=new AbortController();
  if(!after){setLoading(true);setPage(null);}else setPaging(true);
  setError('');
  try{
   const params=new URLSearchParams({parent:folder,explorer:'1',...(after?{after}:{})});
   const response=await call<FolderPage>(base+'?'+params,'GET',undefined,controller.signal);
   if(current!==version.current)return;
   setPage(old=>after&&old?{...response,nodes:[...old.nodes,...response.nodes]}:response);
  }catch(e){
   if(current===version.current)setError(e instanceof Error?e.message:'Não foi possível carregar as pastas.');
  }finally{
   if(current===version.current){setLoading(false);setPaging(false);}
  }
 },[base,folder,call]);
 useEffect(()=>{void load();return()=>{++version.current;};},[load]);
 const trail=page?.trail?.length?page.trail:[ROOT];
 const blocked=folder===source.id||folder===source.parent_id||trail.some(x=>x.id===source.id);
 const childFolders=page?.nodes.filter(n=>n.kind==='folder'&&n.id!==source.id)||[];
 const canMove=Boolean(page)&&!loading&&!paging&&!error&&!blocked&&!busy;
 return <div className="lib-dialog-backdrop">
  <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="library-move-title" aria-describedby="library-move-description" className="lib-dialog lib-dialog--move">
   <header className="lib-dialog-header">
    <div><h3 id="library-move-title">Mover para</h3><p id="library-move-description">Escolha o destino para “{source.name}”.</p></div>
    <AppButton type="button" className="lib-icon-button" aria-label="Fechar" disabled={busy} onClick={onClose}><X size={18}/></AppButton>
   </header>
   <div className="lib-dialog-content">
    <nav aria-label="Pasta de destino" className="lib-breadcrumb">
     {trail.map((item,i)=><span key={item.id} className="lib-crumb">
      {i>0&&<ChevronRight size={15} aria-hidden="true"/>}
      <AppButton type="button" disabled={busy} aria-current={item.id===folder?'location':undefined} onClick={()=>setFolder(item.id)}>{item.name}</AppButton>
     </span>)}
    </nav>
    <div className="lib-folder-panel" aria-busy={loading||paging}>
     {loading?<div role="status" className="lib-dialog-loading"><LoaderCircle className="lib-spinner" size={20}/>Carregando pastas…</div>
      :error?<div role="alert" className="lib-message lib-message--error"><p>{error}</p><AppButton type="button" onClick={()=>void load()}>Tentar novamente</AppButton></div>
      :childFolders.length?<ul className="lib-folder-list">
       {childFolders.map(item=><li key={item.id}><AppButton type="button" className="lib-folder-entry" disabled={busy} onClick={()=>setFolder(item.id)}>
        <FolderIcon size={19} aria-hidden="true"/><span>{item.name}</span><ChevronRight size={17} aria-hidden="true"/></AppButton></li>)}
      </ul>:<div className="lib-message"><FolderOpen size={28} aria-hidden="true"/><p>Nenhuma subpasta disponível. Você pode escolher a pasta atual como destino.</p></div>}
     {page?.nextPage&&!loading&&<div className="lib-load-more"><AppButton type="button" disabled={paging||busy} onClick={()=>void load(page.nextPage!)}>{paging?'Carregando…':'Mostrar mais pastas'}</AppButton></div>}
    </div>
    {blocked&&!loading&&!error&&<p className="lib-destination-notice" role="status">
     {folder===source.parent_id?'Este item já está nesta pasta. Escolha outra.':'Não é possível mover uma pasta para ela mesma ou para uma subpasta.'}
    </p>}
    <p className="lib-destination-summary"><MoveRight size={16} aria-hidden="true"/> Destino: <strong>{trail.at(-1)?.name||'Arquivos'}</strong></p>
   </div>
   <footer className="lib-dialog-footer">
    <AppButton type="button" className="lib-secondary-button" disabled={busy} onClick={onClose}>Cancelar</AppButton>
    <AppButton type="button" className="lib-primary-button" disabled={!canMove} onClick={()=>onConfirm(folder)}>{busy?'Movendo…':'Mover para cá'}</AppButton>
   </footer>
  </div>
 </div>;
}
