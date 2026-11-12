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
type Node={id:string;parent_id:string|null;kind:'folder'|'asset';name:string;revision:number;provider?:string;source_state?:string};
type Page={nodes:Node[];trail:{id:string;name:string}[];nextPage:string|null};
export function VirtualLibrary({projects,selectedProjectId,onSelectProject}:{projects:readonly Project[];selectedProjectId?:number;onSelectProject:(id:string)=>void}){
 const {user}=useAuth(),call=useDriveApi();
 const storage=useStorageConnections();
 const [accountId,setAccountId]=useState(''),[picker,setPicker]=useState<{connectionId:string;config:PickerConfig}|null>(null),[progress,setProgress]=useState('');
 const accounts=storage.connections.filter(x=>x.provider==='google_drive'&&x.status==='connected');
 const account=accounts.find(x=>x.id===accountId)||accounts[0];
 const [parent,setParent]=useState('root'),[page,setPage]=useState<Page|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [edit,setEdit]=useState<{node?:Node;action:'create'|'rename'|'trash'}|null>(null),[name,setName]=useState('');
 const generation=useRef(0),mutation=useRef<AbortController|null>(null);
 const dialogRef=useOverlayFocus(()=>{if(!busy)setEdit(null);},Boolean(edit),edit?.action+':'+edit?.node?.id);
 const base=selectedProjectId?'/library/projects/'+selectedProjectId+'/nodes':'';
 useEffect(()=>{
 setPicker(null);if(!base||!account)return;const controller=new AbortController();
 void Promise.all([preparePicker(),call<PickerConfig>(base.replace('/nodes','/picker/')+account.id,'GET',undefined,controller.signal)])
 .then(([,config])=>{if(!controller.signal.aborted)setPicker({connectionId:account.id,config});})
 .catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Não foi possível preparar o Drive.');});
 return()=>controller.abort();
 },[base,account?.id,call]);
 const load=useCallback(async(after?:string)=>{
 if(!base||!user)return;const revision=++generation.current;setBusy(true);setError('');
 try{const value=await call<Page>(base+'?parent='+encodeURIComponent(parent)+(after?'&after='+encodeURIComponent(after):''));
 if(revision===generation.current)setPage(old=>after&&old?{...value,nodes:[...old.nodes,...value.nodes]}:value);
 }catch(e){if(revision===generation.current)setError(e instanceof Error?e.message:'Não foi possível carregar a pasta.');}
 finally{if(revision===generation.current)setBusy(false);}
 },[base,user,call,parent]);
 useEffect(()=>{setParent('root');setPage(null);setEdit(null);mutation.current?.abort();++generation.current;},[selectedProjectId,user?.uid]);
 useEffect(()=>{setPage(null);void load();return()=>{++generation.current;};},[load]);
 useEffect(()=>()=>mutation.current?.abort(),[]);
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
 {action:operation.action,name,revision:operation.node.revision}:{name,parentId:parent},controller.signal);
 if(scope===generation.current){setEdit(null);await load();}
 }catch(e){if(!controller.signal.aborted&&scope===generation.current)setError(e instanceof Error?e.message:'Não foi possível salvar.');}
 finally{if(scope===generation.current)setBusy(false);}
 }
 return <section className="panel virtual-library" aria-label="Arquivos do projeto">
 <div className="virtual-library-toolbar"><AppSelect aria-label="Projeto dos arquivos" value={selectedProjectId?String(selectedProjectId):''} onValueChange={onSelectProject}>
 <option value="">Selecione um projeto</option>{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</AppSelect>
 <AppButton disabled={!base||busy} onClick={()=>{setName('');setEdit({action:'create'});}}><Plus size={16}/>Nova pasta</AppButton>
 <AppButton disabled={!base||busy} aria-label="Atualizar pasta" onClick={()=>void load()}><RefreshCw size={16}/></AppButton></div>
 {base&&<div className="virtual-library-toolbar"><AppSelect aria-label="Conta Google Drive" value={account?.id||''} onValueChange={setAccountId} disabled={busy}><option value="">Selecione uma conta</option>{accounts.map(x=><option key={x.id} value={x.id}>{x.email}</option>)}</AppSelect><AppButton disabled={busy||!picker||picker.connectionId!==account?.id} onClick={()=>void addDrive()}>Adicionar do Drive</AppButton></div>}
 {progress&&<p role="status">{progress}</p>}
 {error&&<div role="alert" className="virtual-library-error">{error}</div>}
 {base&&<nav aria-label="Caminho da pasta" className="virtual-library-path">{page?.trail.map(x=><AppButton key={x.id} disabled={busy} onClick={()=>setParent(x.id)}>{x.name}</AppButton>)}</nav>}
 {!base?<p>Selecione o projeto para organizar os arquivos.</p>:busy&&!page?<p role="status">Carregando pasta…</p>:<>
 <ul className="virtual-library-nodes">{page?.nodes.map(n=><li key={n.id}><AppButton disabled={busy||n.kind!=='folder'} onClick={()=>setParent(n.id)}><FolderOpen size={20}/>{n.name}</AppButton>
 <span>{n.provider==='google_drive'?'Google Drive':n.provider==='dropbox'?'Dropbox':''}</span>
 <AppButton disabled={busy} aria-label={'Renomear '+n.name} onClick={()=>{setName(n.name);setEdit({action:'rename',node:n});}}>Renomear</AppButton>
 <AppButton disabled={busy} aria-label={'Remover '+n.name+' do Roteiva'} onClick={()=>setEdit({action:'trash',node:n})}>Remover</AppButton></li>)}</ul>
 {page&&!page.nodes.length&&<p>Esta pasta ainda está vazia.</p>}
 {page?.nextPage&&<AppButton disabled={busy} onClick={()=>void load(page.nextPage!)}>Carregar mais</AppButton>}
 </>}
 {edit&&<div className="virtual-library-backdrop"><div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="virtual-library-title" className="virtual-library-editor">
 <h3 id="virtual-library-title">{edit.action==='create'?'Nova pasta':edit.action==='rename'?'Renomear':'Remover do Roteiva'}</h3>
 <form onSubmit={e=>{e.preventDefault();void save();}}>{edit.action==='trash'?<p>Os arquivos originais permanecem no provedor. A organização desta pasta será removida da Biblioteca.</p>:<label>Nome<AppInput autoFocus value={name} maxLength={120} onChange={e=>setName(e.target.value)} required/></label>}
 <div className="virtual-library-toolbar"><AppButton type="submit" disabled={busy}>Confirmar</AppButton><AppButton type="button" disabled={busy} onClick={()=>setEdit(null)}>Cancelar</AppButton></div></form>
 </div></div>}
 </section>;
}
