import {useCallback,useEffect,useRef,useState} from 'react';
import {FolderOpen,Plus,RefreshCw} from 'lucide-react';
import type {Project} from '../../domain/workspace';
import {useAuth} from '../auth/AuthProvider';
import {useDriveApi} from './drive-api';
import {AppButton} from '../ui/AppButton';
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
type Node={id:string;parent_id:string|null;kind:'folder'|'asset';name:string;revision:number;provider?:string;source_state?:string;mime_type?:string};
type Page={nodes:Node[];trail:{id:string;name:string}[];nextPage:string|null};
export function VirtualLibrary({projects,selectedProjectId,onSelectProject}:{projects:readonly Project[];selectedProjectId?:number;onSelectProject:(id:string)=>void}){
 const {user}=useAuth(),call=useDriveApi();
 const storage=useStorageConnections();
 const [accountId,setAccountId]=useState(''),[picker,setPicker]=useState<{connectionId:string;config:PickerConfig}|null>(null),[progress,setProgress]=useState('');
 const accounts=storage.connections.filter(x=>x.provider==='google_drive'&&x.status==='connected');
 const account=accounts.find(x=>x.id===accountId)||accounts[0];
 const dropboxAccounts=storage.connections.filter(x=>x.provider==='dropbox'&&x.status==='connected');
 const [dropboxId,setDropboxId]=useState(''),[dropboxPicker,setDropboxPicker]=useState(false);
 const dropbox=dropboxAccounts.find(x=>x.id===dropboxId)||dropboxAccounts[0];
 const [parent,setParent]=useState('root'),[page,setPage]=useState<Page|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [edit,setEdit]=useState<{node?:Node;action:'create'|'rename'|'trash'|'restore'|'move'}|null>(null),[name,setName]=useState('');
 const [trash,setTrash]=useState(false),[moveParent,setMoveParent]=useState('root'),[movePage,setMovePage]=useState<Page|null>(null);
 const [preview,setPreview]=useState<Node|null>(null);
 const generation=useRef(0),mutation=useRef<AbortController|null>(null);
 const dialogRef=useOverlayFocus(()=>{if(!busy)setEdit(null);},Boolean(edit),edit?.action+':'+edit?.node?.id);
 const base=selectedProjectId?'/library/projects/'+selectedProjectId+'/nodes':'';
 useEffect(()=>{
  const params=new URLSearchParams(window.location.search),result=params.get('drive')||params.get('dropbox');
  if(result&&result!=='connected'&&result!=='cancelled')setError(messages[result]||'Não foi possível conectar a conta. Tente novamente.');
 },[]);
 async function connect(provider:'drive'|'dropbox'){
  if(busy)return;setBusy(true);setError('');
  try{const result=await call<{launchUrl:string}>('/oauth/'+provider+'/start','POST');const target=new URL(result.launchUrl);
   if(target.origin!==API_BASE_URL||target.pathname!=='/oauth/'+provider+'/launch')throw new Error('O endereço de conexão recebido não é válido.');
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
 try{const value=await call<Page>(base+'?parent='+encodeURIComponent(parent)+(trash?'&trash=1':'')+(after?'&after='+encodeURIComponent(after):''));
 if(revision===generation.current)setPage(old=>after&&old?{...value,nodes:[...old.nodes,...value.nodes]}:value);
 }catch(e){if(revision===generation.current)setError(e instanceof Error?e.message:'Não foi possível carregar a pasta.');}
 finally{if(revision===generation.current)setBusy(false);}
 },[base,user,call,parent,trash]);
 useEffect(()=>{
 setMovePage(null);if(edit?.action!=='move'||!base)return;const controller=new AbortController();
 void call<Page>(base+'?parent='+encodeURIComponent(moveParent),'GET',undefined,controller.signal).then(p=>{if(!controller.signal.aborted)setMovePage(p);}).catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Não foi possível carregar o destino.');});
 return()=>controller.abort();
 },[edit?.action,base,moveParent,call]);
 useEffect(()=>{setParent('root');setPage(null);setEdit(null);setPreview(null);setDropboxPicker(false);mutation.current?.abort();++generation.current;},[selectedProjectId,user?.uid]);
 useEffect(()=>{setPage(null);void load();return()=>{++generation.current;};},[load]);
 useEffect(()=>()=>mutation.current?.abort(),[]);
 async function addDropbox(ids:string[]){
 if(!dropbox||busy)return;setDropboxPicker(false);const controller=new AbortController();mutation.current=controller;
 const scope=generation.current,target=parent;setBusy(true);setError('');let failed=0;
 try{for(let i=0;i<ids.length;i+=10){
 if(controller.signal.aborted)break;setProgress('Adicionando '+Math.min(i+10,ids.length)+' de '+ids.length+' arquivos…');
 const reply=await call<{results:{status:string}[]}>(base.replace('/nodes','/imports'),'POST',{parentId:target,items:ids.slice(i,i+10).map(fileId=>({provider:'dropbox',connectionId:dropbox.id,fileId}))},controller.signal);
 failed+=reply.results.filter(x=>x.status==='failed').length;
 }if(scope===generation.current){await load();if(failed)setError(failed+' arquivo(s) não puderam ser adicionados. Os demais foram preservados.');}
 }catch(e){if(!controller.signal.aborted&&scope===generation.current)setError(e instanceof Error?e.message:'Não foi possível adicionar os arquivos.');}
 finally{setProgress('');if(scope===generation.current)setBusy(false);}
 }
 async function addDrive(){
 if(!picker||!account||picker.connectionId!==account.id||busy)return;
 const controller=new AbortController();mutation.current=controller;const scope=generation.current,target=parent;setBusy(true);setError('');
 try{
 const ids=await pickLibraryFiles(picker.config,accessToken=>call('/integrations/drive/'+account.id+'/picker/verify','POST',{accessToken},controller.signal),controller.signal);
 let failed=0;
 for(let i=0;i<ids.length;i+=10){
 if(controller.signal.aborted)break;setProgress('Adicionando '+Math.min(i+10,ids.length)+' de '+ids.length+' arquivos…');
 const reply=await call<{results:{status:string}[]}>(base.replace('/nodes','/imports'),'POST',{parentId:target,items:ids.slice(i,i+10).map(fileId=>({provider:'google_drive',connectionId:account.id,fileId}))},controller.signal);
 failed+=reply.results.filter(x=>x.status==='failed').length;
 }
 if(scope===generation.current){await load();if(failed)setError(failed+' arquivo(s) não puderam ser adicionados. Os demais foram preservados.');}
 }catch(e){if(!controller.signal.aborted&&scope===generation.current)setError(e instanceof Error?e.message:'Não foi possível adicionar os arquivos.');}
 finally{setProgress('');if(scope===generation.current)setBusy(false);}
 }
 async function save(){
 if(!edit||!base||busy)return;const operation=edit,scope=generation.current,controller=new AbortController();mutation.current=controller;setBusy(true);setError('');
 try{await call(base+(operation.node?'/'+operation.node.id:''),'POST',operation.node?
 {action:operation.action,name,parentId:moveParent,revision:operation.node.revision}:{name,parentId:parent},controller.signal);
 if(scope===generation.current){setEdit(null);await load();}
 }catch(e){if(!controller.signal.aborted&&scope===generation.current)setError(e instanceof Error?e.message:'Não foi possível salvar.');}
 finally{if(scope===generation.current)setBusy(false);}
 }
 return <section className="panel virtual-library" aria-label="Arquivos do projeto">
 <div className="virtual-library-toolbar"><AppSelect aria-label="Projeto dos arquivos" value={selectedProjectId?String(selectedProjectId):''} onValueChange={onSelectProject}>
 <option value="">Selecione um projeto</option>{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</AppSelect>
 <AppButton disabled={!base||busy||trash} onClick={()=>{setName('');setEdit({action:'create'});}}><Plus size={16}/>Nova pasta</AppButton>
 <AppButton disabled={!base||busy} onClick={()=>{setTrash(x=>!x);setParent('root');}}>{trash?'Voltar aos arquivos':'Lixeira'}</AppButton>
 <AppButton disabled={!base||busy} aria-label="Atualizar pasta" onClick={()=>void load()}><RefreshCw size={16}/></AppButton></div>
 <div className="virtual-library-toolbar"><AppButton disabled={busy} onClick={()=>void connect('drive')}>Conectar Google Drive</AppButton><AppButton disabled={busy} onClick={()=>void connect('dropbox')}>Conectar Dropbox</AppButton></div>
 {storage.error&&<p role="alert">Não foi possível consultar {storage.error}. <AppButton disabled={storage.loading} onClick={()=>void storage.refresh(true)}>Atualizar conexões</AppButton></p>}
 {base&&!trash&&<div className="virtual-library-toolbar"><AppSelect aria-label="Conta Google Drive" value={account?.id||''} onValueChange={setAccountId} disabled={busy}><option value="">Selecione uma conta</option>{accounts.map(x=><option key={x.id} value={x.id}>{x.email}</option>)}</AppSelect><AppButton disabled={busy||!picker||picker.connectionId!==account?.id} onClick={()=>void addDrive()}>Adicionar do Drive</AppButton></div>}
 {progress&&<p role="status">{progress}</p>}
 {base&&!trash&&dropbox&&<div className="virtual-library-toolbar"><AppSelect aria-label="Conta Dropbox" value={dropbox.id} onValueChange={setDropboxId} disabled={busy}><option value="">Selecione uma conta</option>{dropboxAccounts.map(x=><option key={x.id} value={x.id}>{x.email}</option>)}</AppSelect><AppButton disabled={busy} onClick={()=>setDropboxPicker(true)}>Adicionar do Dropbox</AppButton></div>}
 {error&&<div role="alert" className="virtual-library-error">{error}</div>}
 {base&&<nav aria-label="Caminho da pasta" className="virtual-library-path">{page?.trail.map(x=><AppButton key={x.id} disabled={busy} onClick={()=>setParent(x.id)}>{x.name}</AppButton>)}</nav>}
 {!base?<p>Selecione o projeto para organizar os arquivos.</p>:busy&&!page?<p role="status">Carregando pasta…</p>:<>
 <ul className="virtual-library-nodes">{page?.nodes.map(n=><li key={n.id}><AppButton disabled={busy||trash} onClick={()=>n.kind==='folder'?setParent(n.id):setPreview(n)}><FolderOpen size={20}/>{n.name}</AppButton>
 <span>{n.provider==='google_drive'?'Google Drive':n.provider==='dropbox'?'Dropbox':''}</span>
 {trash?<AppButton disabled={busy} onClick={()=>setEdit({action:'restore',node:n})}>Restaurar</AppButton>:<><AppButton disabled={busy} aria-label={'Renomear '+n.name} onClick={()=>{setName(n.name);setEdit({action:'rename',node:n});}}>Renomear</AppButton>
 <AppButton disabled={busy} onClick={()=>{setMoveParent('root');setEdit({action:'move',node:n});}}>Mover</AppButton>
 <AppButton disabled={busy} aria-label={'Remover '+n.name+' do Roteiva'} onClick={()=>setEdit({action:'trash',node:n})}>Remover</AppButton></>}</li>)}</ul>
 {page&&!page.nodes.length&&<p>Esta pasta ainda está vazia.</p>}
 {page?.nextPage&&<AppButton disabled={busy} onClick={()=>void load(page.nextPage!)}>Carregar mais</AppButton>}
 </>}
 {edit&&<div className="virtual-library-backdrop"><div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="virtual-library-title" className="virtual-library-editor">
 <h3 id="virtual-library-title">{{create:'Nova pasta',rename:'Renomear',move:'Mover para',restore:'Restaurar',trash:'Remover do Roteiva'}[edit.action]}</h3>
 {error&&<div role="alert" className="virtual-library-error">{error}</div>}
 <form onSubmit={e=>{e.preventDefault();void save();}}>{edit.action==='trash'?<p>Os arquivos originais permanecem no provedor. A organização desta pasta será removida da Biblioteca.</p>:edit.action==='restore'?<p>Restaurar esta referência na pasta anterior. Se ela também estiver na lixeira, restaure a pasta primeiro.</p>:edit.action==='move'?<><nav aria-label="Pasta de destino">{movePage?.trail.map(x=><AppButton type="button" key={x.id} onClick={()=>setMoveParent(x.id)}>{x.name}</AppButton>)}</nav>{movePage?.nodes.filter(x=>x.kind==='folder'&&x.id!==edit.node?.id).map(x=><AppButton type="button" key={x.id} onClick={()=>setMoveParent(x.id)}>{x.name}</AppButton>)}{movePage?.nextPage&&<AppButton type="button" onClick={()=>{const old=movePage;void call<Page>(base+'?parent='+encodeURIComponent(moveParent)+'&after='+old.nextPage).then(p=>setMovePage({...p,nodes:[...old.nodes,...p.nodes]})).catch(()=>setError('Não foi possível carregar mais pastas.'));}}>Mais pastas</AppButton>}</>:<label>Nome<AppInput autoFocus value={name} maxLength={120} onChange={e=>setName(e.target.value)} required/></label>}
 <div className="virtual-library-toolbar"><AppButton type="submit" disabled={busy||edit.action==='move'&&!movePage}>Confirmar</AppButton><AppButton type="button" disabled={busy} onClick={()=>setEdit(null)}>Cancelar</AppButton></div></form>
 </div></div>}
 {dropboxPicker&&dropbox&&<DropboxLibraryPicker key={dropbox.id} connectionId={dropbox.id} onClose={()=>setDropboxPicker(false)} onSelect={ids=>void addDropbox(ids)}/>}
 {preview&&selectedProjectId&&<LibraryAssetPreview key={preview.id} projectId={selectedProjectId} node={preview} onClose={()=>setPreview(null)}/>}
 </section>;
}
