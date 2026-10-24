import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {Check,ChevronDown,ChevronRight,Cloud,ExternalLink,FolderOpen,LoaderCircle,Plus,RefreshCw,ShieldCheck,Unplug,X} from 'lucide-react';
import type {Project} from '../../domain/workspace';
import {AppSelect} from '../ui/AppSelect';
import {useAuth} from '../auth/AuthProvider';
import {useDriveApi} from '../drive/drive-api';
import {DriveFileExplorer,DROPBOX_FOLDER,isStorageFolder,useOverlayFocus,type DriveItem,type DriveTrail} from '../drive/DriveLibraryUI';
import {ReviewImageViewer} from '../reviews/ReviewImageViewer';
import {clearDriveThumbnailCache} from '../drive/DriveThumbnail';
import {useDriveTransfers} from '../drive/DriveTransfersProvider';
import {dropboxFolderLinkId,linkDropboxFolder,readDropboxLinks,unlinkDropboxFolder,type DropboxFolderLink} from '../../data/dropbox-folder-links';
import '../drive/drive-library.css';
import './dropbox.css';
const API='https://roteiva-api-dev.ewertonmendes9.workers.dev';
type Connection={id:string;email:string;status:'connected'|'reconnect_required'|'revocation_pending';scopes:string};
type Page={folder:{id:string;name:string};files:DriveItem[];nextPageToken:string|null};
type PreviewTicket={url:string;mimeType:string;expiresAt:number;size:number};
type FolderPickerProps={folders:DriveItem[];path:DriveTrail[];projectId?:number;loading:boolean;hasMore:boolean;
 linkedIds:Set<string>;onClose:()=>void;onEnter:(folder:DriveItem)=>void;onNavigate:(trail:DriveTrail[])=>void;
 onMore:()=>void;onLink:(folder:{id:string;name:string})=>void};
function DropboxFolderPicker({folders,path,projectId,loading,hasMore,linkedIds,onClose,onEnter,onNavigate,onMore,onLink}:FolderPickerProps){
 const ref=useOverlayFocus(onClose);
 const active=path.at(-1)||{id:'root',name:'Meu Dropbox'};
 return <div className="rl-overlay" onMouseDown={event=>{if(event.target===event.currentTarget)onClose()}}>
  <section className="db-picker" ref={ref} role="dialog" aria-modal="true" aria-label="Vincular pasta Dropbox" tabIndex={-1}>
   <header><div><h3>Vincular pasta do Dropbox</h3><p>Escolha uma pasta para usar nos projetos. Seus arquivos continuam no Dropbox.</p></div>
    <button type="button" className="rl-icon-button" aria-label="Fechar" onClick={onClose}><X size={18}/></button></header>
   <nav className="db-crumbs" aria-label="Caminho">{path.map((node,index)=>
    <button key={node.id} type="button" onClick={()=>onNavigate(path.slice(0,index+1))}>{node.name}{index<path.length-1&&<ChevronRight size={13}/>}</button>)}</nav>
   <div className="db-picker-body">
    {loading&&!folders.length?<p role="status"><LoaderCircle size={17} className="rl-spin"/> Carregando pastas…</p>:null}
    {!loading&&!folders.length?<p>Esta pasta não possui subpastas.</p>:null}
    {folders.filter(f=>isStorageFolder(f.mimeType)).map(f=><div className="db-pick-row" key={f.id}>
      <button type="button" onClick={()=>onEnter(f)}><FolderOpen size={19}/><span>{f.name}</span><ChevronRight size={16}/></button>
      <button type="button" className="secondary-button" disabled={!projectId||linkedIds.has(f.id)} onClick={()=>onLink(f)}>
       {linkedIds.has(f.id)?<><Check size={14}/> Vinculada</>:<><Plus size={14}/> Vincular</>}
      </button>
    </div>)}
    {hasMore&&<button className="secondary-button" type="button" disabled={loading} onClick={onMore}>Carregar mais pastas</button>}
   </div>
   <footer><small>{projectId?'Pasta vinculada apenas ao projeto selecionado.':'Selecione um projeto antes de vincular uma pasta.'}</small>
    <button type="button" disabled={!projectId||linkedIds.has(active.id)} className="primary-button" onClick={()=>onLink(active)}>
      <Plus size={16}/> Vincular pasta atual
    </button>
   </footer>
  </section>
 </div>;
}
function DropboxPreview({file,link,onClose,onNext,onPrevious}:{file:DriveItem;link:DropboxFolderLink;onClose:()=>void;onNext?:()=>void;onPrevious?:()=>void}){
 const call=useDriveApi();
 const ref=useOverlayFocus(onClose);
 const [state,setState]=useState<{ticket:PreviewTicket|null;busy:boolean;error:string}>({ticket:null,busy:true,error:''});
 useEffect(()=>{
  let live=true;
  setState({ticket:null,busy:true,error:''});
  void call<PreviewTicket>('/integrations/dropbox/'+encodeURIComponent(link.connectionId)+'/preview-ticket','POST',{
   fileId:file.id,projectId:link.projectId,linkedFolderId:link.folderId
  }).then(ticket=>{if(live)setState({ticket,busy:false,error:''})})
   .catch(e=>{if(live)setState({ticket:null,busy:false,error:e instanceof Error?e.message:'Prévia indisponível.'})});
  return()=>{live=false};
 },[call,file.id,link.connectionId,link.folderId,link.projectId]);
 const media=state.ticket?.url;
 const kind=file.mimeType;
 return <div className="rl-overlay rl-preview-overlay" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}>
  <section className="rl-preview db-preview" ref={ref} role="dialog" aria-modal="true" tabIndex={-1} aria-label={'Prévia de '+file.name}>
   <header><div className="rl-preview-title"><strong title={file.name}>{file.name}</strong><small>Dropbox · Prévia protegida pelo Roteiva</small></div>
    <div><a href="https://www.dropbox.com/home" target="_blank" rel="noreferrer" className="secondary-button"><ExternalLink size={15}/> Abrir Dropbox</a>
     <button type="button" className="rl-icon-button" aria-label="Fechar" onClick={onClose}><X size={17}/></button></div></header>
   <div className="rl-preview-body db-preview-body">
    {onPrevious&&<button className="rl-preview-nav rl-preview-nav-prev" onClick={onPrevious} aria-label="Arquivo anterior"><ChevronRight size={19} style={{transform:'rotate(180deg)'}}/></button>}
    {state.busy?<div role="status" className="rl-state"><LoaderCircle className="rl-spin" size={22}/> Preparando prévia…</div>:
     state.error?<div role="alert" className="rl-state">{state.error}</div>:
     media&&kind.startsWith('image/')?<ReviewImageViewer src={media} name={file.name}/>:
     media&&kind.startsWith('video/')?<video key={media} src={media} controls playsInline preload="metadata" controlsList="nodownload" disablePictureInPicture/>:
     media&&kind.startsWith('audio/')?<audio key={media} src={media} controls preload="metadata" controlsList="nodownload"/>:
     media&&kind==='application/pdf'?<iframe title={'PDF '+file.name} src={media} referrerPolicy="no-referrer"/>:
     <div className="rl-state">Este arquivo não possui prévia integrada.</div>}
    {onNext&&<button className="rl-preview-nav rl-preview-nav-next" onClick={onNext} aria-label="Próximo arquivo"><ChevronRight size={19}/></button>}
   </div>
   <p>A visualização respeita as permissões do Roteiva. O arquivo original continua armazenado no Dropbox.</p>
  </section>
 </div>;
}
export function DropboxConnectionPanel({projects,selectedProjectId,onSelectProject,onLinkedFolderCountChange}:{
 projects:readonly Project[];selectedProjectId?:number;onSelectProject:(id:string)=>void;onLinkedFolderCountChange?:(count:number)=>void;
}){
 const {user}=useAuth(),call=useDriveApi(),transfers=useDriveTransfers();
 const [connections,setConnections]=useState<Connection[]>([]);
 const [links,setLinks]=useState<DropboxFolderLink[]>([]);
 const [ready,setReady]=useState(false),[busy,setBusy]=useState(false),[disabled,setDisabled]=useState(false);
 const [error,setError]=useState(''),[result,setResult]=useState('');
 const [selectedConn,setSelectedConn]=useState(''),[confirmId,setConfirmId]=useState('');
 const [picker,setPicker]=useState(false),[pickerPath,setPickerPath]=useState<DriveTrail[]>([{id:'root',name:'Meu Dropbox'}]);
 const [pickerItems,setPickerItems]=useState<DriveItem[]>([]),[pickerPage,setPickerPage]=useState<string|null>(null),[pickerBusy,setPickerBusy]=useState(false);
 const [viewing,setViewing]=useState<DropboxFolderLink|null>(null),[path,setPath]=useState<DriveTrail[]>([]);
 const [items,setItems]=useState<DriveItem[]>([]),[filesPage,setFilesPage]=useState<string|null>(null),[fileBusy,setFileBusy]=useState(false);
 const [search,setSearch]=useState(''),[remote,setRemote]=useState<{term:string;folder:string;files:DriveItem[];next:string|null}|null>(null),[searchBusy,setSearchBusy]=useState(false);
 const [preview,setPreview]=useState<DriveItem|null>(null);
 const account=connections.find(c=>c.id===selectedConn&&c.status==='connected')||connections.find(c=>c.status==='connected');
 const validAccounts=connections.filter(c=>c.status==='connected');
 const relevant=useMemo(()=>selectedProjectId?links.filter(x=>x.projectId===selectedProjectId):links,[links,selectedProjectId]);
 const currentFolder=path.at(-1)?.id||viewing?.folderId||'';
 const requestId=useRef(0),pickerId=useRef(0),searchId=useRef(0);
 const refresh=useCallback(async()=>{
  if(!user)return;
  const [next,linked]=await Promise.all([
   call<{connections:Connection[]}>('/integrations/dropbox'),
   readDropboxLinks(user.uid)
  ]);
  setConnections(next.connections);setLinks(linked);setReady(true);setDisabled(false);
  setSelectedConn(old=>next.connections.some(c=>c.id===old)?old:next.connections.find(c=>c.status==='connected')?.id||'');
 },[call,user]);
 useEffect(()=>{let live=true;(async()=>{try{await refresh()}catch(e){
  if(live){setDisabled((e as {code?:string})?.code==='dropbox_not_configured');
   setError((e as {code?:string})?.code==='dropbox_not_configured'?
    'A integração Dropbox ainda não foi habilitada neste ambiente.':'Não foi possível carregar as contas Dropbox.');}
 }finally{if(live)setReady(true)}})();return()=>{live=false}},[refresh]);
 useEffect(()=>{onLinkedFolderCountChange?.(links.length)},[links.length,onLinkedFolderCountChange]);
 useEffect(()=>{setViewing(null);setItems([]);setPath([]);setPreview(null);setSearch('');},[selectedProjectId]);
 const start=async()=>{
  setBusy(true);setError('');
  try{
   const {launchUrl}=await call<{launchUrl:string}>('/oauth/dropbox/start','POST');
   const next=new URL(launchUrl);
   if(next.origin!==API||next.pathname!=='/oauth/dropbox/launch')throw new Error('O endereço de autorização recebido não é confiável.');
   window.location.assign(next.href);
  }catch(e){setError(e instanceof Error?e.message:'Não foi possível conectar o Dropbox.');setBusy(false)}
 };
 const callback=new URLSearchParams(window.location.search).get('dropbox');
 const load=useCallback(async(folder:DropboxFolderLink,folderId:string,nextPath:DriveTrail[],cursor?:string,append=false)=>{
  const request=++requestId.current;setFileBusy(true);setError('');
  if(!append){setItems([]);setFilesPage(null);setSearch('');setRemote(null);setViewing(folder);setPath(nextPath)}
  try{
   const params=new URLSearchParams();if(cursor)params.set('pageToken',cursor);
   const response=await call<Page>('/integrations/dropbox/'+encodeURIComponent(folder.connectionId)+'/folders/'+encodeURIComponent(folderId)+'/items?'+params);
   if(request!==requestId.current)return;
   setItems(old=>append?[...old,...response.files.filter(f=>!old.some(x=>x.id===f.id))]:response.files);
   setFilesPage(response.nextPageToken);setViewing(folder);setPath(nextPath);
  }catch(e){if(request===requestId.current)setError(e instanceof Error?e.message:'Não foi possível carregar a pasta.')}
  finally{if(request===requestId.current)setFileBusy(false)}
 },[call]);
 useEffect(()=>{if(ready&&relevant.length&&!viewing&&!picker&&!disabled)void load(relevant[0],relevant[0].folderId,[{id:relevant[0].folderId,name:relevant[0].folderName}]);},
  [ready,relevant,viewing,picker,disabled,load]);
 const browsePicker=useCallback(async(folderId:string,nextPath:DriveTrail[],cursor?:string,append=false)=>{
  if(!account)return;
  const request=++pickerId.current;setPickerBusy(true);
  if(!append){setPickerItems([]);setPickerPage(null);setPickerPath(nextPath)}
  try{
   const params=new URLSearchParams({parentId:folderId});if(cursor)params.set('pageToken',cursor);
   const response=await call<Page>('/integrations/dropbox/'+encodeURIComponent(account.id)+'/folders?'+params);
   if(request!==pickerId.current)return;
   setPickerItems(old=>append?[...old,...response.files.filter(f=>!old.some(x=>x.id===f.id))]:response.files);
   setPickerPage(response.nextPageToken);setPickerPath(nextPath);
  }catch(e){if(request===pickerId.current)setError(e instanceof Error?e.message:'Não foi possível navegar pelas pastas.')}
  finally{if(request===pickerId.current)setPickerBusy(false)}
 },[account?.id,call]);
 useEffect(()=>{if(picker&&account)void browsePicker('root',[{id:'root',name:'Meu Dropbox'}]);},[picker,account?.id,browsePicker]);
 async function link(folder:{id:string;name:string}){
  if(!user||!selectedProjectId||!account)return;
  setBusy(true);setError('');
  try{
   await linkDropboxFolder(user.uid,selectedProjectId,account.id,folder);
   const record:DropboxFolderLink={id:dropboxFolderLinkId(selectedProjectId,account.id,folder.id),
    provider:'dropbox',projectId:selectedProjectId,connectionId:account.id,folderId:folder.id,folderName:folder.name};
   setLinks(prev=>prev.some(l=>l.id===record.id)?prev:[...prev,record]);
   setPicker(false);setResult('Pasta do Dropbox vinculada ao projeto.');
   await load(record,record.folderId,[{id:record.folderId,name:record.folderName}]);
  }catch(e){setError(e instanceof Error?e.message:'Não foi possível vincular a pasta.')}
  finally{setBusy(false)}
 }
 async function unlink(link:DropboxFolderLink){
  if(!user)return;
  setBusy(true);setError('');
  try{await unlinkDropboxFolder(user.uid,link.id);
   setLinks(prev=>prev.filter(x=>x.id!==link.id));
   if(viewing?.id===link.id){setViewing(null);setItems([])}
   setResult('Vínculo removido. Os arquivos continuam no Dropbox.');
  }catch(e){setError(e instanceof Error?e.message:'Não foi possível desvincular a pasta.')}finally{setBusy(false)}
 }
 async function disconnect(){
  if(!account)return;
  transfers.cancelAll(account.id);setBusy(true);setError('');
  try{
   await call('/integrations/dropbox/'+encodeURIComponent(account.id)+'/disconnect','POST');
   clearDriveThumbnailCache();setViewing(null);setItems([]);setConfirmId('');setPicker(false);
   await refresh();setResult('Dropbox desconectado. Seus arquivos permanecem na conta.');
  }catch(e){setError(e instanceof Error?e.message:'Não foi possível desconectar.')}finally{setBusy(false)}
 }
 const getThumbnail=useCallback(async(file:DriveItem,signal?:AbortSignal,accountId?:string):Promise<Blob|null>=>{
  if(!user||!file.thumbnailFallback)return null;
  const conn=accountId||viewing?.connectionId;if(!conn)return null;
  const token=await user.getIdToken();
  const res=await fetch(API+'/integrations/dropbox/'+encodeURIComponent(conn)+'/files/'+encodeURIComponent(file.id)+'/thumbnail',
   {method:'GET',cache:'no-store',signal,headers:{Authorization:'Bearer '+token}});
  return res.ok&&res.status!==204?res.blob():null;
 },[user,viewing?.connectionId]);
 useEffect(()=>{
  const id=++searchId.current,term=search.trim();
  setRemote(null);setSearchBusy(false);
  if(!viewing||term.length<2)return;
  const handle=window.setTimeout(()=>{setSearchBusy(true);const qs=new URLSearchParams({search:term});
   void call<Page>('/integrations/dropbox/'+encodeURIComponent(viewing.connectionId)+'/folders/'+encodeURIComponent(currentFolder)+'/items?'+qs)
    .then(data=>{if(id===searchId.current)setRemote({term,folder:currentFolder,files:data.files,next:data.nextPageToken})})
    .catch(e=>{if(id===searchId.current)setError(e instanceof Error?e.message:'Falha na busca.')})
    .finally(()=>{if(id===searchId.current)setSearchBusy(false)});
  },300);
  return()=>window.clearTimeout(handle);
 },[search,viewing?.id,currentFolder,call]);
 async function moreSearch(){
  if(!viewing||!remote?.next)return;
  const qs=new URLSearchParams({search:remote.term,pageToken:remote.next});
  setSearchBusy(true);
  try{const response=await call<Page>('/integrations/dropbox/'+encodeURIComponent(viewing.connectionId)+'/folders/'+encodeURIComponent(remote.folder)+'/items?'+qs);
   setRemote(old=>old&&old.term===remote.term?{...old,files:[...old.files,...response.files.filter(f=>!old.files.some(x=>x.id===f.id))],next:response.nextPageToken}:old);
  }catch(e){setError(e instanceof Error?e.message:'Falha ao carregar a próxima página.')}
  finally{setSearchBusy(false)}
 }
 function upload(files:File[]){
  if(!viewing||!user||!currentFolder)return;
  const {rejected}=transfers.enqueue(files,{provider:'dropbox',connectionId:viewing.connectionId,
   linkedFolderId:viewing.folderId,targetFolderId:currentFolder,folderName:path.at(-1)?.name||viewing.folderName,
   projectId:viewing.projectId});
  if(rejected)setError(rejected+' arquivo(s) não puderam entrar na fila. Confira os limites de tamanho.');
 }
 useEffect(()=>transfers.subscribe((uploaded,dest)=>{
  if(dest.provider!=='dropbox'||!viewing||dest.connectionId!==viewing.connectionId||
     dest.projectId!==viewing.projectId||dest.targetFolderId!==currentFolder)return;
  setItems(old=>[{id:uploaded.id,name:uploaded.name,mimeType:uploaded.mimeType,size:uploaded.size},...old.filter(f=>f.id!==uploaded.id)]);
 }),[transfers.subscribe,viewing,currentFolder]);
 const displayed=items.filter(f=>!isStorageFolder(f.mimeType));
 const openItem=(file:DriveItem)=>isStorageFolder(file.mimeType)?
  viewing&&void load(viewing,file.id,[...path,{id:file.id,name:file.name}]):setPreview(file);
 const previewList=displayed.filter(f=>f.mimeType.startsWith('image/')||f.mimeType.startsWith('video/')||
  f.mimeType.startsWith('audio/')||f.mimeType==='application/pdf');
 const previewIndex=preview?previewList.findIndex(f=>f.id===preview.id):-1;
 return <section className="rl-library" aria-label="Biblioteca Dropbox">
  <header className="rl-toolbar">
   <div className="rl-title"><span className="rl-title-icon"><FolderOpen size={20}/></span><div><h2>Arquivos do Dropbox</h2><p>Conecte a conta e vincule as pastas dos seus projetos.</p></div></div>
   <div className="rl-toolbar-actions">
    {validAccounts.length?<details className="rl-account"><summary><ShieldCheck size={16}/> Dropbox conectado <ChevronDown size={14}/></summary>
      <div className="rl-account-panel"><strong>Conta Dropbox</strong>
       <AppSelect aria-label="Conta Dropbox" value={account?.id||''} onValueChange={setSelectedConn}>
        {validAccounts.map(c=><option key={c.id} value={c.id}>{c.email}</option>)}</AppSelect>
       {confirmId===account?.id?<><p>Desconectar esta conta? O Roteiva não apagará arquivos.</p>
        <button type="button" className="secondary-button" onClick={()=>setConfirmId('')}>Cancelar</button>
        <button type="button" className="secondary-button" disabled={busy} onClick={()=>void disconnect()}>Confirmar desconexão</button></>:
        <button type="button" className="secondary-button" disabled={busy} onClick={()=>setConfirmId(account?.id||'')}><Unplug size={15}/> Desconectar</button>}
      </div></details>:null}
    <button className="secondary-button" disabled={busy||disabled} onClick={()=>void refresh().catch(e=>setError(e instanceof Error?e.message:'Falha ao atualizar.'))}><RefreshCw size={16}/></button>
    {validAccounts.length>0?<button className="primary-button" disabled={disabled||busy||!selectedProjectId} onClick={()=>setPicker(true)}><Plus size={16}/> Vincular pasta</button>:
      <button className="primary-button" disabled={disabled||busy||!ready} onClick={()=>void start()}><Cloud size={16}/> Conectar Dropbox</button>}
   </div>
  </header>
  {!ready&&<div className="rl-status" role="status"><LoaderCircle className="rl-spin" size={16}/> Carregando Dropbox…</div>}
  {callback==='connected'&&<div className="rl-status" role="status"><Check size={16}/> Conta Dropbox conectada.</div>}
  {callback==='cancelled'&&<div className="rl-status">Autorização cancelada.</div>}
  {error&&<div className="rl-status" role="alert">{error}</div>}
  {result&&<div className="rl-status" role="status">{result}</div>}
  {!selectedProjectId&&<p className="rl-status">Selecione um projeto para vincular novas pastas do Dropbox.</p>}
  <div className="rl-explorer" data-mobile-detail={!!viewing}>
   <aside className="rl-folders" aria-label="Pastas Dropbox vinculadas">
    <div className="rl-folders-header"><h3>Pastas {selectedProjectId?'do projeto':'dos projetos'}</h3><small>{relevant.length}</small></div>
    <div className="rl-folder-list">
     {relevant.map(link=><div className="rl-folder-entry" key={link.id} data-active={viewing?.id===link.id}>
      <button type="button" className="rl-folder-button" onClick={()=>void load(link,link.folderId,[{id:link.folderId,name:link.folderName}])}>
       <FolderOpen size={18}/><span><b>{link.folderName}</b><small>{projects.find(p=>p.id===link.projectId)?.name||'Projeto'}</small></span>
      </button>
      <button type="button" className="rl-icon-button" title="Desvincular pasta" aria-label={'Desvincular '+link.folderName}
        disabled={busy} onClick={()=>void unlink(link)}><X size={16}/></button>
     </div>)}
     {!relevant.length&&<div className="rl-state"><FolderOpen size={26}/><p>Nenhuma pasta Dropbox vinculada.</p></div>}
    </div>
   </aside>
   <DriveFileExplorer provider="dropbox" externalUrl={()=>"https://www.dropbox.com/home"} folderName={viewing?.folderName}
    path={path} files={items} loading={fileBusy} hasMore={search.trim().length>=2?!!remote?.next:!!filesPage}
    thumbnailScope={(user?.uid||'')+':'+(viewing?.connectionId||account?.id||'')} getThumbnail={getThumbnail}
    searchResults={remote?.folder===currentFolder?remote.files:undefined} searchTerm={remote?.term}
    searchLoading={searchBusy} onSearchChange={setSearch}
    onBack={()=>{setViewing(null);setItems([]);setPath([])}}
    onNavigate={(id,next)=>{if(viewing)void load(viewing,id,next)}}
    onOpen={openItem} onUploadFiles={upload} uploadDisabled={!viewing||busy||fileBusy}
    onMore={()=>{if(search.trim().length>=2)void moreSearch();else if(viewing&&filesPage)void load(viewing,currentFolder,path,filesPage,true)}}/>
  </div>
  {picker&&<DropboxFolderPicker folders={pickerItems} path={pickerPath} projectId={selectedProjectId} loading={pickerBusy}
   hasMore={!!pickerPage} linkedIds={new Set(links.filter(l=>l.projectId===selectedProjectId&&l.connectionId===account?.id).map(l=>l.folderId))}
   onClose={()=>setPicker(false)} onEnter={f=>void browsePicker(f.id,[...pickerPath,{id:f.id,name:f.name}])}
   onNavigate={trail=>void browsePicker(trail.at(-1)?.id||'root',trail)}
   onMore={()=>void browsePicker(pickerPath.at(-1)?.id||'root',pickerPath,pickerPage||undefined,true)}
   onLink={folder=>void link(folder)}/>}
  {preview&&viewing&&<DropboxPreview file={preview} link={viewing} onClose={()=>setPreview(null)}
    onPrevious={previewIndex>0?()=>setPreview(previewList[previewIndex-1]):undefined}
    onNext={previewIndex>=0&&previewIndex<previewList.length-1?()=>setPreview(previewList[previewIndex+1]):undefined}/>}
 </section>;
}
