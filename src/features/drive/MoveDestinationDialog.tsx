import {FolderInput as ModalFolderInput} from "lucide-react";
import {useCallback,useEffect,useRef,useState} from 'react';
import {ChevronRight,Folder as FolderIcon,FolderOpen,LoaderCircle,MoveRight} from 'lucide-react';
import {AppButton} from '../ui/AppButton';
import {useDriveApi} from './drive-api';
import {AppModal,AppModalHeader,AppModalBody,AppModalFooter} from '../ui/AppModal';
import './library-dialog.css';

type FolderItem={id:string;name:string;kind:'folder'|'asset'};
type FolderPage={nodes:FolderItem[];trail:{id:string;name:string}[];nextPage:string|null};
type Source={id:string;name:string;parent_id:string|null;kind:'folder'|'asset'};
const ROOT={id:'root',name:'Arquivos'};

/** Select a virtual destination. No provider files are moved and no mutation is made until confirmation. */
export function MoveDestinationDialog({base,source,busy,error:saveError,onClose,onConfirm}:{
 base:string;source:Source;busy:boolean;error?:string;onClose:()=>void;onConfirm:(destinationId:string)=>void;
}){
 const call=useDriveApi();
 const [folder,setFolder]=useState('root'),[page,setPage]=useState<FolderPage|null>(null);
 const [loading,setLoading]=useState(true),[paging,setPaging]=useState(false),[error,setError]=useState('');
 const version=useRef(0),active=useRef<AbortController|null>(null);
 const load=useCallback(async(after?:string)=>{
  const current=++version.current;active.current?.abort();const controller=new AbortController();active.current=controller;
  if(!after){setLoading(true);setPage(null);}else setPaging(true);
  setError('');
  try{
   const params=new URLSearchParams({parent:folder,explorer:'1',...(after?{after}:{})});
   const response=await call<FolderPage>(base+'?'+params,'GET',undefined,controller.signal);
   if(current!==version.current)return;
   setPage(old=>after&&old?{...response,nodes:[...old.nodes,...response.nodes]}:response);
  }catch(e){
   if(current===version.current&&!controller.signal.aborted)setError(e instanceof Error?e.message:'Não foi possível carregar as pastas.');
  }finally{
   if(current===version.current){setLoading(false);setPaging(false);}
  }
 },[base,folder,call]);
 useEffect(()=>{void load();return()=>{++version.current;active.current?.abort();};},[load]);
 const trail=page?.trail?.length?page.trail:[ROOT];
 const blocked=folder===source.id||folder===source.parent_id||trail.some(x=>x.id===source.id);
 const childFolders=page?.nodes.filter(n=>n.kind==='folder'&&n.id!==source.id)||[];
 const canMove=Boolean(page)&&!loading&&!paging&&!error&&!blocked&&!busy;
 return <AppModal size="medium" className="lib-dialog lib-dialog--move"
   onCloseRequest={()=>{if(!busy)onClose();}} aria-labelledby="library-move-title" aria-describedby="library-move-description">
   <div className="rt-modal__layout">
    <AppModalHeader icon={<ModalFolderInput size={26}/>} title="Mover para" titleId="library-move-title" descriptionId="library-move-description"
      description={<>Escolha o destino para “{source.name}”.</>} onClose={onClose} closeDisabled={busy}/>
    <AppModalBody className="lib-dialog-content">
    <nav aria-label="Pasta de destino" className="lib-breadcrumb">
     {trail.map((item,i)=><span key={item.id} className="lib-crumb">
      {i>0&&<ChevronRight size={15} aria-hidden="true"/>}
      <AppButton type="button" disabled={busy} aria-current={item.id===folder?'location':undefined} onClick={()=>setFolder(item.id)}>{item.name}</AppButton>
     </span>)}
    </nav>
    {saveError&&<div role="alert" className="lib-move-error">{saveError}</div>}
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
   </AppModalBody>
   <AppModalFooter className="lib-dialog-footer">
    <AppButton type="button" variant="secondary" disabled={busy} onClick={onClose}>Cancelar</AppButton>
    <AppButton type="button" variant="primary" disabled={!canMove} onClick={()=>onConfirm(folder)}>{busy?'Movendo…':'Mover para cá'}</AppButton>
   </AppModalFooter>
  </div>
 </AppModal>;
}
