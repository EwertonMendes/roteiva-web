import {AppButton} from "../ui/AppButton";
import {useEffect,useRef,useState} from 'react';
import {ChevronRight,ExternalLink,FolderOpen,Link2,Pencil,Search,RefreshCw} from 'lucide-react';
import {useAuth} from '../auth/AuthProvider';
import {readDriveLinks,type DriveFolderLink} from '../../data/drive-folder-links';
import {readDropboxLinks,type DropboxFolderLink} from '../../data/dropbox-folder-links';
import {useDriveApi} from '../drive/drive-api';
import {LibraryAssetPreview} from '../drive/LibraryAssetPreview';
import {LibraryNodeGallery,LibraryLayoutControl,useLibraryLayout} from '../drive/LibraryNodeGallery';
import {AppInput} from '../ui/AppInput';
import '../drive/virtual-library.css';
import './project-materials.css';
type StorageLink=(DriveFolderLink&{provider:'google_drive'})|DropboxFolderLink;
/** Read existing folder associations; management and uploads live in the Library. */
export function ProjectMaterials({projectId,onManage}:{projectId:number;onManage:()=>void}){
 return import.meta.env.VITE_VIRTUAL_LIBRARY==='true'?<VirtualProjectMaterials projectId={projectId} onManage={onManage}/>:<LegacyProjectMaterials projectId={projectId} onManage={onManage}/>;
}
function LegacyProjectMaterials({projectId,onManage}:{projectId:number;onManage:()=>void}){
 const {user}=useAuth();
 const [state,setState]=useState<{links:StorageLink[];loading:boolean;error:boolean}>({links:[],loading:true,error:false});
 const [attempt,setAttempt]=useState(0);
 useEffect(()=>{
  let active=true;setState({links:[],loading:true,error:false});if(!user)return;
  Promise.allSettled([readDriveLinks(user.uid,projectId),readDropboxLinks(user.uid,projectId)])
    .then(([drive,dropbox])=>{
      if(!active)return;
      if(drive.status==='rejected'&&dropbox.status==='rejected'){setState({links:[],loading:false,error:true});return}
      const google=drive.status==='fulfilled'?drive.value.map(x=>({...x,provider:'google_drive' as const})):[];
      const other=dropbox.status==='fulfilled'?dropbox.value:[];
      setState({links:[...google,...other],loading:false,error:false});
    }).catch(()=>{if(active)setState({links:[],loading:false,error:true})});
  return()=>{active=false};
 },[user?.uid,projectId,attempt]);
 if(state.loading)return <p role="status">Carregando materiais vinculados…</p>;
 if(state.error)return <div className="pd-material-empty" role="alert"><p>Não foi possível carregar os materiais.</p><AppButton className="secondary-button" onClick={()=>setAttempt(value=>value+1)}>Tentar novamente</AppButton></div>;
 return <>{state.links.map(link=><article className="pd-material" key={link.provider+':'+link.id}>
   <span className="pd-material-icon" aria-hidden="true"><Link2 size={25}/></span><div className="pd-folder-copy">
    <b>{link.folderName}</b><p>Pasta vinculada ao projeto · {link.provider==='dropbox'?'Dropbox':'Google Drive'}</p>
    <a href={link.provider==='dropbox'?'https://www.dropbox.com/home':
     'https://drive.google.com/drive/folders/'+encodeURIComponent(link.folderId)}
     target="_blank" rel="noreferrer">Abrir {link.provider==='dropbox'?'Dropbox':'link'}<ExternalLink size={15} aria-hidden="true"/></a>
   </div><AppButton className="secondary-button" onClick={onManage} aria-label={'Gerenciar material '+link.folderName}>
     <Pencil size={16} aria-hidden="true"/>Gerenciar</AppButton>
  </article>)}{!state.links.length&&<div className="pd-material-empty">
   <FolderOpen size={23} aria-hidden="true"/>
   <p>Vincule pastas do Google Drive ou Dropbox na Biblioteca deste projeto.</p>
   <AppButton className="secondary-button" onClick={onManage}>Abrir Biblioteca<ExternalLink size={16} aria-hidden="true"/></AppButton>
  </div>}</>;
}
type Node={id:string;kind:'folder'|'asset';name:string;revision:number;mime_type?:string;provider?:string;connection_id?:string;file_id?:string;source_revision?:string;parent_name?:string};
type Page={nodes:Node[];trail:{id:string;name:string}[];nextPage:string|null};

/** Embedded explorer uses the same cards and private thumbnails as the Library,
 * but navigates only the current project's authorized virtual registry. */
function VirtualProjectMaterials({projectId,onManage}:{projectId:number;onManage:()=>void}){
 const {user}=useAuth(),call=useDriveApi();
 const [layout,setLayout]=useLibraryLayout();
 const [folder,setFolder]=useState('root'),[query,setQuery]=useState(''),[term,setTerm]=useState('');
 const [page,setPage]=useState<Page|null>(null);
 const [busy,setBusy]=useState(true),[moreBusy,setMoreBusy]=useState(false);
 const [error,setError]=useState(''),[attempt,setAttempt]=useState(0);
 const [preview,setPreview]=useState<Node|null>(null);
 const scope=useRef('');
 useEffect(()=>{setFolder('root');setQuery('');setTerm('');setPreview(null);},[projectId]);
 useEffect(()=>{const timer=setTimeout(()=>setTerm(query.trim().length>=2?query.trim():''),280);return()=>clearTimeout(timer);},[query]);
 useEffect(()=>{
  const controller=new AbortController();
  const key=projectId+':'+folder+':'+term;
  scope.current=key;
  setPage(null);setBusy(true);setMoreBusy(false);setError('');
  const params=new URLSearchParams({explorer:'1',parent:folder,...(term?{q:term,scope:'project'}:{})});
  void call<Page>('/library/projects/'+projectId+'/nodes?'+params.toString(),'GET',undefined,controller.signal)
   .then(result=>{if(!controller.signal.aborted&&scope.current===key)setPage(result);})
   .catch(e=>{if(!controller.signal.aborted&&scope.current===key)setError(e instanceof Error?e.message:'Não foi possível carregar os materiais.');})
   .finally(()=>{if(!controller.signal.aborted&&scope.current===key)setBusy(false);});
  return()=>controller.abort();
 },[projectId,folder,term,call,attempt]);
 async function loadMore(){
  const cursor=page?.nextPage;if(!cursor||busy||moreBusy)return;
  const key=scope.current;
  setMoreBusy(true);setError('');
  try{
   const params=new URLSearchParams({explorer:'1',parent:folder,after:cursor,...(term?{q:term,scope:'project'}:{})});
   const result=await call<Page>('/library/projects/'+projectId+'/nodes?'+params.toString());
   if(scope.current===key)setPage(previous=>previous?{...result,nodes:[...previous.nodes,...result.nodes]}:result);
  }catch(e){if(scope.current===key)setError(e instanceof Error?e.message:'Não foi possível carregar mais arquivos.');}
  finally{if(scope.current===key)setMoreBusy(false);}
 }
 function openNode(node:Node){
  if(node.kind==='asset')setPreview(node);
  else{setFolder(node.id);setQuery('');setTerm('');}
 }
 return <div className="virtual-library vl-explorer pd-linked-library" aria-label="Arquivos vinculados ao projeto">
  <div className="pd-linked-toolbar">
   <nav className="vl-explorer-breadcrumb" aria-label="Caminho dos materiais">
    {(page?.trail||[{id:'root',name:'Arquivos'}]).map((crumb,index)=><span className="vl-path-part" key={crumb.id}>
     {index>0&&<ChevronRight size={15}/>}
     <AppButton type="button" disabled={busy} aria-current={crumb.id===folder?'location':undefined}
      onClick={()=>{setFolder(crumb.id);setQuery('');setTerm('');}}>{crumb.name}</AppButton>
    </span>)}
   </nav>
   <div className="pd-linked-actions">
    <AppButton type="button" className="vl-small-tool" onClick={()=>setAttempt(n=>n+1)}
     disabled={busy} aria-label="Atualizar arquivos" title="Atualizar arquivos"><RefreshCw size={17}/></AppButton>
    <LibraryLayoutControl layout={layout} onChange={setLayout}/>
    <AppButton type="button" className="vl-small-tool" onClick={onManage}>Gerenciar na Biblioteca<ExternalLink size={15}/></AppButton>
   </div>
  </div>
  <div className="vl-query">
   <label className="vl-query-input"><Search size={18}/>
    <AppInput aria-label="Buscar arquivos e pastas do projeto" placeholder="Buscar arquivos e pastas…" maxLength={100}
     value={query} onChange={event=>setQuery(event.target.value)}/>
   </label>
  </div>
  <div className="vl-file-area">
   {busy?<div className="pd-linked-state" role="status">Carregando materiais…</div>:
    error&&!page?<div className="pd-linked-state" role="alert"><p>{error}</p>
     <AppButton className="secondary-button" onClick={()=>setAttempt(n=>n+1)}>Tentar novamente</AppButton></div>:
    page?.nodes.length?<LibraryNodeGallery nodes={page.nodes} layout={layout} uid={user?.uid||''}
     countLabel={page.nodes.length+(page.nextPage?'+':'')+' '+(page.nodes.length===1?'item':'itens')}
     searchAll={Boolean(term)} onOpen={openNode}/>:
    <div className="vl-explorer-empty vl-explorer-empty--folder"><FolderOpen size={31}/>
     <h3>{term?'Nenhum resultado':'Nenhum arquivo vinculado'}</h3>
     <p>{term?'Experimente outro termo.':'Adicione arquivos e pastas pela Biblioteca do projeto.'}</p>
    </div>}
   {page?.nextPage&&<div className="vl-loadmore"><AppButton className="secondary-button" disabled={moreBusy}
    onClick={()=>void loadMore()}>{moreBusy?'Carregando…':'Carregar mais'}</AppButton></div>}
   {error&&page&&<p className="pd-linked-load-error" role="alert">{error}</p>}
  </div>
  {preview&&<LibraryAssetPreview key={preview.id} projectId={projectId} node={preview} onClose={()=>setPreview(null)}/>}
 </div>;
}
