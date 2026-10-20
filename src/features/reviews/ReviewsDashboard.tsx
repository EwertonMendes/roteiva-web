import {useCallback,useEffect,useMemo,useState} from "react";
import {Check,ChevronLeft,ChevronRight,Copy,ExternalLink,FileImage,FileText,FileVideo,Folder,Link2,LoaderCircle,MessageSquare,Plus,Search,Send,ShieldCheck,X} from "lucide-react";
import type {Client,Project} from "../../domain/workspace";
import {useAuth} from "../auth/AuthProvider";
import {useDriveApi} from "../drive/drive-api";
import {readDriveLinks,type DriveFolderLink} from "../../data/drive-folder-links";
import type {DriveItem} from "../drive/DriveLibraryUI";
import "./reviews.css";

type Status="draft"|"publishing"|"pending"|"changes"|"approved"|"replacing"|"closing"|"closed";
type Mode="link"|"google";
type Review={id:string;clientId:number;projectId:number;clientName:string;projectName:string;studioName:string;title:string;message:string;recipientEmail:string;mode:Mode;status:Status;version:number;expiresAt:number;createdAt:number;updatedAt:number;url?:string};
type Asset={version:number;fileId:string;name:string;mimeType:string;grantState:string};
type Comment={id:string;version:number;file_id:string;author_name:string;body:string;seconds:number|null;created_at:number};
type Decision={version:number;decision:"approved"|"changes";author_name:string;message:string;created_at:number};
type Detail={review:Review;assets:Asset[];comments:Comment[];decisions:Decision[]};
type Selection={fileId:string;connectionId:string;linkedFolderId:string;name:string;mimeType:string};
const statusText:Record<Status,string>={
  draft:"Rascunho",publishing:"Preparando compartilhamento",pending:"Aguardando cliente",
  changes:"Ajustes solicitados",approved:"Aprovado",replacing:"Preparando nova versão",
  closing:"Revogação pendente",closed:"Encerrado"
};
const fmt=(time:number)=>new Date(time).toLocaleDateString("pt-BR",{day:"2-digit",month:"short",year:"numeric"});
const supported=(file:DriveItem)=>/^(video|image|audio)\//.test(file.mimeType)||file.mimeType==="application/pdf";
function AssetIcon({mime}:{mime:string}){
  if(mime.startsWith("image/"))return <FileImage size={18}/>;
  if(mime.startsWith("video/"))return <FileVideo size={18}/>;
  return <FileText size={18}/>;
}
function ShareLinks({url,title}:{url:string;title:string}){
  const text="Olá! Seu material está disponível para revisão: "+title+"\n"+url;
  const [copied,setCopied]=useState(false);
  return <div className="review-share">
    <button type="button" className="secondary-button" onClick={async()=>{
      try{await navigator.clipboard.writeText(url);setCopied(true);}
      catch{window.prompt("Copie o link:",url);}
    }}><Copy size={16}/>{copied?"Link copiado":"Copiar link"}</button>
    <a className="secondary-button" href={"https://wa.me/?text="+encodeURIComponent(text)} target="_blank" rel="noreferrer">WhatsApp <ExternalLink size={14}/></a>
    <a className="secondary-button" href={"mailto:?subject="+encodeURIComponent("Material para aprovação · "+title)+"&body="+encodeURIComponent(text)}>E-mail <Send size={14}/></a>
  </div>;
}
export function ReviewsDashboard({clients,projects,studioName,onLibrary,startProjectId,startClientId}:{
  clients:Client[];projects:Project[];studioName:string;onLibrary:()=>void;startProjectId?:number;startClientId?:number
}){
  const {user}=useAuth(),call=useDriveApi();
  const [rows,setRows]=useState<Review[]>([]);
  const [search,setSearch]=useState(""),[status,setStatus]=useState(""),[page,setPage]=useState(0);
  const [hasMore,setHasMore]=useState(false),[refresh,setRefresh]=useState(0);
  const [loading,setLoading]=useState(true),[working,setWorking]=useState(false),[error,setError]=useState("");
  const [opened,setOpened]=useState<Detail|null>(null);
  const [composer,setComposer]=useState(false),[replacement,setReplacement]=useState<string|null>(null);
  const [clientId,setClientId]=useState(startClientId||0),[projectId,setProjectId]=useState(startProjectId||0);
  const [title,setTitle]=useState(""),[message,setMessage]=useState("");
  const [mode,setMode]=useState<Mode>("link"),[recipient,setRecipient]=useState("");
  const [days,setDays]=useState(14),[links,setLinks]=useState<DriveFolderLink[]>([]);
  const [selectedFolder,setSelectedFolder]=useState<DriveFolderLink|null>(null);
  const [trail,setTrail]=useState<{id:string;name:string}[]>([]);
  const [items,setItems]=useState<DriveItem[]>([]);
  const [files,setFiles]=useState<Selection[]>([]);
  const [folderBusy,setFolderBusy]=useState(false),[nextToken,setNextToken]=useState<string|null>(null);
  const [folderError,setFolderError]=useState("");

  const loadList=useCallback(async()=>{
    setLoading(true);
    try{
      const result=await call<{reviews:Review[];hasMore:boolean}>("/reviews?"+new URLSearchParams({page:String(page),q:search,status}));
      setRows(result.reviews);setHasMore(result.hasMore);
    }catch(e){setError(e instanceof Error?e.message:"Não foi possível carregar as aprovações.");}
    finally{setLoading(false);}
  },[call,page,refresh,search,status]);
  useEffect(()=>{void loadList();},[loadList]);
  useEffect(()=>{if(startProjectId){setProjectId(startProjectId);setClientId(startClientId||projects.find(p=>p.id===startProjectId)?.clientId||0);setComposer(true);}},
    [startProjectId,startClientId,projects]);
  const relevantProjects=useMemo(()=>clientId?projects.filter(p=>p.clientId===clientId):projects,[clientId,projects]);
  useEffect(()=>{
    if(!user||!projectId||!composer){setLinks([]);return;}
    let alive=true;
    readDriveLinks(user.uid).then(result=>{
      if(alive)setLinks(result.filter(l=>l.projectId===projectId));
    }).catch(()=>{if(alive)setFolderError("Não foi possível ler as pastas vinculadas.");});
    return()=>{alive=false;};
  },[user,projectId,composer]);
  const browse=useCallback(async(folder:DriveFolderLink,targetId:string,path:{id:string;name:string}[],append=false,pageKey?:string)=>{
    setFolderBusy(true);setFolderError("");
    try{
      const params=pageKey?"?pageToken="+encodeURIComponent(pageKey):"";
      const response=await call<{files:DriveItem[];nextPageToken:string|null}>(
        "/integrations/drive/"+encodeURIComponent(folder.connectionId)+"/folders/"+encodeURIComponent(targetId)+"/items"+params);
      setItems(old=>append?[...old,...response.files]:response.files);
      setTrail(path);setNextToken(response.nextPageToken);
    }catch(e){setFolderError(e instanceof Error?e.message:"Não foi possível abrir a pasta.");if(!append)setItems([]);}
    finally{setFolderBusy(false);}
  },[call]);
  const pickFolder=(folder:DriveFolderLink)=>{
    setSelectedFolder(folder);setTrail([{id:folder.folderId,name:folder.folderName}]);
    void browse(folder,folder.folderId,[{id:folder.folderId,name:folder.folderName}]);
  };
  const resetComposer=()=>{
    setComposer(false);setReplacement(null);setFiles([]);setTitle("");setMessage("");setSelectedFolder(null);
    setTrail([]);setItems([]);setError("");setFolderError("");
  };
  const newReview=()=>{
    setClientId(0);setProjectId(0);setRecipient("");setTitle("");setMessage("");setFiles([]);setMode("link");
    setReplacement(null);setComposer(true);setOpened(null);setError("");
  };
  const openDetail=async(id:string)=>{
    setWorking(true);setError("");
    try{setOpened(await call<Detail>("/reviews/"+id));}
    catch(e){setError(e instanceof Error?e.message:"Não foi possível abrir a aprovação.");}
    finally{setWorking(false);}
  };
  const run=async(job:()=>Promise<void>)=>{
    setWorking(true);setError("");
    try{await job();setRefresh(n=>n+1);}
    catch(e){setError(e instanceof Error?e.message:"Não foi possível concluir a operação.");}
    finally{setWorking(false);}
  };
  const submit=async()=>{
    if(!projectId||!clientId||!files.length) {setError("Escolha o cliente, projeto e pelo menos um arquivo.");return;}
    await run(async()=>{
      const selections=files.map(f=>({fileId:f.fileId,linkedFolderId:f.linkedFolderId,connectionId:f.connectionId}));
      if(replacement){
        const result=await call<{review:Detail}>("/reviews/"+replacement+"/revise","POST",{assets:selections});
        setOpened(result.review);
      }else{
        const created=await call<{id:string}>("/reviews","POST",{
          clientId,projectId,studioName,title,message,mode,recipientEmail:recipient,
          expiresInDays:days,assets:selections
        });
        setOpened(await call<Detail>("/reviews/"+created.id));
        try{
          const published=await call<{review:Detail}>("/reviews/"+created.id+"/publish","POST");
          setOpened(published.review);
        }catch(e){
          setError("Solicitação salva como rascunho, mas o compartilhamento não foi concluído. Abra o registro e tente novamente. "+
            (e instanceof Error?e.message:""));
        }
      }
      resetComposer();
    });
  };
  const beginRevision=()=>{
    if(!opened)return;
    setClientId(opened.review.clientId);setProjectId(opened.review.projectId);setReplacement(opened.review.id);
    setFiles([]);setComposer(true);
  };
  const mutate=async(action:"publish"|"rotate"|"close")=>{
    if(!opened)return;
    if(action==="close"&&!window.confirm("Encerrar esta revisão e revogar os acessos concedidos no Google Drive?"))return;
    await run(async()=>{
      await call("/reviews/"+opened.review.id+"/"+action,"POST");
      if(action==="close")setOpened(null);
      else await openDetail(opened.review.id);
    });
  };
  const chosenClient=clients.find(c=>c.id===clientId);
  const addFile=(file:DriveItem)=>{
    if(!selectedFolder)return;
    if(!supported(file))return;
    setFiles(old=>old.some(f=>f.fileId===file.id)?old.filter(f=>f.fileId!==file.id):
      old.length>=8?old:[...old,{fileId:file.id,name:file.name,mimeType:file.mimeType,
        connectionId:selectedFolder.connectionId,linkedFolderId:selectedFolder.folderId}]);
  };
  return <div className="reviews-panel">
    <div className="reviews-summary">
      {(["pending","changes","approved"] as const).map(s=><div key={s} className="reviews-stat">
        <span>{statusText[s]}</span><strong>{rows.filter(r=>r.status===s).length}</strong>
      </div>)}
    </div>
    <div className="reviews-toolbar">
      <label className="reviews-search"><Search size={16}/><input aria-label="Buscar aprovações" placeholder="Cliente, projeto ou material" value={search}
        onChange={e=>{setSearch(e.target.value);setPage(0);}}/></label>
      <select aria-label="Filtrar aprovações" value={status} onChange={e=>{setStatus(e.target.value);setPage(0);}}>
        <option value="">Todas as situações</option>
        {(["draft","pending","changes","approved","closed"] as const).map(s=><option key={s} value={s}>{statusText[s]}</option>)}
      </select>
      <button className="primary-button" onClick={newReview}><Plus size={16}/> Nova aprovação</button>
    </div>
    {error&&<div className="reviews-warning" role="alert">{error}<button aria-label="Dispensar mensagem" onClick={()=>setError("")}><X size={14}/></button></div>}
    {loading?<p role="status"><LoaderCircle size={17} className="rl-spin"/> Carregando aprovações…</p>:
      <div className="reviews-list">
        {!rows.length&&<div className="reviews-empty"><ShieldCheck size={32}/><h3>Nenhuma aprovação encontrada</h3><p>Selecione um projeto e envie o primeiro material para revisão.</p></div>}
        {rows.map(r=><button type="button" className="reviews-list-item" key={r.id} onClick={()=>void openDetail(r.id)}>
          <span className="reviews-initial">{r.clientName.slice(0,2).toUpperCase()}</span>
          <span className="reviews-list-copy"><strong>{r.title}</strong><small>{r.clientName} · {r.projectName} · V{r.version}</small></span>
          <span className={"reviews-status status-"+r.status}>{statusText[r.status]}</span>
          <ChevronRight size={17}/>
        </button>)}
      </div>}
    <div className="reviews-pagination">
      <button className="secondary-button" disabled={page===0||loading} onClick={()=>setPage(n=>n-1)}>Anterior</button>
      <span>Página {page+1}</span>
      <button className="secondary-button" disabled={!hasMore||loading} onClick={()=>setPage(n=>n+1)}>Próxima</button>
    </div>

    {opened&&!composer&&<div className="review-modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setOpened(null);}}>
      <section role="dialog" aria-modal="true" aria-label="Detalhes da revisão" className="review-dialog">
        <header><div><span className="eyebrow">APROVAÇÃO · V{opened.review.version}</span><h2>{opened.review.title}</h2>
          <p>{opened.review.clientName} · {opened.review.projectName}</p></div>
          <button className="review-icon" aria-label="Fechar" onClick={()=>setOpened(null)}><X size={20}/></button>
        </header>
        <div className="review-dialog-body">
          <div className="reviews-detail-bar"><span className={"reviews-status status-"+opened.review.status}>{statusText[opened.review.status]}</span>
            <small>Válido até {fmt(opened.review.expiresAt)}</small></div>
          <h3>Materiais</h3>
          {opened.assets.map(a=><div className="review-asset" key={a.version+":"+a.fileId}>
            <AssetIcon mime={a.mimeType}/><span><strong>{a.name}</strong><small>Versão {a.version} · {a.grantState==="granted"?"Compartilhado":a.grantState==="revoked"?"Acesso revogado":"Não compartilhado"}</small></span>
          </div>)}
          {opened.review.status!=="closed"&&<div className="reviews-link-box">
            <span><Link2 size={15}/> Link de revisão</span>
            <input readOnly aria-label="Link da revisão" value={opened.review.url||""} onFocus={e=>e.currentTarget.select()}/>
            <ShareLinks url={opened.review.url||""} title={opened.review.title}/>
            <small>O link dá acesso somente aos materiais selecionados, conforme a modalidade escolhida. Prazo até {fmt(opened.review.expiresAt)}.</small>
          </div>}
          <h3><MessageSquare size={17}/> Comentários e decisões</h3>
          {!opened.comments.length&&!opened.decisions.length&&<p className="reviews-muted">Ainda não há feedback do cliente.</p>}
          {opened.decisions.map((d,i)=><div className="review-feedback" key={"d"+i}>
            <strong>{d.decision==="approved"?"Material aprovado":"Ajustes solicitados"} · V{d.version}</strong><small>{d.author_name} · {fmt(d.created_at)}</small>
            {d.message&&<p>{d.message}</p>}
          </div>)}
          {opened.comments.map(c=><div className="review-feedback" key={c.id}>
            <strong>{c.author_name} · V{c.version}{c.seconds!==null?" · "+Math.floor(c.seconds/60)+":"+String(c.seconds%60).padStart(2,"0"):""}</strong>
            <small>{fmt(c.created_at)}</small><p>{c.body}</p>
          </div>)}
        </div>
        <footer>
          {["draft","publishing"].includes(opened.review.status)&&<button className="primary-button" disabled={working}
            onClick={()=>void mutate("publish")}>Ativar compartilhamento</button>}
          {opened.review.status==="changes"&&<button className="primary-button" onClick={beginRevision}>Enviar nova versão</button>}
          {opened.review.status!=="closed"&&<button className="secondary-button" disabled={working} onClick={()=>void mutate("rotate")}>Renovar link</button>}
          {opened.review.status!=="closed"&&<button className="secondary-button" disabled={working} onClick={()=>void mutate("close")}>Encerrar revisão</button>}
        </footer>
      </section>
    </div>}

    {composer&&<div className="review-modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)resetComposer();}}>
      <section className="review-dialog" role="dialog" aria-modal="true" aria-label="Enviar materiais para aprovação">
        <header><div><span className="eyebrow">APROVAÇÕES / {replacement?"NOVA VERSÃO":"NOVA SOLICITAÇÃO"}</span>
          <h2>{replacement?"Selecione os novos arquivos":"Enviar para aprovação"}</h2>
          <p>Escolha os materiais que o cliente poderá revisar.</p></div>
          <button className="review-icon" onClick={resetComposer} aria-label="Fechar"><X size={20}/></button></header>
        <div className="review-dialog-body">
          <div className="review-fields">
            <label>Cliente
              <select disabled={!!replacement} value={clientId} onChange={e=>{
                const id=Number(e.target.value);setClientId(id);setProjectId(0);setFiles([]);setSelectedFolder(null);
                setRecipient(clients.find(c=>c.id===id)?.email||"");
              }}><option value={0}>Selecionar cliente</option>{clients.map(c=><option value={c.id} key={c.id}>{c.name}</option>)}</select></label>
            <label>Projeto
              <select disabled={!!replacement} value={projectId} onChange={e=>{
                setProjectId(Number(e.target.value));setFiles([]);setSelectedFolder(null);setTrail([]);setItems([]);
              }}><option value={0}>Selecionar projeto</option>{relevantProjects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            {!replacement&&<>
              <label>Título da aprovação<input maxLength={180} required value={title} onChange={e=>setTitle(e.target.value)} placeholder="Ex.: Primeiro corte da campanha"/></label>
              <label>Mensagem (opcional)<textarea maxLength={1500} rows={2} value={message} onChange={e=>setMessage(e.target.value)} placeholder="O que o cliente deve avaliar?"/></label>
              <label>Tipo de acesso<select value={mode} onChange={e=>setMode(e.target.value as Mode)}>
                <option value="link">Qualquer pessoa com o link</option><option value="google">Somente Google autorizado</option>
              </select></label>
              {mode==="link"?<p className="reviews-info">Os arquivos selecionados receberão permissão de visualização por link no Google Drive. Não utilize com informações confidenciais.</p>:
                <label>E-mail Google autorizado<input type="email" required value={recipient} maxLength={200}
                  onChange={e=>setRecipient(e.target.value)} placeholder="cliente@gmail.com"/></label>}
              <label>Validade<select value={days} onChange={e=>setDays(Number(e.target.value))}>
                <option value={7}>7 dias</option><option value={14}>14 dias</option><option value={30}>30 dias</option>
              </select></label>
            </>}
            {chosenClient&&!relevantProjects.length&&<p className="reviews-muted">Este cliente ainda não possui projetos vinculados.</p>}
          </div>
          <h3>Arquivos do Google Drive <span>({files.length}/8)</span></h3>
          {!projectId?<p className="reviews-muted">Selecione um projeto para explorar os arquivos vinculados.</p>:
          !links.length?<div className="reviews-empty"><Folder size={26}/><p>Este projeto ainda não possui pastas vinculadas.</p>
            <button className="secondary-button" onClick={()=>{resetComposer();onLibrary();}}>Vincular pasta na Biblioteca</button></div>:
          <>
            <div className="review-folder-tabs">{links.map(l=><button type="button" key={l.id} className={selectedFolder?.id===l.id?"active":""}
              onClick={()=>pickFolder(l)}><Folder size={15}/>{l.folderName}</button>)}</div>
            {selectedFolder&&<div className="review-breadcrumbs">{trail.map((node,i)=><button key={node.id}
              onClick={()=>void browse(selectedFolder,node.id,trail.slice(0,i+1))}>
                {i>0&&<ChevronRight size={12}/>} {node.name}</button>)}</div>}
            {folderError&&<p className="reviews-warning" role="alert">{folderError}</p>}
            <div className="review-files">
              {folderBusy&&<p role="status"><LoaderCircle size={16} className="rl-spin"/> Carregando arquivos…</p>}
              {!folderBusy&&selectedFolder&&!items.length&&<p className="reviews-muted">Esta pasta está vazia.</p>}
              {items.map(f=>f.mimeType==="application/vnd.google-apps.folder"?
                <button type="button" key={f.id} onClick={()=>{if(selectedFolder)void browse(selectedFolder,f.id,[...trail,{id:f.id,name:f.name}]);}}>
                  <Folder size={18}/><span>{f.name}</span><ChevronRight size={15}/></button>:
                <label key={f.id} className={!supported(f)?"unsupported":""}><input type="checkbox" disabled={!supported(f)}
                  checked={files.some(a=>a.fileId===f.id)} onChange={()=>addFile(f)}/>
                  <AssetIcon mime={f.mimeType}/><span>{f.name}</span></label>)}
            </div>
            {nextToken&&selectedFolder&&<button type="button" className="secondary-button" disabled={folderBusy}
              onClick={()=>void browse(selectedFolder,trail[trail.length-1].id,trail,true,nextToken)}>Carregar mais arquivos</button>}
          </>}
          {files.length>0&&<div className="reviews-selected"><h3>Selecionados</h3>
            {files.map(f=><div key={f.fileId}><Check size={14}/><span>{f.name}</span>
              <button onClick={()=>setFiles(x=>x.filter(a=>a.fileId!==f.fileId))} aria-label={"Remover "+f.name}><X size={15}/></button></div>)}</div>}
          <p className="reviews-muted">Precisa enviar um arquivo novo? Utilize o upload da Biblioteca e depois selecione-o aqui.</p>
        </div>
        <footer><button className="secondary-button" onClick={resetComposer}>Cancelar</button>
          <button className="primary-button" disabled={working||!files.length||!projectId||!clientId||(!replacement&&!title.trim())||(!replacement&&mode==="google"&&!recipient.includes("@"))}
            onClick={()=>void submit()}>{working?"Preparando…":replacement?"Enviar nova versão":"Gerar aprovação"} <Send size={16}/></button></footer>
      </section>
    </div>}
  </div>;
}
