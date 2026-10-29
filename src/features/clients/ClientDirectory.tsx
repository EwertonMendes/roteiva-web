import {useEffect,useRef,useState} from "react";
import {Building2,Camera,ChevronDown,ChevronRight,ContactRound,ReceiptText,UserRound,UserRoundPlus,UsersRound} from "lucide-react";
import type {Client,ClientPhoto} from "../../domain/workspace";
import {isDemo} from "../../lib/firebase";
import {DriveCoversProvider,useCoverImage} from "../projects/DriveCoversProvider";
import {CoverFrame} from "../projects/CoverFrame";
import {CoverEditor} from "../projects/CoverEditor";
import "./clients.css";

type Props={
 clients:Client[];onOpen:(id:number)=>void;onAdd:()=>void;
 onSavePhoto:(id:number,photo:ClientPhoto|undefined)=>void;
 totalCount?:number;recurringCount?:number;activeProjectsCount?:number;hasMore?:boolean;onMore?:()=>void;
};
function ClientAvatar({client}:{client:Client}){
 const element=useRef<HTMLSpanElement>(null);
 const [visible,setVisible]=useState(false);
 useEffect(()=>{
  if(!element.current)return;
  if(typeof IntersectionObserver==="undefined"){setVisible(true);return;}
  const observer=new IntersectionObserver(entries=>{
    if(entries.some(entry=>entry.isIntersecting)){setVisible(true);observer.disconnect();}
  },{rootMargin:"100px"});
  observer.observe(element.current);
  return ()=>observer.disconnect();
 },[]);
 const {src}=useCoverImage(client.photo,visible,true);
 return <span className={"cd-avatar "+(src?"cd-avatar--loaded":"")} ref={element} aria-hidden="true">
  {src&&client.photo?<CoverFrame src={src} cover={client.photo}/>:<span className="cd-avatar-fallback">{client.initials||client.name.slice(0,2).toUpperCase()}</span>}
 </span>;
}
function ClientDirectoryContent({clients,onOpen,onAdd,onSavePhoto,totalCount,recurringCount,activeProjectsCount,hasMore,onMore}:Props){
 const [editingPhoto,setEditingPhoto]=useState<number|null>(null);
 const current=clients.find(c=>c.id===editingPhoto);
 const total=totalCount??clients.length;
 const recurring=recurringCount??clients.filter(c=>c.type==="Recorrente").length;
 const active=activeProjectsCount??clients.reduce((count,c)=>count+c.active,0);
 return <section className="cd-panel" aria-label="Carteira de clientes">
   <div className="cd-summary">
    <div><span>CLIENTES CADASTRADOS</span><strong>{total}</strong><small>{active} {active===1?"projeto em produção":"projetos em produção"}</small></div>
    <div><span>CLIENTES RECORRENTES</span><strong>{recurring}</strong><small>{Math.round(recurring/Math.max(1,total)*100)}% da carteira</small></div>
    <div><span>CLIENTES AVULSOS</span><strong>{total-recurring}</strong><small>Trabalhos pontuais</small></div>
   </div>
   <header className="cd-toolbar">
    <div><h2>Carteira de clientes</h2><p>{total>clients.length?`${clients.length} de ${total} carregados · `:""}Classifique cada relacionamento para entender melhor sua receita.</p></div>
    <button type="button" className="secondary-button" onClick={onAdd}><UserRoundPlus size={18}/>Adicionar cliente</button>
   </header>
   <div className="cd-table-head" aria-hidden="true"><span>CLIENTE</span><span>RELACIONAMENTO</span><span>CONTATO</span><span>PROJETOS</span><span>DESDE</span><span/></div>
   <div className="cd-list">{clients.map(client=><article key={client.id} className="cd-row">
     <div className="cd-identity">
      <ClientAvatar client={client}/>
      <div className="cd-identity-copy"><button type="button" className="cd-client-name" onClick={()=>onOpen(client.id)}>{client.name}</button>
       {!isDemo&&<button type="button" className="cd-change-photo" onClick={()=>setEditingPhoto(client.id)}><Camera size={16}/>{client.photo?"Alterar foto":"Adicionar foto"}</button>}
      </div>
     </div>
     <span className="cd-relationship"><span className="cd-type">{client.type==="Recorrente"?<Building2 size={18}/>:<ReceiptText size={18}/>} {client.type}</span></span>
     <span className="cd-contact"><strong>{client.contact||"Sem contato principal"}</strong>
       {client.phone&&<small>{client.phone}</small>}
       {client.email&&<small>{client.email}</small>}
       {!client.phone&&!client.email&&<small>Contato não informado</small>}
     </span>
     <span className="cd-projects"><span className="cd-mobile-label">Projetos</span>{client.projects}</span>
     <span className="cd-since"><span className="cd-mobile-label">Desde</span>{client.since}</span>
     <button className="cd-open" type="button" aria-label={`Abrir cliente ${client.name}`} onClick={()=>onOpen(client.id)}><ChevronRight size={21}/></button>
    </article>)}
    {!clients.length&&<div className="cd-empty"><UsersRound size={42} strokeWidth={1.65}/><h3>Nenhum cliente cadastrado</h3><p>Adicione o primeiro cliente e defina se o relacionamento é recorrente ou avulso.</p></div>}
   </div>
   {hasMore&&<div className="cd-more"><button className="secondary-button" type="button" onClick={onMore}>Carregar mais clientes <ChevronDown size={17}/></button></div>}
   {current&&<CoverEditor key={current.id} client={current} onClose={()=>setEditingPhoto(null)} onSave={photo=>onSavePhoto(current.id,photo)}/>}
  </section>;
}
export function ClientDirectory(props:Props){
 return isDemo?<ClientDirectoryContent {...props}/>:<DriveCoversProvider includeDropbox><ClientDirectoryContent {...props}/></DriveCoversProvider>;
}
