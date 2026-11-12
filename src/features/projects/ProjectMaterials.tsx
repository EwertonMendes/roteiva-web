import {AppButton} from "../ui/AppButton";
import {useEffect,useState} from 'react';
import {ExternalLink,FolderOpen,Link2,Pencil} from 'lucide-react';
import {useAuth} from '../auth/AuthProvider';
import {readDriveLinks,type DriveFolderLink} from '../../data/drive-folder-links';
import {readDropboxLinks,type DropboxFolderLink} from '../../data/dropbox-folder-links';
import {useDriveApi} from '../drive/drive-api';
import {LibraryAssetPreview} from '../drive/LibraryAssetPreview';
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
type Node={id:string;kind:'folder'|'asset';name:string;mime_type?:string};
function VirtualProjectMaterials({projectId,onManage}:{projectId:number;onManage:()=>void}){
 const call=useDriveApi(),[nodes,setNodes]=useState<Node[]>([]),[busy,setBusy]=useState(true),[error,setError]=useState(''),[attempt,setAttempt]=useState(0),[preview,setPreview]=useState<Node|null>(null);
 useEffect(()=>{
  const controller=new AbortController();setNodes([]);setBusy(true);setError('');setPreview(null);
  void call<{nodes:Node[]}>('/library/projects/'+projectId+'/nodes','GET',undefined,controller.signal)
   .then(result=>{if(!controller.signal.aborted)setNodes(result.nodes);})
   .catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Não foi possível carregar os materiais.');})
   .finally(()=>{if(!controller.signal.aborted)setBusy(false);});
  return()=>controller.abort();
 },[projectId,call,attempt]);
 return <div className="pd-material-empty">{busy?<p role="status">Carregando materiais…</p>:error?<><p role="alert">{error}</p><AppButton onClick={()=>setAttempt(x=>x+1)}>Tentar novamente</AppButton></>:<>
  {!nodes.length&&<p>Crie pastas e adicione arquivos do Drive ou Dropbox na Biblioteca deste projeto.</p>}
  {nodes.slice(0,6).map(node=><AppButton key={node.id} onClick={()=>node.kind==='folder'?onManage():setPreview(node)}><FolderOpen size={18}/>{node.name}</AppButton>)}
 </>}
 <AppButton className="secondary-button" onClick={onManage}>Abrir Biblioteca do projeto<ExternalLink size={16}/></AppButton>
 {preview&&<LibraryAssetPreview key={preview.id} projectId={projectId} node={preview} onClose={()=>setPreview(null)}/>}
 </div>;
}
