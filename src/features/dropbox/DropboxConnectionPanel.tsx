import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {Check,ChevronDown,ChevronRight,Cloud,ExternalLink,FolderOpen,LoaderCircle,Plus,RefreshCw,ShieldCheck,Unplug,X} from 'lucide-react';
import type {Project} from '../../domain/workspace';
import {AppSelect} from '../ui/AppSelect';
import {useAuth} from '../auth/AuthProvider';
import {useDriveApi,messages} from '../drive/drive-api';
import {DriveFileExplorer,StorageFolderPicker,DriveUnlinkConfirm,isStorageFolder,useOverlayFocus,type DriveItem,type DriveTrail} from '../drive/DriveLibraryUI';
import {FolderActionsMenu} from '../drive/FolderActionsMenu';
import {fetchDropboxDocument,isDropboxDocument} from './DropboxDocumentPreview';
import {ReviewImageViewer} from '../reviews/ReviewImageViewer';
import {dropboxWebUrl} from './dropbox-web-url';
import {clearDriveThumbnailCache} from '../drive/DriveThumbnail';
import {cacheKey,getCachedFolder,setCachedFolder,onceFolderRequest,clearStorageFolderCache,invalidateStorageFolderCache} from '../drive/storage-folder-cache';
import {applyDropboxChanges,type DropboxDelta} from './dropbox-folder-delta';
import {useDriveTransfers} from '../drive/DriveTransfersProvider';
import {dropboxFolderLinkId,linkDropboxFolder,readDropboxLinks,unlinkDropboxFolder,type DropboxFolderLink} from '../../data/dropbox-folder-links';
import '../drive/drive-library.css';
import './dropbox.css';
const API='https://roteiva-api-dev.ewertonmendes9.workers.dev';
type Connection={id:string;email:string;status:'connected'|'reconnect_required'|'revocation_pending';scopes:string};
type Page={folder:{id:string;name:string};files:DriveItem[];nextPageToken:string|null;syncCursor?:string|null};
const FRESH_MS=30_000;
const MAX_DELTA_PAGES=12;
type PreviewTicket={url:string;mimeType:string;expiresAt:number;size:number};
function DropboxPreview({file,link,onClose,onNext,onPrevious}:{file:DriveItem;link:DropboxFolderLink;onClose:()=>void;onNext?:()=>void;onPrevious?:()=>void}){
 const call=useDriveApi();
 const ref=useOverlayFocus(onClose);
 const [state,setState]=useState<{ticket:PreviewTicket|null;busy:boolean;error:string}>({ticket:null,busy:true,error:''});
 useEffect(()=>{
  const controller=new AbortController();let createdUrl:string|null=null;
  setState({ticket:null,busy:true,error:''});
  const load=isDropboxDocument(file)
   ?fetchDropboxDocument(call,link,file,controller.signal).then(blob=>{
     createdUrl=URL.createObjectURL(blob);
     return {url:createdUrl,mimeType:'application/pdf',size:blob.size,expiresAt:0};
   })
   :call<PreviewTicket>('/integrations/dropbox/'+encodeURIComponent(link.connectionId)+'/preview-ticket','POST',{
     fileId:file.id,projectId:link.projectId,linkedFolderId:link.folderId
   });
  void load.then(ticket=>{if(!controller.signal.aborted)setState({ticket,busy:false,error:''})})
   .catch(e=>{if(!controller.signal.aborted)setState({ticket:null,busy:false,
     error:e instanceof Error?e.message:'Prévia indisponível.'})});
  return()=>{controller.abort();if(createdUrl)URL.revokeObjectURL(createdUrl)};
 },[call,file.id,file.name,link.connectionId,link.folderId,link.projectId]);
 const media=state.ticket?.url;
 const kind=state.ticket?.mimeType||file.mimeType;
 return <div className="rl-overlay rl-preview-overlay" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}>
  <section className="rl-preview db-preview" ref={ref} role="dialog" aria-modal="true" tabIndex={-1} aria-label={'Prévia de '+file.name}>
   <header><div className="rl-preview-title"><strong title={file.name}>{file.name}</strong><small>Dropbox · Prévia protegida pelo Roteiva</small></div>
    <div><a href={dropboxWebUrl(file)} target="_blank" rel="noreferrer" className="secondary-button"><ExternalLink size={15}/> Abrir Dropbox</a>
     <button type="button" className="rl-icon-button" aria-label="Fechar" onClick={onClose}><X size={17}/></button></div></header>
   <div className="rl-preview-body db-preview-body">
    {onPrevious&&<button className="rl-preview-nav rl-preview-nav-prev" onClick={onPrevious} aria-label="Arquivo anterior"><ChevronRight size={19} style={{transform:'rotate(180deg)'}}/></button>}
    {state.busy?<div role="status" className="rl-state"><LoaderCircle className="rl-spin" size={22}/> Preparando prévia…</div>:
     state.error?<div role="alert" className="rl-state">{state.error}</div>:
     media&&kind.startsWith('image/')?<ReviewImageViewer src={media} name={file.name}/>:
     media&&kind.startsWith('video/')?<video key={media} src={media} controls playsInline preload="metadata" controlsList="nodownload" disablePictureInPicture/>:
     media&&kind.startsWith('audio/')?<audio key={media} src={media} controls preload="metadata" controlsList="nodownload"/>:
     media&&kind==='application/pdf'?<iframe key={media} title={'PDF '+file.name} src={media+'#toolbar=0&navpanes=0'} referrerPolicy="no-referrer"/>:
     <div className="rl-state">Este arquivo não possui prévia integrada.</div>}
    {onNext&&<button className="rl-preview-nav rl-preview-nav-next" onClick={onNext} aria-label="Próximo arquivo"><ChevronRight size={19}/></button>}
   </div>
   <p>A visualização respeita as permissões do Roteiva. O arquivo original continua armazenado no Dropbox.</p>
  </section>
 </div>;
}
export function DropboxConnectionPanel({projects,selectedProjectId,onLinkedFolderCountChange}:{
 projects:readonly Project[];selectedProjectId?:number;onSelectProject:(id:string)=>void;onLinkedFolderCountChange?:(count:number)=>void;
}){
 const {user}=useAuth(),call=useDriveApi(),transfers=useDriveTransfers();
 const [connections,setConnections]=useState<Connection[]>([]);
 const [links,setLinks]=useState<DropboxFolderLink[]>([]);
 const [ready,setReady]=useState(false),[busy,setBusy]=useState(false),[disabled,setDisabled]=useState(false);
 const [error,setError]=useState(''),[result,setResult]=useState('');
 const [selectedConn,setSelectedConn]=useState(''),[confirmId,setConfirmId]=useState('');
 const [picker,setPicker]=useState(false),[pickerProjectId,setPickerProjectId]=useState(0);
 const [pickerError,setPickerError]=useState(''),[pickerPath,setPickerPath]=useState<DriveTrail[]>([{id:'root',name:'Meu Dropbox'}]);
 const [pickerItems,setPickerItems]=useState<DriveItem[]>([]),[pickerPage,setPickerPage]=useState<string|null>(null),[pickerBusy,setPickerBusy]=useState(false);
 const [viewing,setViewing]=useState<DropboxFolderLink|null>(null),[path,setPath]=useState<DriveTrail[]>([]);
 const [items,setItems]=useState<DriveItem[]>([]),[filesPage,setFilesPage]=useState<string|null>(null),[fileBusy,setFileBusy]=useState(false);
 const [search,setSearch]=useState(''),[remote,setRemote]=useState<{term:string;folder:string;files:DriveItem[];next:string|null}|null>(null),[searchBusy,setSearchBusy]=useState(false);
 const [preview,setPreview]=useState<DriveItem|null>(null);
 const [unlinkTarget,setUnlinkTarget]=useState<DropboxFolderLink|null>(null);
 const account=connections.find(c=>c.id===selectedConn&&c.status==='connected')||connections.find(c=>c.status==='connected');
 const validAccounts=connections.filter(c=>c.status==='connected');
 const relevant=useMemo(()=>selectedProjectId?links.filter(x=>x.projectId===selectedProjectId):links,[links,selectedProjectId]);
 const currentFolder=path.at(-1)?.id||viewing?.folderId||'';
 const requestId=useRef(0),pickerId=useRef(0),searchId=useRef(0);
 const autoOpened=useRef('');
 const itemsRef=useRef<DriveItem[]>([]);
 useEffect(()=>{itemsRef.current=items;},[items]);
 const previousScope=useRef('');
 useEffect(()=>{
  const next=user?.uid&&account?.id?user.uid+':'+account.id:'';
  if(previousScope.current&&previousScope.current!==next)clearStorageFolderCache('dropbox');
  previousScope.current=next;
 },[user?.uid,account?.id]);
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
 useEffect(()=>{++requestId.current;++searchId.current;setViewing(null);setItems([]);setPath([]);setPreview(null);setSearch('');},[selectedProjectId]);
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
 const load=useCallback(async(folder:DropboxFolderLink,folderId:string,nextPath:DriveTrail[],cursor?:string,append=false,force=false)=>{
  if(!user)return;
  const request=++requestId.current;
  const key=cacheKey(user.uid,folder.connectionId,folderId,'','','dropbox');
  const cached=getCachedFolder(key);
  setFileBusy(append||!cached);setError('');
  if(!append){
   ++searchId.current;setSearch('');setRemote(null);setSearchBusy(false);
   setViewing(folder);setPath(nextPath);
   itemsRef.current=cached?.files||[];setItems(itemsRef.current);setFilesPage(cached?.nextPageToken||null);
  }
  const uri='/integrations/dropbox/'+encodeURIComponent(folder.connectionId)+
    '/folders/'+encodeURIComponent(folderId)+'/items';
  const show=(files:DriveItem[],page:string|null)=>{
   if(request!==requestId.current)return;
   itemsRef.current=files;setItems(files);setFilesPage(page);
   setViewing(folder);setPath(nextPath);
  };
  try{
   if(!append&&!force&&cached&&Date.now()-cached.fetchedAt<FRESH_MS)return;
   if(!append&&cached?.complete&&cached.syncCursor){
    let cursorValue=cached.syncCursor;
    const changes:NonNullable<DropboxDelta['changes']>=[];
    let fullyRead=false,reset=false;
    for(let n=0;n<MAX_DELTA_PAGES;n++){
     const value=cursorValue;
     const response=await onceFolderRequest(
       cacheKey(user.uid,folder.connectionId,folderId,'__delta__',value,'dropbox'),
       ()=>call<DropboxDelta>(uri+'?changesCursor='+encodeURIComponent(value))
     );
     if(request!==requestId.current)return;
     if(response.reset){reset=true;break;}
     if(!Array.isArray(response.changes)||!response.syncCursor||
        typeof response.hasMore!=='boolean')throw Error('Resposta de sincronização inválida.');
     changes.push(...response.changes);
     cursorValue=response.syncCursor;
     if(!response.hasMore){fullyRead=true;break;}
    }
    if(fullyRead){
     const files=applyDropboxChanges(cached.files,changes);
     setCachedFolder(key,{files,nextPageToken:null,syncCursor:cursorValue,complete:true});
     show(files,null);
     return;
    }
    // Expired cursor or exceptionally large change backlog: return to a normal
    // paginated listing rather than apply an incomplete delta snapshot.
    if(reset||!fullyRead)invalidateStorageFolderCache('dropbox',user.uid,folder.connectionId,folderId);
   }
   const params=new URLSearchParams();if(cursor)params.set('pageToken',cursor);
   const next=await onceFolderRequest(
     cacheKey(user.uid,folder.connectionId,folderId,'__list__',cursor||'first','dropbox'),
     ()=>call<Page>(uri+'?'+params)
   );
   if(request!==requestId.current)return;
   const previous=append?getCachedFolder(key):undefined;
   const files=append?[...(previous?.files||itemsRef.current)].concat(
     next.files.filter(f=>!(previous?.files||itemsRef.current).some(existing=>existing.id===f.id))
   ):next.files;
   const complete=!next.nextPageToken;
   setCachedFolder(key,{files,nextPageToken:next.nextPageToken,
     syncCursor:complete?next.syncCursor||null:null,complete});
   show(files,next.nextPageToken);
  }catch(e){
   if(request!==requestId.current)return;
   const code=(e as {code?:string}).code;
   if(code==='dropbox_reconnect_required'||code==='authentication_required'||
      code==='dropbox_file_not_found'||code==='dropbox_connection_not_found'){
    invalidateStorageFolderCache('dropbox',user.uid,folder.connectionId,folderId);
    show([],null);
   }
   setError(cached?'Não foi possível atualizar a pasta. Os arquivos exibidos podem estar desatualizados.':
     e instanceof Error?e.message:'Não foi possível carregar a pasta.');
  }finally{if(request===requestId.current)setFileBusy(false);}
 },[call,user?.uid]);
 useEffect(()=>{
  const first=relevant[0];
  if(!ready||!first||viewing||picker||disabled)return;
  const key=(selectedProjectId||'all')+':'+first.id;
  if(autoOpened.current===key)return;
  autoOpened.current=key;
  void load(first,first.folderId,[{id:first.folderId,name:first.folderName}]);
 },[ready,relevant,viewing,picker,disabled,load,selectedProjectId]);
 const browsePicker=useCallback(async(folderId:string,nextPath:DriveTrail[],cursor?:string,append=false)=>{
  if(!account||!user)return;
  const request=++pickerId.current;
  const key=cacheKey(user.uid,account.id,folderId,'__picker__','','dropbox');
  const cached=getCachedFolder(key);
  setPickerBusy(append||!cached);setPickerError('');
  if(!append){
   setPickerItems(cached?.files||[]);
   setPickerPage(cached?.nextPageToken||null);
   setPickerPath(nextPath);
  }
  try{
   if(!append&&cached&&Date.now()-cached.fetchedAt<FRESH_MS)return;
   const params=new URLSearchParams({parentId:folderId});
   if(cursor)params.set('pageToken',cursor);
   const response=await onceFolderRequest(
     cacheKey(user.uid,account.id,folderId,'__picker_list__',cursor||'first','dropbox'),
     ()=>call<Page>('/integrations/dropbox/'+encodeURIComponent(account.id)+'/folders?'+params)
   );
   if(request!==pickerId.current)return;
   const earlier=append?getCachedFolder(key)?.files||[]:[];
   const files=append?[...earlier,...response.files.filter(f=>!earlier.some(x=>x.id===f.id))]:response.files;
   setCachedFolder(key,{files,nextPageToken:response.nextPageToken});
   setPickerItems(files);setPickerPage(response.nextPageToken);setPickerPath(nextPath);
  }catch(e){if(request===pickerId.current)setPickerError(e instanceof Error?e.message:'Não foi possível navegar pelas pastas.')}
  finally{if(request===pickerId.current)setPickerBusy(false)}
 },[account?.id,user?.uid,call]);
 useEffect(()=>{if(picker&&account)void browsePicker('root',[{id:'root',name:'Meu Dropbox'}]);},[picker,account?.id,browsePicker]);
 async function linkFolders(folders:DriveItem[]):Promise<boolean>{
  const projectId=pickerProjectId;
  if(!user||!account||busy||!projects.some(project=>project.id===projectId)||!folders.length){
   setPickerError('Selecione um projeto e pelo menos uma pasta válidos.');return false;
  }
  setBusy(true);setError('');setPickerError('');
  let first:DropboxFolderLink|null=null;
  let saved=0;
  const failed:string[]=[];
  for(const folder of folders){
   const existing=links.find(l=>l.projectId===projectId&&l.connectionId===account.id&&l.folderId===folder.id);
   if(existing)continue;
   try{
    await linkDropboxFolder(user.uid,projectId,account.id,folder);
    const record:DropboxFolderLink={
     id:dropboxFolderLinkId(projectId,account.id,folder.id),provider:'dropbox',
     projectId,connectionId:account.id,folderId:folder.id,folderName:folder.name
    };
    setLinks(prev=>prev.some(l=>l.id===record.id)?prev:[...prev,record]);
    first??=record;
    saved++;
   }catch{failed.push(folder.name);}
  }
  setBusy(false);
  if(saved){
   setResult(saved===1?'Pasta do Dropbox vinculada ao projeto.':saved+' pastas do Dropbox vinculadas ao projeto.');
   if(first)void load(first,first.folderId,[{id:first.folderId,name:first.folderName}]);
  }
  if(failed.length){
   setPickerError('Não foi possível vincular: '+failed.join(', ')+'. Confira as permissões e tente novamente.');
   return false;
  }
  return true;
 }
 async function unlink(link:DropboxFolderLink){
  if(!user)return;
  setBusy(true);setError('');
  try{await unlinkDropboxFolder(user.uid,link.id);
   setLinks(prev=>prev.filter(x=>x.id!==link.id));
   clearStorageFolderCache('dropbox',user.uid,link.connectionId);
   if(viewing?.id===link.id){++requestId.current;setViewing(null);setItems([])}
   setUnlinkTarget(null);
   setResult('Vínculo removido. Os arquivos continuam no Dropbox.');
  }catch(e){setError(e instanceof Error?e.message:'Não foi possível desvincular a pasta.')}finally{setBusy(false)}
 }
 async function disconnect(){
  if(!account)return;
  transfers.cancelAll(account.id);setBusy(true);setError('');
  try{
   await call('/integrations/dropbox/'+encodeURIComponent(account.id)+'/disconnect','POST');
   clearDriveThumbnailCache();clearStorageFolderCache('dropbox',user?.uid,account.id);
   ++requestId.current;++searchId.current;++pickerId.current;
   setViewing(null);setItems([]);setConfirmId('');setPicker(false);
   await refresh();setResult('Dropbox desconectado. Seus arquivos permanecem na conta.');
  }catch(e){setError(e instanceof Error?e.message:'Não foi possível desconectar.')}finally{setBusy(false)}
 }
 const getThumbnail=useCallback(async(file:DriveItem,signal?:AbortSignal,accountId?:string):Promise<Blob|null>=>{
  if(!user||!file.thumbnailFallback)return null;
  const conn=accountId||viewing?.connectionId;if(!conn)return null;
  const token=await user.getIdToken();
  const res=await fetch(API+'/integrations/dropbox/'+encodeURIComponent(conn)+'/files/'+encodeURIComponent(file.id)+'/thumbnail',
   {method:'GET',cache:'no-store',signal,headers:{Authorization:'Bearer '+token}});
  if(res.status===204)return null;
  if(!res.ok)throw new Error('Não foi possível carregar a miniatura do Dropbox.');
  if(!res.headers.get('Content-Type')?.startsWith('image/'))
   throw new Error('Resposta de miniatura inválida.');
  return res.blob();
 },[user,viewing?.connectionId]);
 useEffect(()=>{
  const id=++searchId.current,term=search.trim();
  setRemote(null);setSearchBusy(false);
  if(!viewing||!user||term.length<2)return;
  const currentViewing=viewing,folderId=currentFolder;
  const handle=window.setTimeout(()=>{
   const key=cacheKey(user.uid,currentViewing.connectionId,folderId,term,'','dropbox');
   const cached=getCachedFolder(key);
   if(cached&&id===searchId.current)
     setRemote({term,folder:folderId,files:cached.files,next:cached.nextPageToken});
   if(cached&&Date.now()-cached.fetchedAt<FRESH_MS)return;
   if(!cached&&id===searchId.current)setSearchBusy(true);
   const qs=new URLSearchParams({search:term});
   void onceFolderRequest(key+':search',
     ()=>call<Page>('/integrations/dropbox/'+encodeURIComponent(currentViewing.connectionId)+
       '/folders/'+encodeURIComponent(folderId)+'/items?'+qs)
   ).then(data=>{
    if(id!==searchId.current)return;
    setCachedFolder(key,{files:data.files,nextPageToken:data.nextPageToken});
    setRemote({term,folder:folderId,files:data.files,next:data.nextPageToken});
   }).catch(e=>{
    if(id===searchId.current)setError(e instanceof Error?e.message:'Falha na busca.');
   }).finally(()=>{if(id===searchId.current)setSearchBusy(false)});
  },300);
  return()=>window.clearTimeout(handle);
 },[search,viewing?.id,currentFolder,call,user?.uid]);
 async function moreSearch(){
  if(!viewing||!user||!remote?.next||searchBusy)return;
  const previous=remote;
  const reqId=searchId.current;
  const qs=new URLSearchParams({search:previous.term,pageToken:previous.next!});
  setSearchBusy(true);
  try{
   const response=await onceFolderRequest(
    cacheKey(user.uid,viewing.connectionId,previous.folder,previous.term,previous.next,'dropbox')+':search-page',
    ()=>call<Page>('/integrations/dropbox/'+encodeURIComponent(viewing.connectionId)+
      '/folders/'+encodeURIComponent(previous.folder)+'/items?'+qs));
   if(reqId!==searchId.current)return;
   const files=[...previous.files,...response.files.filter(f=>!previous.files.some(x=>x.id===f.id))];
   setRemote({term:previous.term,folder:previous.folder,files,next:response.nextPageToken});
   setCachedFolder(cacheKey(user.uid,viewing.connectionId,previous.folder,previous.term,'','dropbox'),
     {files,nextPageToken:response.nextPageToken});
  }catch(e){if(reqId===searchId.current)setError(e instanceof Error?e.message:'Falha ao carregar a próxima página.')}
  finally{if(reqId===searchId.current)setSearchBusy(false)}
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
 }),[transfers.subscribe,user?.uid,viewing,currentFolder]);
 const displayed=items.filter(f=>!isStorageFolder(f.mimeType));
 const openItem=(file:DriveItem)=>isStorageFolder(file.mimeType)?
  viewing&&void load(viewing,file.id,[...path,{id:file.id,name:file.name}]):setPreview(file);
 const previewList=displayed.filter(f=>f.mimeType.startsWith('image/')||f.mimeType.startsWith('video/')||
  f.mimeType.startsWith('audio/')||isDropboxDocument(f));
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
    <button className="secondary-button" type="button" aria-label="Atualizar Dropbox"
      disabled={busy||disabled||fileBusy} onClick={()=>void refresh().then(()=>{
       if(viewing)void load(viewing,currentFolder,path,undefined,false,true);
      }).catch(e=>setError(e instanceof Error?e.message:'Falha ao atualizar.'))}>
      <RefreshCw size={16}/></button>
    {validAccounts.length>0?<button type="button" className="primary-button" disabled={disabled||busy||!projects.length}
      onClick={()=>{
       setPickerProjectId(selectedProjectId&&projects.some(project=>project.id===selectedProjectId)
         ?selectedProjectId:projects.length===1?projects[0].id:0);
       setPickerError('');setResult('');setPicker(true);
      }}><Plus size={16}/> Vincular pasta</button>:
      <button className="primary-button" disabled={disabled||busy||!ready} onClick={()=>void start()}><Cloud size={16}/> Conectar Dropbox</button>}
   </div>
  </header>
  {!ready&&<div className="rl-status" role="status"><LoaderCircle className="rl-spin" size={16}/> Carregando Dropbox…</div>}
  {callback==='connected'&&<div className="rl-status" role="status"><Check size={16}/> Conta Dropbox conectada.</div>}
  {callback==='cancelled'&&<div className="rl-status">Autorização cancelada.</div>}
  {callback&&callback!=='connected'&&callback!=='cancelled'&&
   <div className="rl-status" role="alert">{messages[callback]||'Não foi possível concluir a autorização do Dropbox. Tente conectar novamente.'}</div>}
  {error&&<div className="rl-status" role="alert">{error}</div>}
  {result&&<div className="rl-status" role="status">{result}</div>}
  {!projects.length&&<p className="rl-status">Crie um projeto para organizar e vincular suas pastas do Dropbox.</p>}
  <div className="rl-explorer" data-mobile-detail={!!viewing}>
   <aside className="rl-folders" aria-label="Pastas Dropbox vinculadas">
    <div className="rl-folders-header"><h3>Pastas {selectedProjectId?'do projeto':'dos projetos'}</h3><small>{relevant.length}</small></div>
    <div className="rl-folder-list">
     {relevant.map(link=><div className="rl-folder-entry" key={link.id} data-active={viewing?.id===link.id}>
      <button type="button" className="rl-folder-button" onClick={()=>void load(link,link.folderId,[{id:link.folderId,name:link.folderName}])}>
       <FolderOpen size={18}/><span><b>{link.folderName}</b><small>{projects.find(p=>p.id===link.projectId)?.name||'Projeto'}</small></span>
      </button>
      <FolderActionsMenu name={link.folderName} disabled={busy}
        onOpen={()=>void load(link,link.folderId,[{id:link.folderId,name:link.folderName}])}
        onUnlink={()=>setUnlinkTarget(link)}/>
     </div>)}
     {!relevant.length&&<div className="rl-state"><FolderOpen size={26}/><p>Nenhuma pasta Dropbox vinculada.</p></div>}
    </div>
   </aside>
   <DriveFileExplorer provider="dropbox" externalUrl={dropboxWebUrl} folderName={viewing?.folderName}
    path={path} files={items} loading={fileBusy} hasMore={search.trim().length>=2?!!remote?.next:!!filesPage}
    thumbnailScope={(user?.uid||'')+':'+(viewing?.connectionId||account?.id||'')} getThumbnail={getThumbnail}
    searchResults={remote?.folder===currentFolder?remote.files:undefined} searchTerm={remote?.term}
    searchLoading={searchBusy} onSearchChange={setSearch}
    onBack={()=>{
     // Explicit navigation overrides the initial auto-selection, even when a
     // newly linked folder was opened before the initial effect could run.
     autoOpened.current=(selectedProjectId||'all')+':'+(relevant[0]?.id||'');
     ++requestId.current;++searchId.current;setViewing(null);setItems([]);setPath([]);
    }}
    onNavigate={(id,next)=>{if(viewing)void load(viewing,id,next)}}
    onOpen={openItem} onUploadFiles={upload} uploadDisabled={!viewing||busy||fileBusy}
    onMore={()=>{if(search.trim().length>=2)void moreSearch();else if(viewing&&filesPage)void load(viewing,currentFolder,path,filesPage,true)}}/>
  </div>
  {picker&&<StorageFolderPicker provider="dropbox" projects={projects}
   projectId={pickerProjectId||undefined} onProjectChange={value=>setPickerProjectId(Number(value)||0)}
   folders={pickerItems.filter(item=>isStorageFolder(item.mimeType))} path={pickerPath}
   loading={pickerBusy} working={busy} canRead={!!account} hasMore={!!pickerPage}
   linkedIds={new Set(links.filter(l=>l.projectId===pickerProjectId&&l.connectionId===account?.id).map(l=>l.folderId))}
   error={pickerError}
   onClose={()=>{++pickerId.current;setPicker(false);setPickerError('');}}
   onNavigate={(id,trail)=>void browsePicker(id,trail)}
   onRetry={()=>void browsePicker(pickerPath.at(-1)?.id||'root',pickerPath)}
   onMore={()=>void browsePicker(pickerPath.at(-1)?.id||'root',pickerPath,pickerPage||undefined,true)}
   onLink={linkFolders} onLinkCurrent={folder=>linkFolders([folder])}
   onConnect={()=>void start()}/>}

  {unlinkTarget&&<DriveUnlinkConfirm name={unlinkTarget.folderName} busy={busy}
    onCancel={()=>setUnlinkTarget(null)} onConfirm={()=>void unlink(unlinkTarget)}/>}
  {preview&&viewing&&<DropboxPreview file={preview} link={viewing} onClose={()=>setPreview(null)}
    onPrevious={previewIndex>0?()=>setPreview(previewList[previewIndex-1]):undefined}
    onNext={previewIndex>=0&&previewIndex<previewList.length-1?()=>setPreview(previewList[previewIndex+1]):undefined}/>}
 </section>;
}
