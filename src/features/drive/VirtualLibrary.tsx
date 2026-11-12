import {useCallback,useEffect,useRef,useState} from 'react';
import {FolderOpen,FolderPlus,FolderTree,RefreshCw,Trash2,RotateCcw,Search,CloudUpload,FilePlus2,FolderInput,Image as ImageIcon,FileText,FileVideo,FileAudio,File,Pencil,MoveRight,AlertCircle,Plus,LayoutGrid,List,MoreVertical,ChevronRight,X,HardDrive} from 'lucide-react';
import type {Project} from '../../domain/workspace';
import {useAuth} from '../auth/AuthProvider';
import {useDriveApi} from './drive-api';
import {AppButton} from '../ui/AppButton';
import {IconLabel} from '../ui/IconLabel';
import {AppInput} from '../ui/AppInput';
import {AppSelect} from '../ui/AppSelect';
import './virtual-library.css';
import './library-explorer.css';
import {LibraryProjectPicker} from './LibraryProjectPicker';
import {libraryFolderKey,getLibraryFolder,setLibraryFolder,libraryFolderFlight,invalidateLibraryFolders,clearLibraryFolders} from './library-folder-cache';
import {useOverlayFocus} from './DriveLibraryUI';
import {useStorageConnections} from './StorageConnectionsProvider';
import {preparePicker,pickLibraryFiles,type PickerConfig} from './google-picker';
import {DropboxLibraryPicker} from './DropboxLibraryPicker';
import {LibraryAssetPreview} from './LibraryAssetPreview';
import {API_BASE_URL} from '../../lib/environment';
import {messages} from './drive-api';
import {useDriveTransfers} from './DriveTransfersProvider';
import {rememberLibraryOAuthReturn,readLibraryOAuthReturn,forgetLibraryOAuthReturn} from './library-oauth-return';
import {importLibraryBatch,type LibraryImport,type FailedLibraryImport} from './library-import';
import {LibraryConnections} from './LibraryConnections';
import {LibraryStructureDialog} from './LibraryStructureDialog';
import {AssistedLibraryImport} from './AssistedLibraryImport';
import {expandDropboxTree} from './expand-dropbox-tree';
import googleDriveMark from '../../assets/brand/google-drive.svg';
import dropboxMark from '../../assets/brand/dropbox.svg';
import type {InspectedLibrarySource,LibraryInspection} from '../../../shared/library-selection';
type Node={id:string;parent_id:string|null;kind:'folder'|'asset';name:string;revision:number;provider?:string;source_state?:string;mime_type?:string;parent_name?:string};
type Page={nodes:Node[];trail:{id:string;name:string}[];nextPage:string|null};
export function VirtualLibrary({projects,selectedProjectId,onSelectProject}:{projects:readonly Project[];selectedProjectId?:number;onSelectProject:(id:string)=>void}){
 const {user}=useAuth(),call=useDriveApi();
 const storage=useStorageConnections();
 const transfers=useDriveTransfers(),fileInput=useRef<HTMLInputElement>(null),uploadProvider=useRef<'google_drive'|'dropbox'>('google_drive');
 const [accountId,setAccountId]=useState(''),[picker,setPicker]=useState<{connectionId:string;config:PickerConfig}|null>(null),[progress,setProgress]=useState('');
 const accounts=storage.connections.filter(x=>x.provider==='google_drive'&&x.status==='connected');
 const account=accounts.find(x=>x.id===accountId)||accounts[0];
 const dropboxAccounts=storage.connections.filter(x=>x.provider==='dropbox'&&x.status==='connected');
 const [dropboxId,setDropboxId]=useState(''),[dropboxPicker,setDropboxPicker]=useState(false);
 const dropbox=dropboxAccounts.find(x=>x.id===dropboxId)||dropboxAccounts[0];
 const [parent,setParent]=useState('root'),[loadedPage,setPage]=useState<(Page&{scope:string})|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [returnNotice,setReturnNotice]=useState('');
 const [loadingPage,setLoadingPage]=useState(false),[searchAll,setSearchAll]=useState(true);
 const [layout,setLayout]=useState<'list'|'grid'>(()=>{try{return localStorage.getItem('roteiva-library-layout')==='grid'?'grid':'list';}catch{return 'list';}});
 const [addOpen,setAddOpen]=useState(false),[settingsOpen,setSettingsOpen]=useState(false),[menuNode,setMenuNode]=useState<Node|null>(null);
 const [edit,setEdit]=useState<{node?:Node;action:'create'|'rename'|'trash'|'restore'|'move'}|null>(null),[name,setName]=useState('');
 const [trash,setTrash]=useState(false),[moveParent,setMoveParent]=useState('root'),[movePage,setMovePage]=useState<Page|null>(null);
 const moveGeneration=useRef(0),[moveBusy,setMoveBusy]=useState(false);
 const [preview,setPreview]=useState<Node|null>(null);
 const [structure,setStructure]=useState(false);
 const [dropboxStructure,setDropboxStructure]=useState(false),[assisted,setAssisted]=useState<{parentId:string;sources:InspectedLibrarySource[];failed:{name:string;code:string}[];recursive?:boolean}|null>(null);
 const [search,setSearch]=useState(''),[term,setTerm]=useState('');
 const [failedImports,setFailedImports]=useState<{parentId:string;items:FailedLibraryImport[]}|null>(null);
 const generation=useRef(0),loadRevision=useRef(0),mutation=useRef<AbortController|null>(null);
 const dialogRef=useOverlayFocus(()=>{if(!busy)setEdit(null);},Boolean(edit),edit?.action+':'+edit?.node?.id);
 const base=selectedProjectId?'/library/projects/'+selectedProjectId+'/nodes':'';
 const oauthReturned=new URLSearchParams(window.location.search).has('drive')||new URLSearchParams(window.location.search).has('dropbox');
 const pageScope=libraryFolderKey(user?.uid||'anonymous',selectedProjectId||0,parent,trash,term,searchAll);
 const page=loadedPage?.scope===pageScope?loadedPage:getLibraryFolder<Node>(pageScope)?.data||null;
 useEffect(()=>{try{localStorage.setItem('roteiva-library-layout',layout);}catch{/* optional preference */}},[layout]);
 useEffect(()=>{
  if(!addOpen&&!settingsOpen&&!menuNode)return;
  const outside=(e:PointerEvent)=>{
   if(!(e.target as Element)?.closest?.('.vl-add-shell,.vl-context-menu,.vl-menu-trigger,.vl-accounts-popover,.vl-settings-trigger')){
    setAddOpen(false);setSettingsOpen(false);setMenuNode(null);
   }
  };
  document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside);
 },[addOpen,settingsOpen,menuNode]);
 useEffect(()=>{const timer=setTimeout(()=>setTerm(search.trim().length>=2?search.trim():''),280);return()=>clearTimeout(timer);},[search]);
 useEffect(()=>{setSearch('');setTerm('');},[parent,selectedProjectId,trash]);
 useEffect(()=>{
  const params=new URLSearchParams(window.location.search),result=params.get('drive')||params.get('dropbox');
  if(result&&result!=='connected'&&result!=='cancelled')setError(messages[result]||'Não foi possível conectar a conta. Tente novamente.');
 },[]);
 async function connect(provider:'drive'|'dropbox'){
  if(busy)return;setBusy(true);setError('');
  try{const result=await call<{launchUrl:string}>('/oauth/'+provider+'/start','POST');const target=new URL(result.launchUrl);
   if(target.origin!==API_BASE_URL||target.pathname!=='/oauth/'+provider+'/launch')throw new Error('O endereço de conexão recebido não é válido.');
   if(user?.uid&&selectedProjectId)rememberLibraryOAuthReturn(user.uid,selectedProjectId,parent);
   else forgetLibraryOAuthReturn();
   window.location.assign(target.href);
  }catch(e){setError(e instanceof Error?e.message:'Não foi possível conectar a conta.');setBusy(false);}
 }
 useEffect(()=>{
 setPicker(null);if(!base||!account)return;const controller=new AbortController();
 void Promise.all([preparePicker(),call<PickerConfig>(base.replace('/nodes','/picker/')+account.id,'GET',undefined,controller.signal)])
 .then(([,config])=>{if(!controller.signal.aborted)setPicker({connectionId:account.id,config});})
 .catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Não foi possível preparar o Drive.');});
 return()=>controller.abort();
 },[base,account?.id,call]);
 const load=useCallback(async(after?:string,force=true)=>{
  if(!base||!user)return;
  const revision=++loadRevision.current;
  const cached=!after?getLibraryFolder<Node>(pageScope):null;
  if(cached)setPage({...cached.data,scope:pageScope});
  if(cached&&!cached.stale&&!force)return;
  if(!cached&&!after)setLoadingPage(true);
  setError('');
  try{
   const path=base+'?'+new URLSearchParams({parent,...(trash?{trash:'1'}:{explorer:'1'}),
    ...(term?{q:term,scope:searchAll?'project':'folder'}:{}),...(after?{after}:{})}).toString();
   const value=await libraryFolderFlight(pageScope+':'+(after||'first'),()=>call<Page>(path));
   if(revision!==loadRevision.current)return;
   const old=after?getLibraryFolder<Node>(pageScope)?.data:null;
   const next={...value,scope:pageScope,nodes:after&&old?[...old.nodes,...value.nodes]:value.nodes};
   setLibraryFolder(pageScope,next);setPage(next);
  }catch(e){if(revision===loadRevision.current){
   const code=(e as {code?:string}).code;
   if(parent!=='root'&&(code==='library_node_unavailable'||code==='library_parent_denied')){
    setReturnNotice('A pasta anterior não está mais disponível. Abrimos a pasta Arquivos.');setParent('root');
   }else if(code==='library_project_denied'){
    setReturnNotice('O projeto anterior não está disponível. Selecione outro projeto.');onSelectProject('');
   }else setError(e instanceof Error?e.message:'Não foi possível carregar a pasta.');
  }}finally{if(revision===loadRevision.current)setLoadingPage(false);}
 },[base,user?.uid,call,parent,trash,pageScope,term,searchAll,onSelectProject]);
 useEffect(()=>transfers.subscribe((_file,destination)=>{
  if(destination.projectId===selectedProjectId&&destination.linkedFolderId===parent&&!mutation.current){if(user?.uid&&selectedProjectId)invalidateLibraryFolders(user.uid,selectedProjectId);void load();}
 }),[transfers.subscribe,selectedProjectId,parent,load]);
 async function upload(files:File[]){
  if(!files.length||!selectedProjectId||busy)return;
  const provider=uploadProvider.current,connection=provider==='dropbox'?dropbox:account;
  if(!connection){setError('Conecte uma conta antes de enviar.');return;}
  const scope=generation.current,projectId=selectedProjectId,nodeId=parent,controller=new AbortController();mutation.current=controller;
  setBusy(true);setError('');setProgress('Preparando o destino do envio…');
  try{
   const target=await call<{targetFolderId:string}>('/library/projects/'+projectId+'/uploads/destination','POST',{provider,connectionId:connection.id,nodeId},controller.signal);
   if(scope!==generation.current||controller.signal.aborted)return;
   const result=transfers.enqueue(files,{provider,connectionId:connection.id,projectId,linkedFolderId:nodeId,targetFolderId:target.targetFolderId,folderName:page?.trail.at(-1)?.name||'Arquivos'});
   if(result.rejected)setError(result.rejected+' arquivo(s) excedem os limites ou a capacidade da fila. Os demais foram adicionados.');
  }catch(e){if(scope===generation.current&&!controller.signal.aborted)setError(e instanceof Error?e.message:'Não foi possível preparar o envio.');}
  finally{if(mutation.current===controller){mutation.current=null;setProgress('');}if(scope===generation.current)setBusy(false);}
 }
 useEffect(()=>{
 ++moveGeneration.current;setMoveBusy(false);setMovePage(null);if(edit?.action!=='move'||!base)return;const controller=new AbortController();
 void call<Page>(base+'?parent='+encodeURIComponent(moveParent),'GET',undefined,controller.signal).then(p=>{if(!controller.signal.aborted)setMovePage(p);}).catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Não foi possível carregar o destino.');});
 return()=>controller.abort();
 },[edit?.action,base,moveParent,call]);
 useEffect(()=>{setParent('root');setPage(null);setEdit(null);setPreview(null);setStructure(false);setAssisted(null);setDropboxPicker(false);setFailedImports(null);mutation.current?.abort();++generation.current;},[selectedProjectId,user?.uid]);
 // OAuth reloads React; restore only a short-lived hint for the same UID.
 // The API revalidates project ownership and the selected folder ancestors.
 useEffect(()=>{
  if(!oauthReturned||!user?.uid)return;
  const intent=readLibraryOAuthReturn(user.uid);if(!intent)return;
  if(selectedProjectId!==intent.projectId){onSelectProject(String(intent.projectId));return;}
  forgetLibraryOAuthReturn();setParent(intent.parentId);
 },[oauthReturned,user?.uid,selectedProjectId,onSelectProject]);
 useEffect(()=>{const cached=getLibraryFolder<Node>(pageScope);setPage(cached?{...cached.data,scope:pageScope}:null);void load(undefined,false);return()=>{++loadRevision.current;++generation.current;};},[pageScope]);
 const lastCacheUser=useRef(user?.uid);
 useEffect(()=>{if(lastCacheUser.current&&lastCacheUser.current!==user?.uid)clearLibraryFolders(lastCacheUser.current);lastCacheUser.current=user?.uid;},[user?.uid]);
 useEffect(()=>()=>mutation.current?.abort(),[]);
 async function performImport(items:LibraryImport[],target:string,controller:AbortController,scope:number){
  const failed=await importLibraryBatch(call,base.replace('/nodes','/imports'),target,items,controller.signal,(done,total)=>setProgress('Adicionando '+done+' de '+total+' arquivos…'));
  if(scope!==generation.current||controller.signal.aborted)return;
  setFailedImports(failed.length?{parentId:target,items:failed}:null);if(user?.uid&&selectedProjectId)invalidateLibraryFolders(user.uid,selectedProjectId);await load();
 }
 async function inspectSelection(items:LibraryImport[],target:string,controller:AbortController,scope:number,folderIds?:ReadonlySet<string>){
  const sources:InspectedLibrarySource[]=[],failed:{name:string;code:string}[]=[];
  for(let i=0;i<items.length;i+=3){
   if(controller.signal.aborted)return;setProgress('Conferindo '+Math.min(i+3,items.length)+' de '+items.length+' itens selecionados…');
   const batch=items.slice(i,i+3);
   try{
    const reply=await call<{results:LibraryInspection[]}>(base.replace('/nodes','/inspect'),'POST',{provider:batch[0].provider,connectionId:batch[0].connectionId,items:batch.map(x=>({fileId:x.fileId,resourceKey:x.resourceKey}))},controller.signal);
    for(const item of batch){const result=reply.results.find(x=>x.fileId===item.fileId);if(result?.status==='ready')sources.push(result.source);else failed.push({name:item.name,code:result?.status==='failed'?result.code:'service_unavailable'});}
   }catch(e){if(controller.signal.aborted)return;failed.push(...items.slice(i).map(x=>({name:x.name,code:(e as {code?:string}).code||'service_unavailable'})));break;}
  }
  if(folderIds?.size&&scope===generation.current&&!controller.signal.aborted){
   const expanded=await expandDropboxTree(call,items[0].connectionId,sources,folderIds,controller.signal,
    (folders,files)=>setProgress('Lendo Dropbox: '+folders+' pastas e '+files+' arquivos…'));
   sources.splice(0,sources.length,...expanded);
  }
  if(scope===generation.current&&!controller.signal.aborted)setAssisted({parentId:target,sources,failed,recursive:Boolean(folderIds?.size)});
 }
 async function addDropbox(ids:string[],names:Map<string,string>,folderIds:Set<string>){
 if(!dropbox||busy)return;setDropboxPicker(false);const controller=new AbortController();mutation.current=controller;
 const scope=generation.current,target=parent;setBusy(true);setError('');
 try{const items=ids.map((fileId,i)=>({provider:'dropbox' as const,connectionId:dropbox.id,fileId,name:names.get(fileId)||'Arquivo '+(i+1)}));if(dropboxStructure)await inspectSelection(items,target,controller,scope,folderIds);else await performImport(items,target,controller,scope);
 }catch(e){if(!controller.signal.aborted&&scope===generation.current)setError(e instanceof Error?e.message:'Não foi possível adicionar os arquivos.');}
 finally{if(mutation.current===controller){mutation.current=null;setProgress('');}if(scope===generation.current)setBusy(false);}
 }
 async function addDrive(withStructure=false){
 if(!picker||!account||picker.connectionId!==account.id||busy)return;
 const controller=new AbortController();mutation.current=controller;const scope=generation.current,target=parent;setBusy(true);setError('');
 try{
 const names=new Map<string,string>(),keys=new Map<string,string>();
 const ids=await pickLibraryFiles(picker.config,accessToken=>call('/integrations/drive/'+account.id+'/picker/verify','POST',{accessToken},controller.signal),controller.signal,{includeFolders:withStructure,title:withStructure?'Selecionar pastas e arquivos para organizar no Roteiva':undefined,onDocuments:docs=>{for(const doc of docs){if(doc.name)names.set(doc.id,doc.name);if(doc.resourceKey)keys.set(doc.id,doc.resourceKey);}}});
 if(ids.length){const items=ids.map((fileId,i)=>({provider:'google_drive' as const,connectionId:account.id,fileId,name:names.get(fileId)||'Arquivo '+(i+1),resourceKey:keys.get(fileId)}));if(withStructure)await inspectSelection(items,target,controller,scope);else await performImport(items,target,controller,scope);}
 }catch(e){if(!controller.signal.aborted&&scope===generation.current)setError(e instanceof Error?e.message:'Não foi possível adicionar os arquivos.');}
 finally{if(mutation.current===controller){mutation.current=null;setProgress('');}if(scope===generation.current)setBusy(false);}
 }
 async function retryImports(){
  if(!failedImports||busy)return;const scope=generation.current,controller=new AbortController();mutation.current=controller;setBusy(true);setError('');
  try{await performImport(failedImports.items,failedImports.parentId,controller,scope);}
  catch(e){if(!controller.signal.aborted&&scope===generation.current)setError(e instanceof Error?e.message:'Não foi possível repetir a importação.');}
  finally{if(mutation.current===controller){mutation.current=null;setProgress('');}if(scope===generation.current)setBusy(false);}
 }
 async function save(){
 if(!edit||!base||busy)return;const operation=edit,scope=generation.current,controller=new AbortController();mutation.current=controller;setBusy(true);setError('');
 try{await call(base+(operation.node?'/'+operation.node.id:''),'POST',operation.node?
 {action:operation.action,name,parentId:moveParent,revision:operation.node.revision}:{name,parentId:parent},controller.signal);
 if(scope===generation.current){setEdit(null);if(user?.uid&&selectedProjectId)invalidateLibraryFolders(user.uid,selectedProjectId);await load();}
 }catch(e){if(!controller.signal.aborted&&scope===generation.current)setError(e instanceof Error?e.message:'Não foi possível salvar.');}
 finally{if(mutation.current===controller)mutation.current=null;if(scope===generation.current)setBusy(false);}
 }
 const openEditor=(action:'rename'|'move'|'trash'|'restore',node:Node)=>{
  setMenuNode(null);setError('');setEdit({action,node});
  if(action==='rename')setName(node.name);
  if(action==='move')setMoveParent('root');
 };
 const showAdd=(action:'new'|'drive-upload'|'dropbox-upload'|'drive-file'|'dropbox-file'|'drive-tree'|'dropbox-tree')=>{
  setAddOpen(false);setError('');
  if(action==='new'){setName('');setEdit({action:'create'});}
  else if(action==='drive-upload'||action==='dropbox-upload'){uploadProvider.current=action==='drive-upload'?'google_drive':'dropbox';fileInput.current?.click();}
  else if(action==='drive-file'||action==='drive-tree')void addDrive(action==='drive-tree');
  else{setDropboxStructure(action==='dropbox-tree');setDropboxPicker(true);}
 };
 return <section className="panel virtual-library vl-explorer" aria-label="Explorador da Biblioteca">
  <header className="vl-explorer-head">
   <LibraryProjectPicker projects={projects} value={selectedProjectId} onChange={onSelectProject}/>
   <div className="vl-explorer-actions">
    <AppButton className="vl-settings-trigger" aria-label="Contas de armazenamento" title="Contas conectadas" aria-expanded={settingsOpen} onClick={()=>{setSettingsOpen(x=>!x);setAddOpen(false);setMenuNode(null);}}><HardDrive size={18}/><span>{storage.connections.filter(c=>c.status==='connected').length}</span></AppButton>
    <AppButton className="vl-refresh" aria-label="Atualizar pasta" title="Atualizar pasta" disabled={!base||busy||loadingPage} onClick={()=>void load()}><RefreshCw size={18}/></AppButton>
    {base&&!trash&&<div className="vl-add-shell">
     <AppButton className="vl-primary-add" aria-label="Adicionar" aria-expanded={addOpen} onClick={()=>{setAddOpen(x=>!x);setMenuNode(null);setSettingsOpen(false);}}><Plus size={18}/>Adicionar</AppButton>
     {addOpen&&<div className="vl-add-menu" role="group" aria-label="Adicionar à Biblioteca">
      <AppButton onClick={()=>showAdd('new')}><FolderPlus size={18}/> Nova pasta</AppButton>
      <div className="vl-menu-divider"/>
      <AppButton disabled={!account} onClick={()=>showAdd('drive-upload')}><CloudUpload size={18}/> Enviar ao Google Drive</AppButton>
      <AppButton disabled={!dropbox} onClick={()=>showAdd('dropbox-upload')}><CloudUpload size={18}/> Enviar ao Dropbox</AppButton>
      <div className="vl-menu-divider"/>
      <AppButton disabled={!picker||picker.connectionId!==account?.id} onClick={()=>showAdd('drive-file')}><img src={googleDriveMark} alt=""/> Adicionar do Drive</AppButton>
      <AppButton disabled={!dropbox} onClick={()=>showAdd('dropbox-file')}><img src={dropboxMark} alt=""/> Adicionar do Dropbox</AppButton>
      <AppButton disabled={!picker||picker.connectionId!==account?.id} onClick={()=>showAdd('drive-tree')}><FolderTree size={18}/> Trazer organização do Drive</AppButton>
      <AppButton disabled={!dropbox} onClick={()=>showAdd('dropbox-tree')}><FolderTree size={18}/> Trazer organização do Dropbox</AppButton>
     </div>}
    </div>}
   </div>
  </header>
  {settingsOpen&&<div className="vl-accounts-popover">
   <div className="vl-popover-head"><strong>Contas de armazenamento</strong><AppButton aria-label="Fechar contas" onClick={()=>setSettingsOpen(false)}><X size={18}/></AppButton></div>
   {accounts.length>1&&<label>Google Drive<AppSelect aria-label="Conta Google Drive" value={account?.id||''} onValueChange={setAccountId}>{accounts.map(x=><option key={x.id} value={x.id}>{x.email}</option>)}</AppSelect></label>}
   {dropboxAccounts.length>1&&<label>Dropbox<AppSelect aria-label="Conta Dropbox" value={dropbox?.id||''} onValueChange={setDropboxId}>{dropboxAccounts.map(x=><option key={x.id} value={x.id}>{x.email}</option>)}</AppSelect></label>}
   <LibraryConnections busy={busy} onConnect={provider=>void connect(provider)}/>
  </div>}
  {storage.error&&<div role="alert" className="vl-compact-alert"><AlertCircle size={17}/><span>Falha ao verificar {storage.error}.</span><AppButton onClick={()=>void storage.refresh(true)}>Tentar novamente</AppButton></div>}
  {returnNotice&&<div role="status" className="vl-compact-alert"><AlertCircle size={17}/><span>{returnNotice}</span><AppButton onClick={()=>setReturnNotice('')}>Dispensar</AppButton></div>}
  {error&&<div role="alert" className="vl-compact-alert"><AlertCircle size={17}/><span>{error}</span><AppButton onClick={()=>setError('')} aria-label="Dispensar erro"><X size={16}/></AppButton></div>}
  {failedImports&&<div role="alert" className="vl-compact-alert"><AlertCircle size={17}/><span>{failedImports.items.length} item(ns) não foram adicionados: {failedImports.items.slice(0,2).map(x=>x.name).join(', ')}{failedImports.items.length>2?' e outros.':'.'} Os demais foram preservados.</span><AppButton disabled={busy} onClick={()=>void retryImports()}>Tentar somente os arquivos pendentes</AppButton><AppButton onClick={()=>setFailedImports(null)}>Dispensar</AppButton></div>}
  {!base?<div className="vl-explorer-empty"><FolderOpen size={40}/><h3>Selecione um projeto</h3><p>Pesquise um projeto acima para acessar e organizar seus arquivos.</p></div>:<>
   <div className="vl-explorer-toolbar">
    <nav aria-label="Caminho da pasta" className="vl-explorer-breadcrumb">
     {(page?.trail||[{id:'root',name:trash?'Lixeira':'Arquivos'}]).map((crumb,i)=><span key={crumb.id} className="vl-path-part">
      {i>0&&<ChevronRight size={15}/>}
      <AppButton disabled={loadingPage} onClick={()=>setParent(crumb.id)} aria-current={crumb.id===parent?'location':undefined}>{crumb.name}</AppButton>
     </span>)}
    </nav>
    <div className="vl-toolbar-end">
     <AppButton className="vl-small-tool" disabled={loadingPage||busy} aria-label={trash?'Voltar aos arquivos':'Lixeira'} onClick={()=>{setTrash(x=>!x);setParent('root');}}>{trash?<RotateCcw size={17}/>:<Trash2 size={17}/>}<span>{trash?'Voltar':'Lixeira'}</span></AppButton>
     <AppButton className="vl-small-tool" disabled={busy||trash} onClick={()=>setStructure(true)} aria-label="Estrutura de pastas"><FolderTree size={17}/><span>Pastas</span></AppButton>
     <div className="vl-layout-control" role="group" aria-label="Visualização dos arquivos">
      <AppButton aria-label="Exibir lista" aria-pressed={layout==='list'} onClick={()=>setLayout('list')}><List size={18}/></AppButton>
      <AppButton aria-label="Exibir grade" aria-pressed={layout==='grid'} onClick={()=>setLayout('grid')}><LayoutGrid size={18}/></AppButton>
     </div>
    </div>
   </div>
   {!trash&&<div className="vl-query">
    <label className="vl-query-input"><Search size={18}/><AppInput aria-label="Buscar arquivos e pastas" placeholder="Buscar arquivos e pastas…" value={search} maxLength={100} onChange={e=>setSearch(e.target.value)}/></label>
    {term&&<AppSelect aria-label="Pesquisar em" value={searchAll?'project':'folder'} onValueChange={v=>setSearchAll(v==='project')}><option value="project">Todo o projeto</option><option value="folder">Esta pasta</option></AppSelect>}
   </div>}
   {progress&&<p role="status" className="vl-import-status">{progress}</p>}
   {loadingPage&&!page?<div role="status" className="vl-loading-area"><RefreshCw className="vl-loading" size={22}/>Carregando arquivos…</div>:<>
    {page?.nodes.length?<ul className={'vl-explorer-items vl-explorer-items--'+layout} aria-label={trash?'Itens na lixeira':'Arquivos e pastas'}>
     {page.nodes.map(n=><li key={n.id} className="vl-explorer-item" onContextMenu={e=>{e.preventDefault();setMenuNode(n);setAddOpen(false);}}>
      <AppButton className="vl-explorer-file" disabled={trash||busy} aria-label={n.name} title={n.name}
       onClick={()=>{setMenuNode(null);if(n.kind==='folder'){setParent(n.id);setSearch('');setTerm('');}else setPreview(n);}}>
       <span className="vl-file-emblem">{n.kind==='folder'?<FolderOpen size={24}/>:
         n.mime_type?.startsWith('image/')?<ImageIcon size={23}/>:
         n.mime_type?.startsWith('video/')?<FileVideo size={23}/>:
         n.mime_type?.startsWith('audio/')?<FileAudio size={23}/>:
         n.mime_type==='application/pdf'?<FileText size={23}/>:<File size={23}/>}</span>
       <span className="vl-file-meta"><strong>{n.name}</strong><small>{term&&searchAll?n.parent_name||'Arquivos':n.kind==='folder'?'Pasta':n.provider==='google_drive'?'Google Drive':n.provider==='dropbox'?'Dropbox':'Arquivo'}</small></span>
      </AppButton>
      <div className="vl-menu-shell">
       <AppButton className="vl-menu-trigger" aria-label={'Ações de '+n.name} aria-expanded={menuNode?.id===n.id} onClick={()=>setMenuNode(old=>old?.id===n.id?null:n)}><MoreVertical size={19}/></AppButton>
       {menuNode?.id===n.id&&<div className="vl-context-menu" role="group" aria-label={'Ações de '+n.name}>
        {trash?<AppButton onClick={()=>openEditor('restore',n)}><RotateCcw size={17}/> Restaurar</AppButton>:<>
         {n.kind==='asset'&&<AppButton onClick={()=>{setMenuNode(null);setPreview(n);}}><FolderOpen size={17}/> Visualizar</AppButton>}
         <AppButton onClick={()=>openEditor('rename',n)}><Pencil size={17}/> Renomear</AppButton>
         <AppButton onClick={()=>openEditor('move',n)}><MoveRight size={17}/> Mover</AppButton>
         <div className="vl-menu-divider"/>
         <AppButton onClick={()=>openEditor('trash',n)}><Trash2 size={17}/> Remover da Biblioteca</AppButton>
        </>}
       </div>}
      </div>
     </li>)}
    </ul>:<div className="vl-explorer-empty vl-explorer-empty--folder"><FolderOpen size={32}/><h3>{term?'Nenhum resultado':trash?'Lixeira vazia':'Esta pasta está vazia'}</h3><p>{term?'Experimente outro nome ou escopo.':trash?'Itens removidos aparecem aqui.':'Use Adicionar para criar pastas e incluir arquivos.'}</p></div>}
    {page?.nextPage&&<div className="vl-loadmore"><AppButton disabled={loadingPage} onClick={()=>void load(page.nextPage!,true)}>Carregar mais</AppButton></div>}
   </>}
  </>}
  {base&&<AppInput ref={fileInput} type="file" multiple hidden onChange={e=>{const files=Array.from(e.target.files||[]);e.target.value='';void upload(files);}}/>}
 {edit&&<div className="virtual-library-backdrop"><div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="virtual-library-title" className="virtual-library-editor">
 <h3 id="virtual-library-title">{{create:'Nova pasta',rename:'Renomear',move:'Mover para',restore:'Restaurar',trash:'Remover do Roteiva'}[edit.action]}</h3>
 {error&&<div role="alert" className="virtual-library-error">{error}</div>}
 <form onSubmit={e=>{e.preventDefault();void save();}}>{(edit.action==='create'||edit.action==='rename')&&<label>Nome<AppInput aria-label="Nome" required maxLength={120} value={name} onChange={e=>setName(e.target.value)} autoFocus/></label>}{edit.action==='trash'?<p>Os arquivos originais permanecem no provedor. A organização desta pasta será removida da Biblioteca.</p>:edit.action==='restore'?<p>Restaurar esta referência na pasta anterior. Se ela também estiver na lixeira, restaure a pasta primeiro.</p>:edit.action==='move'?<><nav aria-label="Pasta de destino">{movePage?.trail.map(x=><AppButton type="button" key={x.id} onClick={()=>setMoveParent(x.id)}>{x.name}</AppButton>)}</nav>{movePage?.nodes.filter(x=>x.kind==='folder'&&x.id!==edit.node?.id).map(x=><AppButton type="button" key={x.id} onClick={()=>setMoveParent(x.id)}>{x.name}</AppButton>)}{movePage?.nextPage&&<AppButton type="button" disabled={moveBusy} onClick={()=>{const old=movePage,scope=moveGeneration.current;setMoveBusy(true);void call<Page>(base+'?parent='+encodeURIComponent(moveParent)+'&after='+old.nextPage).then(p=>{if(scope===moveGeneration.current)setMovePage({...p,nodes:[...old.nodes,...p.nodes]});}).catch(()=>{if(scope===moveGeneration.current)setError('Não foi possível carregar mais pastas.');}).finally(()=>{if(scope===moveGeneration.current)setMoveBusy(false);});}}>Mais pastas</AppButton>}</>:null}
 <div className="virtual-library-toolbar"><AppButton type="submit" disabled={busy||edit.action==='move'&&!movePage}>Confirmar</AppButton><AppButton type="button" disabled={busy} onClick={()=>setEdit(null)}>Cancelar</AppButton></div></form>
 </div></div>}
 {dropboxPicker&&dropbox&&<DropboxLibraryPicker key={dropbox.id+':'+dropboxStructure} connectionId={dropbox.id} includeFolders={dropboxStructure} onClose={()=>setDropboxPicker(false)} onSelect={(ids,names,folderIds)=>void addDropbox(ids,names,folderIds)}/>}
 {preview&&selectedProjectId&&<LibraryAssetPreview key={preview.id} projectId={selectedProjectId} node={preview} onClose={()=>setPreview(null)}/>}
 {structure&&selectedProjectId&&<LibraryStructureDialog key={selectedProjectId+':'+parent} projectId={selectedProjectId} parentId={parent} onClose={()=>setStructure(false)} onApplied={()=>{setStructure(false);void load();}}/>}
 {assisted&&selectedProjectId&&<AssistedLibraryImport key={selectedProjectId+':'+assisted.parentId} projectId={selectedProjectId} parentId={assisted.parentId} sources={assisted.sources} unavailable={assisted.failed} recursive={assisted.recursive} onClose={()=>{setAssisted(null);void load();}} onApplied={()=>{setAssisted(null);setSearch('');setTerm('');void load();}}/>}
 </section>;
}
