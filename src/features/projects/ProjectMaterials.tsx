import {useEffect,useState} from 'react';
import {ExternalLink,FolderOpen,Link2,Pencil} from 'lucide-react';
import {useAuth} from '../auth/AuthProvider';
import {readDriveLinks,type DriveFolderLink} from '../../data/drive-folder-links';

/** Read existing folder associations only. Upload/link management stays in the Library. */
export function ProjectMaterials({projectId,onManage}:{projectId:number;onManage:()=>void}){
  const {user}=useAuth();
  const [state,setState]=useState<{links:DriveFolderLink[];loading:boolean;error:boolean}>({links:[],loading:true,error:false});
  const [attempt,setAttempt]=useState(0);
  useEffect(()=>{
    let active=true;
    setState({links:[],loading:true,error:false});
    if(!user)return;
    readDriveLinks(user.uid,projectId).then(links=>{if(active)setState({links,loading:false,error:false});}).catch(()=>{if(active)setState({links:[],loading:false,error:true});});
    return ()=>{active=false;};
  },[user?.uid,projectId,attempt]);
  if(state.loading)return <p role="status">Carregando materiais vinculados…</p>;
  if(state.error)return <div className="pd-material-empty" role="alert"><p>Não foi possível carregar os materiais.</p><button className="secondary-button" onClick={()=>setAttempt(value=>value+1)}>Tentar novamente</button></div>;
  return <>{state.links.map(link=><article className="pd-material" key={link.id}><span className="pd-material-icon" aria-hidden="true"><Link2 size={25}/></span><div className="pd-folder-copy"><b>{link.folderName}</b><p>Pasta vinculada ao projeto · Google Drive</p><a href={`https://drive.google.com/drive/folders/${encodeURIComponent(link.folderId)}`} target="_blank" rel="noreferrer">Abrir link<ExternalLink size={15} aria-hidden="true"/></a></div><button className="secondary-button" onClick={onManage} aria-label={`Gerenciar material ${link.folderName}`}><Pencil size={16} aria-hidden="true"/>Gerenciar</button></article>)}{!state.links.length&&<div className="pd-material-empty"><FolderOpen size={23} aria-hidden="true"/><p>Vincule pastas do Google Drive ou envie arquivos pela Biblioteca deste projeto.</p><button className="secondary-button" onClick={onManage}>Abrir Biblioteca<ExternalLink size={16} aria-hidden="true"/></button></div>}</>;
}
