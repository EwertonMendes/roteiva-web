import { AppSelect } from "../ui/AppSelect";
import { useEffect, useRef, useState } from "react";
import {DriveThumbnail} from "./DriveThumbnail";
import { ArrowLeft, Check, ChevronLeft, ChevronRight, Grid2X2, List, ExternalLink, File, FileAudio, FileImage, FileText, FileVideo, Folder, FolderOpen, Link2, LoaderCircle, Search, X, MoreHorizontal, Upload } from "lucide-react";

export type DriveItem = {id:string;name:string;mimeType:string;size?:string;modifiedTime?:string;thumbnailLink?:string;thumbnailTicket?:string;thumbnailFallback?:boolean;webViewLink?:string;pathDisplay?:string};
export type DriveTrail = {id:string;name:string};
export const DRIVE_FOLDER = "application/vnd.google-apps.folder";
export const DROPBOX_FOLDER = "application/vnd.roteiva.folder";
export const isStorageFolder=(mime:string)=>mime===DRIVE_FOLDER||mime===DROPBOX_FOLDER;

export function driveKindIcon(mime:string) {
  return isStorageFolder(mime) ? Folder : mime.startsWith("video/") ? FileVideo :
    mime.startsWith("image/") ? FileImage : mime.startsWith("audio/") ? FileAudio :
    mime.includes("pdf") || mime.includes("document") ? FileText : File;
}
export function readableSize(value?:string) {
  if(value==null || value==="") return "";
  const size=Number(value);
  if(!Number.isFinite(size) || size<0) return "";
  if(size>=1e9) return (size/1e9).toFixed(1)+" GB";
  if(size>=1e6) return (size/1e6).toFixed(1)+" MB";
  return Math.max(1,Math.ceil(size/1000))+" KB";
}
export function driveFileUrl(file:DriveItem) {
  const fallback="https://drive.google.com/file/d/"+encodeURIComponent(file.id)+"/view";
  if(!file.webViewLink) return fallback;
  try {
    const url=new URL(file.webViewLink);
    if(url.protocol==="https:" && (url.hostname==="google.com" || url.hostname.endsWith(".google.com"))) return url.toString();
  }catch{ /* fall through to a trusted Google Drive URL */ }
  return fallback;
}
export const isPreviewable=(item:DriveItem)=>!isStorageFolder(item.mimeType) && !item.mimeType.startsWith("application/vnd.google-apps.");
export function readableFileType(mime:string){
  if(isStorageFolder(mime))return "Pasta";
  if(mime==="application/pdf")return "PDF";
  if(mime.startsWith("image/"))return "Imagem";
  if(mime.startsWith("video/"))return "Vídeo";
  if(mime.startsWith("audio/"))return "Áudio";
  if(mime==="application/vnd.google-apps.document")return "Documento Google";
  if(mime==="application/vnd.google-apps.spreadsheet")return "Planilha Google";
  if(mime==="application/vnd.google-apps.presentation")return "Apresentação Google";
  if(mime.includes("presentation")||mime.includes("powerpoint"))return "Apresentação";
  if(mime.includes("spreadsheet")||mime.includes("excel"))return "Planilha";
  if(mime.includes("document")||mime.includes("word")||mime==="application/msword"||mime==="application/rtf")return "Documento";
  return "Arquivo";
}


/** Keep overlays keyboard accessible and prevent the page behind them from scrolling. */
export function useOverlayFocus(onClose:()=>void,enabled=true,overlayKey?:string) {
  const dialogRef=useRef<HTMLDivElement>(null);
  const closeRef=useRef(onClose);
  closeRef.current=onClose;
  useEffect(()=>{
    if(!enabled)return;
    const previous=document.activeElement instanceof HTMLElement?document.activeElement:null;
    const oldOverflow=document.body.style.overflow;
    document.body.style.overflow="hidden";
    dialogRef.current?.focus();
    function onKeyDown(event:KeyboardEvent){
      if(event.key==="Escape"){event.preventDefault();closeRef.current();return;}
      if(event.key!=="Tab")return;
      const dialog=dialogRef.current;
      if(!dialog)return;
      const focusable=[...dialog.querySelectorAll<HTMLElement>('button:not([disabled]),[href],input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])')]
        .filter(el=>el.getClientRects().length>0);
      if(!focusable.length){event.preventDefault();dialog.focus();return;}
      const first=focusable[0],last=focusable[focusable.length-1];
      if(event.shiftKey && (document.activeElement===first || document.activeElement===dialog)){event.preventDefault();last.focus();}
      else if(!event.shiftKey && document.activeElement===last){event.preventDefault();first.focus();}
    }
    document.addEventListener("keydown",onKeyDown);
    return ()=>{document.removeEventListener("keydown",onKeyDown);document.body.style.overflow=oldOverflow;previous?.focus();};
  },[enabled,overlayKey]);
  return dialogRef;
}

export type FolderPickerProps={
  /** Provider-specific actions; theme and structure are shared. */
  provider?:'google_drive'|'dropbox';
  onRetry?:()=>void;
  onLinkCurrent?:(folder:DriveItem)=>Promise<boolean>;
  projects:readonly {id:number;name:string}[];
  projectId?:number;
  onProjectChange:(id:string)=>void;
  folders:DriveItem[];
  path:DriveTrail[];
  loading:boolean;
  working:boolean;
  canRead:boolean;
  hasMore:boolean;
  mode?:"root"|"all";
  onModeChange?:(mode:"root"|"all")=>void;
  linkedIds:ReadonlySet<string>;
  error:string;
  onNavigate:(id:string,path:DriveTrail[])=>void;
  onMore:()=>void;
  onLink:(items:DriveItem[])=>Promise<boolean>;
  onConnect:()=>void;
  onClose:()=>void;
};
export function StorageFolderPicker({provider='google_drive',projects,projectId,onProjectChange,folders,path,loading,working,canRead,hasMore,mode='root',onModeChange,linkedIds,error,onNavigate,onMore,onLink,onConnect,onClose,onRetry,onLinkCurrent}:FolderPickerProps){
  const providerName=provider==='dropbox'?'Dropbox':'Google Drive';
  const [chosen,setChosen]=useState<Record<string,DriveItem>>({});
  const [filter,setFilter]=useState("");
  const [submitting,setSubmitting]=useState(false);
  const ref=useOverlayFocus(()=>{if(!working&&!submitting)onClose();});
  useEffect(()=>{setChosen({});setFilter("");},[projectId]);
  const selected=Object.values(chosen).filter(f=>!linkedIds.has(f.id));
  const currentFolder=path.at(-1);
  const canLinkCurrent=provider==='dropbox'&&!!onLinkCurrent&&!!projectId&&!!currentFolder&&!linkedIds.has(currentFolder.id);
  const visible=folders.filter(f=>f.name.toLocaleLowerCase("pt-BR").includes(filter.toLocaleLowerCase("pt-BR")));
  async function commit(){
    if(!selected.length || !projectId || submitting || working || loading)return;
    setSubmitting(true);
    try{if(await onLink(selected)) onClose();}finally{setSubmitting(false);}
  }
  async function linkCurrent(){
    if(!canLinkCurrent||!currentFolder||!onLinkCurrent||submitting||working||loading)return;
    setSubmitting(true);
    try{if(await onLinkCurrent({...currentFolder,mimeType:DROPBOX_FOLDER}))onClose();}
    finally{setSubmitting(false);}
  }
  return <div className="rl-overlay" onMouseDown={event=>{if(event.target===event.currentTarget && !working && !submitting)onClose();}}>
    <div className="rl-picker" ref={ref} role="dialog" aria-modal="true" aria-label={"Selecionar pastas do "+providerName} tabIndex={-1}>
      <header className="rl-picker-head"><div><h2>Vincular pastas</h2><p>Escolha as pastas que deseja organizar no projeto. Os arquivos continuam no {providerName}.</p></div>
        <button className="rl-icon-button" type="button" onClick={onClose} aria-label="Fechar seletor" disabled={working||submitting}><X size={18}/></button></header>
      <div className="rl-picker-context">
        <label htmlFor="rl-picker-project">Projeto de destino</label>
        <AppSelect id="rl-picker-project" aria-label="Projeto para vincular pastas" value={projectId??""} onValueChange={value=>onProjectChange(value)} disabled={working||submitting}>
          <option value="">Selecione um projeto</option>{projects.map(project=><option key={project.id} value={project.id}>{project.name}</option>)}
        </AppSelect>
      </div>
      {!projectId?<div className="rl-picker-empty"><FolderOpen size={30}/><p>Escolha um projeto para carregar suas pastas do {providerName}.</p></div>
      :!canRead?<div className="rl-picker-empty"><Link2 size={30}/><p>É necessário autorizar a leitura das pastas existentes na sua conta Google.</p><button className="primary-button" type="button" onClick={onConnect} disabled={working}>Autorizar Google Drive</button></div>
      :<>
        {provider==='google_drive'&&<div className="rl-picker-modes" role="group" aria-label="Local de pesquisa">
          <button type="button" aria-pressed={mode==="root"} onClick={()=>onModeChange?.("root")} disabled={loading}>Meu Drive</button>
          <button type="button" aria-pressed={mode==="all"} onClick={()=>onModeChange?.("all")} disabled={loading}>Todas as pastas</button>
        </div>}
        <nav className="rl-breadcrumbs" aria-label={"Localização no "+providerName}>{path.map((entry,i)=><span key={entry.id}>
          {i>0&&<ChevronRight size={13}/>}
          <button type="button" onClick={()=>onNavigate(entry.id,path.slice(0,i+1))} disabled={loading}>{entry.name}</button>
        </span>)}</nav>
        <label className="rl-search"><Search size={17}/><input aria-label="Filtrar pastas carregadas" placeholder="Filtrar pastas desta página" value={filter} onChange={e=>setFilter(e.target.value)}/>{filter&&<button type="button" onClick={()=>setFilter("")} aria-label="Limpar filtro"><X size={15}/></button>}</label>
        <div className="rl-picker-list" role="group" aria-label="Pastas disponíveis">
          {loading && !folders.length ? <p className="rl-empty" role="status"><LoaderCircle size={18} className="rl-spin"/> Buscando pastas…</p> : null}
          {visible.map(folder=>{
            const linked=linkedIds.has(folder.id);
            return <div className="rl-picker-row" key={folder.id}>
              <button type="button" className="rl-folder-enter" title={"Abrir "+folder.name} onClick={()=>{setFilter("");onNavigate(folder.id,[...path,{id:folder.id,name:folder.name}]);}} disabled={loading}>
                <Folder size={19}/><span>{folder.name}</span><ChevronRight size={15}/>
              </button>
              {linked?<span className="rl-linked"><Check size={14}/> Vinculada</span>:
              <label className="rl-check" title={"Selecionar "+folder.name}>
                <input type="checkbox" aria-label={"Selecionar "+folder.name} checked={!!chosen[folder.id]} disabled={submitting} onChange={e=>setChosen(current=>{
                  const next={...current};if(e.target.checked)next[folder.id]=folder;else delete next[folder.id];return next;
                })}/>
              </label>}
            </div>;
          })}
          {!loading&&!visible.length&&<p className="rl-empty">{filter?"Nenhuma pasta corresponde ao filtro nesta página.":"Nenhuma pasta encontrada nesta localização."}</p>}
          {hasMore&&<button className="rl-load-more" type="button" disabled={loading} onClick={onMore}>Carregar mais pastas</button>}
        </div>
        <p className="rl-picker-note">A seleção permanece ao navegar entre pastas. O filtro considera apenas os resultados carregados.</p>
      </>}
      {error&&<div role="alert" className="rl-error rl-picker-error"><span>{error}</span>{onRetry&&<button type="button" className="secondary-button" onClick={onRetry} disabled={loading||working||submitting}>Tentar novamente</button>}</div>}
      <footer className="rl-picker-footer"><span>{selected.length} {selected.length===1?"pasta selecionada":"pastas selecionadas"}</span>
        <div><button type="button" className="secondary-button" onClick={onClose} disabled={working||submitting}>Cancelar</button>
           {canLinkCurrent&&<button type="button" className="secondary-button" onClick={()=>void linkCurrent()} disabled={loading||working||submitting}>Vincular pasta atual</button>}
          <button type="button" className="primary-button" onClick={()=>void commit()} disabled={!projectId||!selected.length||!canRead||working||submitting||loading}>{submitting?"Vinculando…":selected.length?`Vincular ${selected.length} ${selected.length===1?"pasta":"pastas"}`:"Vincular pastas"}</button>
        </div>
      </footer>
    </div>
  </div>;
}

type ExplorerProps={
  folderName?:string;
  path:DriveTrail[];
  files:DriveItem[];
  loading:boolean;
  hasMore:boolean;
  thumbnailScope?:string;
  getThumbnail?:(file:DriveItem,signal?:AbortSignal,accountId?:string)=>Promise<Blob|null>;
  searchResults?:DriveItem[];
  searchTerm?:string;
  searchLoading?:boolean;
  onSearchChange?:(text:string)=>void;
  onBack:()=>void;
  onNavigate:(id:string,path:DriveTrail[])=>void;
  onOpen:(file:DriveItem)=>void;
  onMore:()=>void;
  onUploadFiles?:(files:File[])=>void;
  uploadDisabled?:boolean;
  provider?:'google_drive'|'dropbox';
  externalUrl?:(file:DriveItem)=>string;
};
type ViewMode="list"|"grid";
const VIEW_KEY="roteiva-drive-view-v1";
function savedView():ViewMode{
  try{return window.localStorage.getItem(VIEW_KEY)==="grid"?"grid":"list";}catch{return "list";}
}
const noThumbnail=async (_:DriveItem):Promise<Blob|null>=>null;
export function DriveFileExplorer({folderName,path,files,loading,hasMore,thumbnailScope="",getThumbnail=noThumbnail,searchResults,searchTerm,searchLoading=false,onSearchChange,onBack,onNavigate,onOpen,onMore,onUploadFiles,uploadDisabled=false,provider='google_drive',externalUrl=driveFileUrl}:ExplorerProps){
  const providerName=provider==='dropbox'?'Dropbox':'Google Drive';
  const [filter,setFilter]=useState("");
  const [dragging,setDragging]=useState(false);
  const uploadInput=useRef<HTMLInputElement>(null);
  const [view,setView]=useState<ViewMode>(savedView);
  useEffect(()=>setFilter(""),[path.map(item=>item.id).join("/")]);
  function changeView(next:ViewMode){
    setView(next);
    try{localStorage.setItem(VIEW_KEY,next);}catch{/* UX preference can remain in memory */}
  }
  const source=searchResults && searchTerm?.trim()===filter.trim()?searchResults:files;
  const visible=source.filter(f=>f.name.toLocaleLowerCase("pt-BR").includes(filter.toLocaleLowerCase("pt-BR")));
  const makeRow=(file:DriveItem)=>{
    const isFolder=isStorageFolder(file.mimeType);
    return <div className="rl-file-row" key={file.id}>
      <button type="button" className="rl-file-open" title={file.name} onClick={()=>onOpen(file)} disabled={loading}>
        <DriveThumbnail item={file} scope={thumbnailScope} getThumbnail={getThumbnail}/>
        <span className="rl-file-name">{file.name}<small>{isFolder?"Subpasta":readableFileType(file.mimeType)}{!isFolder&&readableSize(file.size)?" · "+readableSize(file.size):""}</small></span>
      </button>
      <time>{file.modifiedTime?new Date(file.modifiedTime).toLocaleDateString("pt-BR"):"—"}</time>
      <span className="rl-file-size">{readableSize(file.size)||"—"}</span>
      <details className="rl-menu"><summary title={"Opções de "+file.name} aria-label={"Opções de "+file.name}><MoreHorizontal size={19}/></summary>
        <div className="rl-menu-items">
          <button type="button" onClick={()=>onOpen(file)}>{isFolder?"Abrir pasta":isPreviewable(file)?"Visualizar":"Abrir no "+providerName}</button>
          <a href={externalUrl(file)} target="_blank" rel="noreferrer"><ExternalLink size={14}/> Abrir no {providerName}</a>
        </div>
      </details>
    </div>;
  };
  const acceptsFiles=(event:React.DragEvent)=>Boolean(folderName&&onUploadFiles&&!uploadDisabled&&
    Array.from(event.dataTransfer.types).includes("Files"));
  return <section className="rl-content" aria-label="Arquivos da pasta" data-upload-dragging={dragging}
    onDragOver={event=>{if(!acceptsFiles(event))return;event.preventDefault();event.dataTransfer.dropEffect="copy";setDragging(true);}}
    onDragLeave={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node))setDragging(false);}}
    onDrop={event=>{setDragging(false);if(!acceptsFiles(event))return;event.preventDefault();onUploadFiles?.(Array.from(event.dataTransfer.files));}}> 
    {dragging&&<div className="rl-drop-layer" aria-hidden="true"><Upload size={32}/><strong>Solte para enviar ao {providerName}</strong></div>}
    {folderName?<><header className="rl-content-head">
      <button type="button" className="rl-back" onClick={onBack} aria-label="Voltar para as pastas"><ArrowLeft size={18}/></button>
      <nav className="rl-breadcrumbs" aria-label="Caminho da pasta">{path.map((part,index)=><span key={part.id}>
        {index>0&&<ChevronRight size={14}/>}
        <button type="button" onClick={()=>onNavigate(part.id,path.slice(0,index+1))} disabled={loading} aria-current={index===path.length-1?"location":undefined}>{part.name}</button>
      </span>)}</nav>
      <span className="rl-file-count">{files.length} {files.length===1?"item carregado":"itens carregados"}</span>
    </header>
    <div className="rl-content-tools">
      <label className="rl-search"><Search size={16}/><input aria-label="Filtrar arquivos carregados" placeholder="Filtrar itens desta pasta" value={filter} onChange={e=>{setFilter(e.target.value);onSearchChange?.(e.target.value);}}/>{filter&&<button type="button" onClick={()=>setFilter("")} aria-label="Limpar filtro"><X size={15}/></button>}</label>
      {onUploadFiles&&<>
        <input className="rl-upload-input" ref={uploadInput} type="file" multiple aria-label="Selecionar arquivos para enviar" tabIndex={-1}
          onChange={event=>{const chosen=Array.from(event.target.files||[]);event.target.value="";if(chosen.length)onUploadFiles(chosen);}}/>
        <button className="rl-upload-button" aria-label="Enviar arquivos" type="button" disabled={uploadDisabled||loading} onClick={()=>uploadInput.current?.click()}>
          <Upload size={16}/> <span>Enviar arquivos</span>
        </button>
      </>}
      <div className="rl-view-switch" role="group" aria-label="Modo de visualização">
        <button type="button" title="Visualização em lista" aria-label="Visualização em lista" aria-pressed={view==="list"} onClick={()=>changeView("list")}><List size={17}/></button>
        <button type="button" title="Visualização em grade" aria-label="Visualização em grade" aria-pressed={view==="grid"} onClick={()=>changeView("grid")}><Grid2X2 size={17}/></button>
      </div>
    </div>
    {view==="list"&&<div className="rl-file-head" aria-hidden="true"><span>Nome</span><span>Modificado</span><span>Tamanho</span><span/></div>}
    <div className="rl-files" data-view={view}>
      {loading&&!files.length&&<div className="rl-state" role="status"><LoaderCircle size={23} className="rl-spin"/><p>Carregando arquivos…</p></div>}
      {searchLoading&&<span className="rl-search-progress" role="status">Buscando no {providerName}…</span>}
      {visible.map(makeRow)}
      {!loading&&!searchLoading&&!visible.length&&<div className="rl-state"><FolderOpen size={27}/><p>{filter?"Nenhum item corresponde à busca.":"Esta pasta está vazia."}</p></div>}
      {hasMore&&<button type="button" className="rl-load-more" onClick={onMore} disabled={loading}>Carregar mais arquivos</button>}
    </div>
    </>:<div className="rl-state rl-intro"><FolderOpen size={32}/><h3>Selecione uma pasta</h3><p>Escolha uma pasta à esquerda para visualizar seus arquivos.</p></div>}
  </section>;
}

export function DrivePreview({item,onClose,onPrevious,onNext,position,total}:{item:DriveItem;onClose:()=>void;onPrevious?:()=>void;onNext?:()=>void;position?:number;total?:number}){
  const ref=useOverlayFocus(onClose);
  useEffect(()=>{
    const onKey=(event:KeyboardEvent)=>{
      if(event.altKey||event.ctrlKey||event.metaKey)return;
      const target=event.target;
      if(target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))return;
      if(event.key==="ArrowLeft"&&onPrevious){event.preventDefault();onPrevious();}
      if(event.key==="ArrowRight"&&onNext){event.preventDefault();onNext();}
    };
    document.addEventListener("keydown",onKey);
    return ()=>document.removeEventListener("keydown",onKey);
  },[onPrevious,onNext]);
  return <div className="rl-overlay rl-preview-overlay" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}>
    <div className="rl-preview" ref={ref} role="dialog" aria-modal="true" aria-label={"Prévia de "+item.name} tabIndex={-1}>
      <header><div className="rl-preview-title"><strong title={item.name}>{item.name}</strong><small>{readableFileType(item.mimeType)}{position&&total?" · "+position+" de "+total:""}</small></div>
        <div><a className="secondary-button" href={driveFileUrl(item)} target="_blank" rel="noreferrer"><ExternalLink size={15}/> Abrir no Drive</a><button type="button" className="rl-icon-button" onClick={onClose} aria-label="Fechar prévia"><X size={18}/></button></div></header>
      <div className="rl-preview-body">
        {onPrevious&&<button type="button" className="rl-preview-nav rl-preview-nav-prev" onClick={onPrevious} aria-label="Visualizar arquivo anterior"><ChevronLeft size={21}/></button>}
        <iframe key={item.id} title={"Prévia de "+item.name} referrerPolicy="no-referrer" allow="fullscreen" src={"https://drive.google.com/file/d/"+encodeURIComponent(item.id)+"/preview"}/>
        {onNext&&<button type="button" className="rl-preview-nav rl-preview-nav-next" onClick={onNext} aria-label="Visualizar próximo arquivo"><ChevronRight size={21}/></button>}
      </div>
      <p>A prévia depende das permissões do Google Drive. Se não carregar, use “Abrir no Drive”.</p>
    </div>
  </div>;
}

export function DriveUnlinkConfirm({name,onCancel,onConfirm,busy}:{name:string;onCancel:()=>void;onConfirm:()=>void;busy:boolean}){
  const ref=useOverlayFocus(onCancel);
  return <div className="rl-overlay"><div className="rl-confirm" role="dialog" aria-modal="true" aria-label="Desvincular pasta" ref={ref} tabIndex={-1}>
    <h2>Desvincular “{name}”?</h2><p>A pasta deixará de aparecer neste projeto. Nenhum arquivo será apagado do seu Google Drive.</p>
    <footer><button className="secondary-button" type="button" disabled={busy} onClick={onCancel}>Manter pasta</button><button className="primary-button" type="button" disabled={busy} onClick={onConfirm}>{busy?"Desvinculando…":"Desvincular"}</button></footer>
  </div></div>;
}
