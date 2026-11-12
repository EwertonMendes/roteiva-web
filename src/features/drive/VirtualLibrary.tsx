import {useCallback,useEffect,useRef,useState} from 'react';
import {FolderOpen,FolderPlus,FolderTree,Plus,RefreshCw,Trash2,RotateCcw,Search,CloudUpload,FilePlus2,FolderInput,Image as ImageIcon,FileText,FileVideo,FileAudio,File,Pencil,MoveRight,AlertCircle} from 'lucide-react';
import type {Project} from '../../domain/workspace';
import {useAuth} from '../auth/AuthProvider';
import {useDriveApi} from './drive-api';
import {AppButton} from '../ui/AppButton';
import {IconLabel} from '../ui/IconLabel';
import {AppInput} from '../ui/AppInput';
import {AppSelect} from '../ui/AppSelect';
import './virtual-library.css';
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
import googleDriveMark from '../../assets/brand/google-drive.svg';
import dropboxMark from '../../assets/brand/dropbox.svg';
import type {InspectedLibrarySource,LibraryInspection} from '../../../shared/library-selection';
type Node={id:string;parent_id:string|null;kind:'folder'|'asset';name:string;revision:number;provider?:string;source_state?:string;mime_type?:string};
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
 const [edit,setEdit]=useState<{node?:Node;action:'create'|'rename'|'trash'|'restore'|'move'}|null>(null),[name,setName]=useState('');
 const [trash,setTrash]=useState(false),[moveParent,setMoveParent]=useState('root'),[movePage,setMovePage]=useState<Page|null>(null);
 const moveGeneration=useRef(0),[moveBusy,setMoveBusy]=useState(false);
 const [preview,setPreview]=useState<Node|null>(null);
 const [structure,setStructure]=useState(false);
 const [dropboxStructure,setDropboxStructure]=useState(false),[assisted,setAssisted]=useState<{parentId:string;sources:InspectedLibrarySource[];failed:{name:string;code:string}[]}|null>(null);
 const [search,setSearch]=useState(''),[term,setTerm]=useState('');
 const [failedImports,setFailedImports]=useState<{parentId:string;items:FailedLibraryImport[]}|null>(null);
 const generation=useRef(0),mutation=useRef<AbortController|null>(null);
 const dialogRef=useOverlayFocus(()=>{if(!busy)setEdit(null);},Boolean(edit),edit?.action+':'+edit?.node?.id);
 const base=selectedProjectId?'/library/projects/'+selectedProjectId+'/nodes':'';
 const oauthReturned=new URLSearchParams(window.location.search).has('drive')||new URLSearchParams(window.location.search).has('dropbox');
 const pageScope=base+':'+parent+':'+trash+':'+term;
 const page=loadedPage?.scope===pageScope?loadedPage:null;
 useEffect(()=>{const timer=setTimeout(()=>setTerm(search.trim()),300);return()=>clearTimeout(timer);},[search]);
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
 const load=useCallback(async(after?:string)=>{
 if(!base||!user)return;const revision=++generation.current;setBusy(true);setError('');
 try{const value=await call<Page>(base+'?parent='+encodeURIComponent(parent)+(trash?'&trash=1':'')+(term?'&q='+encodeURIComponent(term):'')+(after?'&after='+encodeURIComponent(after):''));
 if(revision===generation.current)setPage(old=>({...value,scope:pageScope,nodes:after&&old?.scope===pageScope?[...old.nodes,...value.nodes]:value.nodes}));
 }catch(e){if(revision===generation.current){
  const code=(e as {code?:string}).code;
  if(parent!=='root'&&(code==='library_node_unavailable'||code==='library_parent_denied')){
   setReturnNotice('A pasta anterior não está mais disponível. Abrimos a pasta Arquivos.');setParent('root');
  }else if(code==='library_project_denied'){
   setReturnNotice('O projeto anterior não está mais disponível. Selecione outro projeto.');onSelectProject('');
  }else setError(e instanceof Error?e.message:'Não foi possível carregar a pasta.');
 }}
 finally{if(revision===generation.current)setBusy(false);}
 },[base,user,call,parent,trash,pageScope,term,onSelectProject]);
 useEffect(()=>transfers.subscribe((_file,destination)=>{
  if(destination.projectId===selectedProjectId&&destination.linkedFolderId===parent&&!mutation.current)void load();
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
 useEffect(()=>{setPage(null);void load();return()=>{++generation.current;};},[load]);
 useEffect(()=>()=>mutation.current?.abort(),[]);
 async function performImport(items:LibraryImport[],target:string,controller:AbortController,scope:number){
  const failed=await importLibraryBatch(call,base.replace('/nodes','/imports'),target,items,controller.signal,(done,total)=>setProgress('Adicionando '+done+' de '+total+' arquivos…'));
  if(scope!==generation.current||controller.signal.aborted)return;
  setFailedImports(failed.length?{parentId:target,items:failed}:null);await load();
 }
 async function inspectSelection(items:LibraryImport[],target:string,controller:AbortController,scope:number){
  const sources:InspectedLibrarySource[]=[],failed:{name:string;code:string}[]=[];
  for(let i=0;i<items.length;i+=3){
   if(controller.signal.aborted)return;setProgress('Conferindo '+Math.min(i+3,items.length)+' de '+items.length+' itens selecionados…');
   const batch=items.slice(i,i+3);
   try{
    const reply=await call<{results:LibraryInspection[]}>(base.replace('/nodes','/inspect'),'POST',{provider:batch[0].provider,connectionId:batch[0].connectionId,items:batch.map(x=>({fileId:x.fileId,resourceKey:x.resourceKey}))},controller.signal);
    for(const item of batch){const result=reply.results.find(x=>x.fileId===item.fileId);if(result?.status==='ready')sources.push(result.source);else failed.push({name:item.name,code:result?.status==='failed'?result.code:'service_unavailable'});}
   }catch(e){if(controller.signal.aborted)return;failed.push(...items.slice(i).map(x=>({name:x.name,code:(e as {code?:string}).code||'service_unavailable'})));break;}
  }
  if(scope===generation.current&&!controller.signal.aborted)setAssisted({parentId:target,sources,failed});
 }
 async function addDropbox(ids:string[],names:Map<string,string>){
 if(!dropbox||busy)return;setDropboxPicker(false);const controller=new AbortController();mutation.current=controller;
 const scope=generation.current,target=parent;setBusy(true);setError('');
 try{const items=ids.map((fileId,i)=>({provider:'dropbox' as const,connectionId:dropbox.id,fileId,name:names.get(fileId)||'Arquivo '+(i+1)}));if(dropboxStructure)await inspectSelection(items,target,controller,scope);else await performImport(items,target,controller,scope);
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
 if(scope===generation.current){setEdit(null);await load();}
 }catch(e){if(!controller.signal.aborted&&scope===generation.current)setError(e instanceof Error?e.message:'Não foi possível salvar.');}
 finally{if(mutation.current===controller)mutation.current=null;if(scope===generation.current)setBusy(false);}
 }
 return <section className="panel virtual-library" aria-label="Arquivos do projeto">
 <header className="vl-head">
  <div className="vl-head-copy"><span className="vl-title-icon"><FolderOpen size={24} aria-hidden="true"/></span><div><h2>Arquivos do projeto</h2><p>{projects.find(p=>p.id===selectedProjectId)?.name||'Organize todos os seus materiais em um único lugar.'}</p></div></div>
  {base&&<div className="vl-main-actions">
   <AppButton className="vl-action vl-action-primary" disabled={busy||trash} onClick={()=>{setName('');setEdit({action:'create'});}}><IconLabel icon={FolderPlus}>Nova pasta</IconLabel></AppButton>
   <AppButton className="vl-icon-action" disabled={busy} aria-label="Atualizar pasta" title="Atualizar pasta" onClick={()=>void load()}><RefreshCw size={18} aria-hidden="true"/></AppButton>
  </div>}
 </header>
 <LibraryConnections busy={busy} onConnect={provider=>void connect(provider)}/>
 {storage.error&&<div className="virtual-library-error" role="alert"><AlertCircle size={18} aria-hidden="true"/><span>Não foi possível consultar {storage.error}.</span><AppButton className="vl-action" disabled={storage.loading} onClick={()=>void storage.refresh(true)}>Atualizar conexões</AppButton></div>}
 {returnNotice&&<div role="status" className="virtual-library-error"><AlertCircle size={18} aria-hidden="true"/>{returnNotice}<AppButton className="vl-action" onClick={()=>setReturnNotice('')}>Dispensar</AppButton></div>}
 {error&&<div role="alert" className="virtual-library-error"><AlertCircle size={18} aria-hidden="true"/>{error}</div>}
 {failedImports&&<div role="alert" className="virtual-library-error vl-failures"><p>Alguns arquivos não foram adicionados. Os itens confirmados foram preservados.</p><ul>{failedImports.items.map(item=><li key={item.provider+item.connectionId+item.fileId}><strong>{item.name}</strong>: {messages[item.code]||'Não foi possível confirmar o arquivo. Tente novamente.'}</li>)}</ul><div className="virtual-library-toolbar"><AppButton className="vl-action vl-action-primary" disabled={busy} onClick={()=>void retryImports()}>Tentar somente os arquivos pendentes</AppButton><AppButton className="vl-action" disabled={busy} onClick={()=>setFailedImports(null)}>Dispensar aviso</AppButton></div></div>}
 {!base?<div className="vl-empty-project"><span className="vl-empty-icon"><FolderOpen size={34} aria-hidden="true"/></span><h3>Escolha um projeto para começar</h3><p>Selecione um projeto no menu acima para visualizar arquivos, criar pastas e organizar seus materiais do Drive e Dropbox.</p></div>:
 <div className="vl-workspace">
  <div className="vl-browse-head">
   <div className="vl-section-heading"><span className="vl-section-icon"><FolderOpen size={19} aria-hidden="true"/></span><div><h3>{trash?'Lixeira':'Seus arquivos'}</h3><p>{trash?'Referências removidas da Biblioteca':'Pastas e arquivos organizados por projeto'}</p></div></div>
   <div className="vl-browse-actions">
    <AppButton className="vl-action" disabled={busy||trash} onClick={()=>setStructure(true)}><IconLabel icon={FolderTree}>Estrutura de pastas</IconLabel></AppButton>
    <AppButton className="vl-action" disabled={busy} onClick={()=>{setTrash(x=>!x);setParent('root');}}><IconLabel icon={trash?RotateCcw:Trash2}>{trash?'Voltar aos arquivos':'Lixeira'}</IconLabel></AppButton>
   </div>
  </div>
  <div className="vl-browser-tools">
   <nav aria-label="Caminho da pasta" className="virtual-library-path">{page?.trail.map(x=><AppButton className="vl-crumb" type="button" key={x.id} disabled={busy} onClick={()=>setParent(x.id)}>{x.name}</AppButton>)}</nav>
   {!trash&&<label className="vl-search"><Search size={18} aria-hidden="true"/><AppInput aria-label="Buscar nesta pasta" value={search} disabled={Boolean(progress)} maxLength={100} onChange={e=>setSearch(e.target.value)} placeholder="Buscar nesta pasta"/></label>}
  </div>
  {busy&&!page?<div className="vl-empty-folder" role="status"><RefreshCw className="vl-loading" size={23} aria-hidden="true"/><p>Carregando pasta…</p></div>:
   <>
   <ul className="virtual-library-nodes">{page?.nodes.map(n=><li className="vl-file-row" key={n.id}>
    <AppButton className="vl-file-open" disabled={busy||trash} onClick={()=>n.kind==='folder'?setParent(n.id):setPreview(n)}>
     <span className="vl-file-glyph">{n.kind==='folder'?<FolderOpen size={21} aria-hidden="true"/>:n.mime_type?.startsWith('image/')?<ImageIcon size={21} aria-hidden="true"/>:n.mime_type?.startsWith('video/')?<FileVideo size={21} aria-hidden="true"/>:n.mime_type?.startsWith('audio/')?<FileAudio size={21} aria-hidden="true"/>:n.mime_type==='application/pdf'?<FileText size={21} aria-hidden="true"/>:<File size={21} aria-hidden="true"/>}</span>
     <span className="vl-file-copy"><strong>{n.name}</strong><small>{n.kind==='folder'?'Pasta':n.provider==='google_drive'?'Google Drive':n.provider==='dropbox'?'Dropbox':'Arquivo'}{n.source_state&&n.source_state!=='available'?' · '+({unavailable:'Original indisponível',restricted:'Acesso restrito',source_trashed:'Original na lixeira'}[n.source_state]||'Verifique o original'):''}</small></span>
    </AppButton>
    <div className="vl-file-actions">{trash?
     <AppButton className="vl-icon-action" disabled={busy} title={'Restaurar '+n.name} aria-label={'Restaurar '+n.name} onClick={()=>setEdit({action:'restore',node:n})}><RotateCcw size={18} aria-hidden="true"/></AppButton>:
     <>
      <AppButton className="vl-icon-action" disabled={busy} title={'Renomear '+n.name} aria-label={'Renomear '+n.name} onClick={()=>{setName(n.name);setEdit({action:'rename',node:n});}}><Pencil size={17} aria-hidden="true"/></AppButton>
      <AppButton className="vl-icon-action" disabled={busy} title={'Mover '+n.name} aria-label={'Mover '+n.name} onClick={()=>{setMoveParent('root');setEdit({action:'move',node:n});}}><MoveRight size={18} aria-hidden="true"/></AppButton>
      <AppButton className="vl-icon-action vl-danger" disabled={busy} title={'Remover '+n.name+' do Roteiva'} aria-label={'Remover '+n.name+' do Roteiva'} onClick={()=>setEdit({action:'trash',node:n})}><Trash2 size={17} aria-hidden="true"/></AppButton>
     </>}</div>
   </li>)}</ul>
   {page&&!page.nodes.length&&<div className="vl-empty-folder"><span className="vl-empty-icon"><FolderOpen size={28} aria-hidden="true"/></span><h4>{term?'Nenhum resultado nesta pasta':trash?'A lixeira está vazia':'Esta pasta ainda está vazia'}</h4><p>{term?'Tente outro nome.':trash?'Itens removidos aparecerão aqui.':'Crie uma pasta ou adicione arquivos para começar.'}</p></div>}
   {page?.nextPage&&<div className="vl-more"><AppButton className="vl-action" disabled={busy} onClick={()=>void load(page.nextPage!)}>Carregar mais</AppButton></div>}
   </>}
  {!trash&&<section className="vl-import-section" aria-label="Adicionar materiais">
   <div className="vl-section-heading"><span className="vl-section-icon"><CloudUpload size={19} aria-hidden="true"/></span><div><h3>Adicionar materiais</h3><p>Envie novos arquivos ou importe itens existentes.</p></div></div>
   <div className="vl-providers">
    <div className="vl-provider-card">
     <div className="vl-provider-head"><img src={googleDriveMark} alt="" aria-hidden="true"/><div><h4>Google Drive</h4><p>{accounts.length?accounts.length+' conta(s) conectada(s)':'Conecte uma conta para adicionar arquivos'}</p></div></div>
     {accounts.length>0&&<AppSelect aria-label="Conta Google Drive" value={account?.id||''} onValueChange={setAccountId} disabled={busy}><option value="">Selecione uma conta</option>{accounts.map(x=><option key={x.id} value={x.id}>{x.email}</option>)}</AppSelect>}
     <div className="vl-provider-actions">
      <AppButton className="vl-action vl-action-primary" disabled={busy||!account} onClick={()=>{uploadProvider.current='google_drive';fileInput.current?.click();}}><IconLabel icon={CloudUpload}>Enviar ao Drive</IconLabel></AppButton>
      <AppButton className="vl-action" disabled={busy||!picker||picker.connectionId!==account?.id} onClick={()=>void addDrive()}><IconLabel icon={FilePlus2}>Adicionar do Drive</IconLabel></AppButton>
      <AppButton className="vl-action" disabled={busy||!picker||picker.connectionId!==account?.id} onClick={()=>void addDrive(true)}><IconLabel icon={FolderInput}>Trazer organização do Drive</IconLabel></AppButton>
     </div>
    </div>
    <div className="vl-provider-card">
     <div className="vl-provider-head"><img src={dropboxMark} alt="" aria-hidden="true"/><div><h4>Dropbox</h4><p>{dropboxAccounts.length?dropboxAccounts.length+' conta(s) conectada(s)':'Conecte uma conta para adicionar arquivos'}</p></div></div>
     {dropboxAccounts.length>0&&<AppSelect aria-label="Conta Dropbox" value={dropbox?.id||''} onValueChange={setDropboxId} disabled={busy}><option value="">Selecione uma conta</option>{dropboxAccounts.map(x=><option key={x.id} value={x.id}>{x.email}</option>)}</AppSelect>}
     <div className="vl-provider-actions">
      <AppButton className="vl-action vl-action-primary" disabled={busy||!dropbox} onClick={()=>{uploadProvider.current='dropbox';fileInput.current?.click();}}><IconLabel icon={CloudUpload}>Enviar ao Dropbox</IconLabel></AppButton>
      <AppButton className="vl-action" disabled={busy||!dropbox} onClick={()=>{setDropboxStructure(false);setDropboxPicker(true);}}><IconLabel icon={FilePlus2}>Adicionar do Dropbox</IconLabel></AppButton>
      <AppButton className="vl-action" disabled={busy||!dropbox} onClick={()=>{setDropboxStructure(true);setDropboxPicker(true);}}><IconLabel icon={FolderInput}>Trazer organização do Dropbox</IconLabel></AppButton>
     </div>
    </div>
   </div>
   <AppInput ref={fileInput} type="file" multiple hidden onChange={e=>{const files=Array.from(e.target.files||[]);e.target.value='';void upload(files);}}/>
   <p className="vl-import-hint">Os originais continuam no provedor escolhido. Organizar a Biblioteca não altera suas pastas físicas.</p>
   {progress&&<p role="status" className="vl-progress">{progress}</p>}
  </section>}
 </div>}
 {edit&&<div className="virtual-library-backdrop"><div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="virtual-library-title" className="virtual-library-editor">
 <h3 id="virtual-library-title">{{create:'Nova pasta',rename:'Renomear',move:'Mover para',restore:'Restaurar',trash:'Remover do Roteiva'}[edit.action]}</h3>
 {error&&<div role="alert" className="virtual-library-error">{error}</div>}
 <form onSubmit={e=>{e.preventDefault();void save();}}>{edit.action==='trash'?<p>Os arquivos originais permanecem no provedor. A organização desta pasta será removida da Biblioteca.</p>:edit.action==='restore'?<p>Restaurar esta referência na pasta anterior. Se ela também estiver na lixeira, restaure a pasta primeiro.</p>:edit.action==='move'?<><nav aria-label="Pasta de destino">{movePage?.trail.map(x=><AppButton type="button" key={x.id} onClick={()=>setMoveParent(x.id)}>{x.name}</AppButton>)}</nav>{movePage?.nodes.filter(x=>x.kind==='folder'&&x.id!==edit.node?.id).map(x=><AppButton type="button" key={x.id} onClick={()=>setMoveParent(x.id)}>{x.name}</AppButton>)}{movePage?.nextPage&&<AppButton type="button" disabled={moveBusy} onClick={()=>{const old=movePage,scope=moveGeneration.current;setMoveBusy(true);void call<Page>(base+'?parent='+encodeURIComponent(moveParent)+'&after='+old.nextPage).then(p=>{if(scope===moveGeneration.current)setMovePage({...p,nodes:[...old.nodes,...p.nodes]});}).catch(()=>{if(scope===moveGeneration.current)setError('Não foi possível carregar mais pastas.');}).finally(()=>{if(scope===moveGeneration.current)setMoveBusy(false);});}}>Mais pastas</AppButton>}</>:<label>Nome<AppInput autoFocus value={name} maxLength={120} onChange={e=>setName(e.target.value)} required/></label>}
 <div className="virtual-library-toolbar"><AppButton type="submit" disabled={busy||edit.action==='move'&&!movePage}>Confirmar</AppButton><AppButton type="button" disabled={busy} onClick={()=>setEdit(null)}>Cancelar</AppButton></div></form>
 </div></div>}
 {dropboxPicker&&dropbox&&<DropboxLibraryPicker key={dropbox.id+':'+dropboxStructure} connectionId={dropbox.id} includeFolders={dropboxStructure} onClose={()=>setDropboxPicker(false)} onSelect={(ids,names)=>void addDropbox(ids,names)}/>}
 {preview&&selectedProjectId&&<LibraryAssetPreview key={preview.id} projectId={selectedProjectId} node={preview} onClose={()=>{setPreview(null);void load();}}/>}
 {structure&&selectedProjectId&&<LibraryStructureDialog key={selectedProjectId+':'+parent} projectId={selectedProjectId} parentId={parent} onClose={()=>setStructure(false)} onApplied={()=>{setStructure(false);void load();}}/>}
 {assisted&&selectedProjectId&&<AssistedLibraryImport key={selectedProjectId+':'+assisted.parentId} projectId={selectedProjectId} parentId={assisted.parentId} sources={assisted.sources} unavailable={assisted.failed} onClose={()=>{setAssisted(null);void load();}} onApplied={()=>{setAssisted(null);setSearch('');setTerm('');void load();}}/>}
 </section>;
}
