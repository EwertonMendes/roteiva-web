import {useCallback,useState,type MouseEvent,type ReactNode} from 'react';
import {FolderOpen,LayoutGrid,List} from 'lucide-react';
import {AppButton} from '../ui/AppButton';
import {LibraryThumbnail} from './LibraryThumbnail';
import './library-explorer.css';

export type LibraryGalleryNode={
 id:string;name:string;kind:'folder'|'asset';revision?:number;
 provider?:string;connection_id?:string;file_id?:string;source_revision?:string;
 mime_type?:string;parent_name?:string;
};
export type LibraryLayout='list'|'grid';
const LAYOUT_KEY='roteiva-library-layout';

/** One layout preference and one file representation for Library and Project Detail. */
export function useLibraryLayout(){
 const [layout,setState]=useState<LibraryLayout>(()=>{
  try{return window.localStorage.getItem(LAYOUT_KEY)==='grid'?'grid':'list';}
  catch{return 'list';}
 });
 const setLayout=useCallback((next:LibraryLayout)=>{
  setState(next);
  try{window.localStorage.setItem(LAYOUT_KEY,next);}catch{/* private mode */}
 },[]);
 return [layout,setLayout] as const;
}
export function LibraryLayoutControl({layout,onChange}:{layout:LibraryLayout;onChange:(next:LibraryLayout)=>void}){
 return <div className="vl-layout-control" role="group" aria-label="Visualização dos arquivos">
  <AppButton type="button" aria-label="Exibir lista" aria-pressed={layout==='list'} onClick={()=>onChange('list')}><List size={18}/></AppButton>
  <AppButton type="button" aria-label="Exibir grade" aria-pressed={layout==='grid'} onClick={()=>onChange('grid')}><LayoutGrid size={18}/></AppButton>
 </div>;
}
type Props<T extends LibraryGalleryNode>={
 nodes:readonly T[];layout:LibraryLayout;uid:string;onOpen:(node:T)=>void;
 countLabel?:string;listLabel?:string;disabled?:boolean;activeMenuId?:string;
 searchAll?:boolean;renderActions?:(node:T)=>ReactNode;
 onContextMenu?:(node:T,event:MouseEvent<HTMLLIElement>)=>void;
};
export function LibraryNodeGallery<T extends LibraryGalleryNode>({
 nodes,layout,uid,onOpen,countLabel,listLabel='Arquivos e pastas',disabled=false,
 activeMenuId,searchAll=false,renderActions,onContextMenu
}:Props<T>){
 const renderNode=(node:T)=><li key={node.id} className="vl-explorer-item" data-kind={node.kind}
  data-menu-open={activeMenuId===node.id}
  onContextMenu={event=>onContextMenu?.(node,event)}>
  <AppButton type="button" className="vl-explorer-file" disabled={disabled}
   aria-label={node.name} title={node.name} onClick={()=>onOpen(node)}>
   <span className="vl-file-emblem">{node.kind==='folder'?<FolderOpen size={24}/>:
    <LibraryThumbnail node={node} uid={uid}/>}</span>
   <span className="vl-file-meta"><strong>{node.name}</strong><small>{
    searchAll?node.parent_name||'Arquivos':
    node.kind==='folder'?'Pasta':
    node.provider==='google_drive'?'Google Drive':
    node.provider==='dropbox'?'Dropbox':'Arquivo'
   }</small></span>
  </AppButton>
  {renderActions&&<div className="vl-menu-shell">{renderActions(node)}</div>}
 </li>;
 return <>
  {countLabel&&<div className="vl-explorer-count" role="status">{countLabel}</div>}
  {layout==='grid'?<div className="vl-drive-groups">
   {nodes.some(n=>n.kind==='folder')&&<section aria-label="Pastas" className="vl-drive-group vl-drive-folders">
    <h3>Pastas</h3><ul className="vl-explorer-items vl-explorer-items--grid vl-explorer-folders">{nodes.filter(n=>n.kind==='folder').map(renderNode)}</ul>
   </section>}
   {nodes.some(n=>n.kind==='asset')&&<section aria-label="Arquivos" className="vl-drive-group vl-drive-assets">
    <h3>Arquivos</h3><ul className="vl-explorer-items vl-explorer-items--grid vl-explorer-assets">{nodes.filter(n=>n.kind==='asset').map(renderNode)}</ul>
   </section>}
  </div>:<>
   <div className="vl-list-header" aria-hidden="true"><span>Nome</span>{renderActions&&<span>Ações</span>}</div>
   <ul className="vl-explorer-items vl-explorer-items--list" aria-label={listLabel}>{nodes.map(renderNode)}</ul>
  </>}
 </>;
}
