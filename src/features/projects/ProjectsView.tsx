import {AppButton} from "../ui/AppButton";
import {useEffect,useRef,useState} from 'react';
import {CalendarDays,ChevronDown,ChevronRight,Film,FolderOpen,LayoutGrid,ImagePlus,Pencil} from 'lucide-react';
import type {Project,ProjectCover,Status} from '../../domain/workspace';
import {PROJECT_STATUS_ICONS} from '../ui/project-status';
import {isDemo} from '../../lib/firebase';
import {DriveCoversProvider,useCoverImage,useDriveCovers} from './DriveCoversProvider';
import {CoverEditor} from './CoverEditor';
import {CoverFrame} from './CoverFrame';
import './projects.css';
const colors:Record<Status,string>={'Em produção':'#349af4','Em aprovação':'#f6bd4f','Ajustes':'#ae77f1','Aprovado':'#38cc74'};
function StatusIcon({status}:{status:Status}){const Icon=PROJECT_STATUS_ICONS[status];return <Icon size={18} style={{color:colors[status]}} aria-hidden="true"/>;}
function ProjectCard({project,onOpen,onEdit}:{project:Project;onOpen:()=>void;onEdit:()=>void}){
 const context=useDriveCovers();const box=useRef<HTMLElement>(null);const [visible,setVisible]=useState(false);
 useEffect(()=>{const observer=new IntersectionObserver(([entry])=>{if(entry.isIntersecting){setVisible(true);observer.disconnect();}},{rootMargin:'100px'});if(box.current)observer.observe(box.current);return ()=>observer.disconnect();},[]);
 const {src,error}=useCoverImage(project.cover,visible,true);
 const canEdit=!!context?.connections.some(c=>c.provider==='google_drive');
 const showImage=!!project.cover;
 return <article className="pc-card" ref={box}>
  {showImage&&<div className="pc-photo">{src?<CoverFrame src={src} cover={project.cover!}/>:<div className="pc-image-unavailable"><ImagePlus size={28}/><span>{error?'Capa indisponível':'Carregando capa…'}</span></div>}<AppButton type="button" className="pc-edit-overlay" onClick={onEdit} disabled={!canEdit}><Pencil size={16}/>Editar capa</AppButton><span className="pc-files-overlay"><Film size={17}/>{project.files} {project.files===1?'arquivo':'arquivos'}</span><AppButton className="pc-open-overlay" type="button" aria-label={'Abrir projeto '+project.name} onClick={onOpen}><ChevronRight size={23}/></AppButton></div>}
  <div className="pc-card-body">
   <div className="pc-card-top"><span className="pc-status"><StatusIcon status={project.status}/>{project.status}</span>{canEdit&&!showImage&&<AppButton type="button" className="pc-add-cover" onClick={onEdit}><ImagePlus size={16}/>{project.cover?'Editar capa':'Adicionar capa'}</AppButton>}</div>
   <h2><AppButton type="button" onClick={onOpen}>{project.name}{!showImage&&<ChevronRight size={20}/>}</AppButton></h2><p>{project.clientId?project.client:'Sem cliente vinculado'}</p>
   {!showImage&&<span className="pc-files"><Film size={16}/>{project.files} {project.files===1?'arquivo':'arquivos'}</span>}
   <div className="pc-progress" aria-label={'Progresso de '+project.name} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={project.progress}><span><i style={{width:project.progress+'%'}}/></span><b>{project.progress}%</b></div>
   <footer><span><CalendarDays size={19}/>{project.due||'Sem prazo'}</span><span>{project.template||'Produção'}</span></footer>
  </div>
 </article>;
}
type Props={projects:Project[];statusFilter:Status|'Todos';setStatusFilter:(status:Status|'Todos')=>void;onOpen:(id:number)=>void;onSaveCover:(id:number,cover:ProjectCover|undefined)=>void;total?:number;hasMore?:boolean;onMore?:()=>void};
function ProjectsGrid({projects,statusFilter,setStatusFilter,onOpen,onSaveCover,total,hasMore,onMore}:Props){
 const [editing,setEditing]=useState<number|null>(null);const context=useDriveCovers();
 const project=projects.find(p=>p.id===editing);
 const filters:(Status|'Todos')[]=['Todos','Em produção','Em aprovação','Ajustes','Aprovado'];
 return <>
  {context?.error&&<p className="pc-connection-notice" role="status">Não foi possível consultar as conexões. As imagens podem estar temporariamente indisponíveis. Tente atualizar as conexões.</p>}
  <section className="pc-panel" aria-label="Lista de projetos">
   <div className="pc-filter-bar"><div className="pc-filters" aria-label="Filtrar projetos por situação">{filters.map(filter=><AppButton type="button" key={filter} aria-pressed={filter===statusFilter} className={filter===statusFilter?'active':''} onClick={()=>setStatusFilter(filter)}>{filter==='Todos'?<LayoutGrid size={18} aria-hidden="true"/>:<StatusIcon status={filter}/>}<span>{filter}</span></AppButton>)}</div><span className="pc-result-count">{total!==undefined&&total>projects.length?`${projects.length} de ${total} projetos`:`${projects.length} ${projects.length===1?'projeto encontrado':'projetos encontrados'}`}</span></div>
   <div className="pc-cards">{projects.map(project=><ProjectCard key={project.id} project={project} onOpen={()=>onOpen(project.id)} onEdit={()=>setEditing(project.id)}/>)}</div>
   {!projects.length&&<div className="empty-state"><FolderOpen size={32}/><h3>{statusFilter==='Todos'?'Nenhum projeto encontrado':'Nenhum projeto nesta situação'}</h3><p>{statusFilter==='Todos'?'Crie um projeto ou ajuste sua busca para continuar.':'Selecione outra situação para ver seus projetos.'}</p></div>}
   {hasMore&&<div className="pc-more"><AppButton type="button" className="secondary-button" onClick={onMore}>Carregar mais projetos<ChevronDown size={16}/></AppButton></div>}
  </section>
  {project&&context?.connections.some(c=>c.provider==='google_drive')?<CoverEditor key={project.id} project={project} onClose={()=>setEditing(null)} onSave={cover=>onSaveCover(project.id,cover)}/>:null}
 </>;
}
export function ProjectsView(props:Props){return isDemo?<ProjectsGrid {...props}/>:<DriveCoversProvider><ProjectsGrid {...props}/></DriveCoversProvider>;}
