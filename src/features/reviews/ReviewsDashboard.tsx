import {useCallback,useEffect,useMemo,useRef,useState} from "react";
import {createPortal} from "react-dom";
import {Check,ChevronLeft,ChevronRight,Copy,ExternalLink,FileImage,FileText,FileVideo,Folder,Link2,LoaderCircle,MessageSquare,Plus,Search,Send,ShieldCheck,X} from "lucide-react";
import type {Client,Project} from "../../domain/workspace";
import {useAuth} from "../auth/AuthProvider";
import {useDriveApi} from "../drive/drive-api";
import {readDriveLinks,type DriveFolderLink} from "../../data/drive-folder-links";
import {driveFileUrl,readableFileType,type DriveItem,useOverlayFocus} from "../drive/DriveLibraryUI";
import {DriveThumbnail} from "../drive/DriveThumbnail";
import {useDriveThumbnailFetch} from "../drive/useDriveThumbnailFetch";
import {cacheKey,getCachedFolder,setCachedFolder} from "../drive/drive-folder-cache";
import {useDriveTransfers} from "../drive/DriveTransfersProvider";
import type {UploadDestination} from "../drive/useDriveUploads";
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
  const {user}=useAuth(),call=useDriveApi(),transfers=useDriveTransfers();
  const getThumbnail=useDriveThumbnailFetch();
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
  const [fileSearch,setFileSearch]=useState("");
  const [remote,setRemote]=useState<{term:string;folderId:string;files:DriveItem[];page:string|null}|null>(null);
  const [searchBusy,setSearchBusy]=useState(false);
  const searchSequence=useRef(0);
  const browseSequence=useRef(0),listSequence=useRef(0);
  const dialogRef=useOverlayFocus(()=>{if(!working){if(composer)resetComposer();else setOpened(null);}},composer||!!opened,composer?'compose':'detail');
  const pendingUploads=transfers.uploads.filter(entry=>entry.destination.projectId===projectId&&
    !["completed","cancelled"].includes(entry.status));
  useEffect(()=>{
    transfers.setAuthorizationInline(composer);
    return()=>transfers.setAuthorizationInline(false);
  },[composer,transfers.setAuthorizationInline]);

  const loadList=useCallback(async()=>{
    const sequence=++listSequence.current;
    setLoading(true);
    try{
      const result=await call<{reviews:Review[];hasMore:boolean}>("/reviews?"+new URLSearchParams({page:String(page),q:search,status}));
      if(sequence===listSequence.current){setRows(result.reviews);setHasMore(result.hasMore);}
    }catch(e){if(sequence===listSequence.current)setError(e instanceof Error?e.message:"Não foi possível carregar as aprovações.");}
    finally{if(sequence===listSequence.current)setLoading(false);}
  },[call,page,refresh,search,status]);
  useEffect(()=>{void loadList();},[loadList]);
  useEffect(()=>{if(startProjectId){setProjectId(startProjectId);setClientId(startClientId||projects.find(p=>p.id===startProjectId)?.clientId||0);setComposer(true);}},
    [startProjectId,startClientId,projects]);
  useEffect(()=>{if(startClientId&&!startProjectId){setClientId(startClientId);setComposer(true);}},[startClientId,startProjectId]);
  const relevantProjects=useMemo(()=>clientId?projects.filter(p=>p.clientId===clientId):projects,[clientId,projects]);
  useEffect(()=>{
    browseSequence.current++;searchSequence.current++;setFileSearch("");setRemote(null);setSearchBusy(false);
    setSelectedFolder(null);setItems([]);setTrail([]);setNextToken(null);setFolderBusy(false);
    if(!user||!projectId||!composer){setLinks([]);return;}
    let alive=true;
    readDriveLinks(user.uid).then(result=>{
      if(alive)setLinks(result.filter(l=>l.projectId===projectId));
    }).catch(()=>{if(alive)setFolderError("Não foi possível ler as pastas vinculadas.");});
    return()=>{alive=false;};
  },[user,projectId,composer]);
  const browse=useCallback(async(folder:DriveFolderLink,targetId:string,path:{id:string;name:string}[],append=false,pageKey?:string)=>{
    const sequence=++browseSequence.current;
    setFolderBusy(true);setFolderError("");
    if(!append){++searchSequence.current;setFileSearch("");setRemote(null);setSearchBusy(false);setItems([]);setNextToken(null);setTrail(path);}
    try{
      const params=pageKey?"?pageToken="+encodeURIComponent(pageKey):"";
      const response=await call<{files:DriveItem[];nextPageToken:string|null}>(
        "/integrations/drive/"+encodeURIComponent(folder.connectionId)+"/folders/"+encodeURIComponent(targetId)+"/items"+params);
      if(sequence!==browseSequence.current)return;
      setItems(old=>append?[...old,...response.files.filter(f=>!old.some(o=>o.id===f.id))]:response.files);
      setTrail(path);setNextToken(response.nextPageToken);
    }catch(e){if(sequence===browseSequence.current){setFolderError(e instanceof Error?e.message:"Não foi possível abrir a pasta.");if(!append)setItems([]);}}
    finally{if(sequence===browseSequence.current)setFolderBusy(false);}
  },[call]);
  const pickFolder=(folder:DriveFolderLink)=>{
    setSelectedFolder(folder);setTrail([{id:folder.folderId,name:folder.folderName}]);
    void browse(folder,folder.folderId,[{id:folder.folderId,name:folder.folderName}]);
  };
  const activeFolderId=trail.at(-1)?.id||selectedFolder?.folderId||"";
  useEffect(()=>{
    const seq=++searchSequence.current;
    const term=fileSearch.trim(),folderId=activeFolderId,folder=selectedFolder;
    setRemote(null);setSearchBusy(false);
    if(!user||!folder||!folderId||term.length<2)return;
    const timer=window.setTimeout(async()=>{
      const key=cacheKey(user.uid,folder.connectionId,folderId,term);
      const cached=getCachedFolder(key);
      if(cached){
        if(seq===searchSequence.current)setRemote({term,folderId,files:cached.files,page:cached.nextPageToken});
        if(Date.now()-cached.fetchedAt<30_000)return;
      }
      if(seq===searchSequence.current)setSearchBusy(true);
      try{
        const params=new URLSearchParams({search:term});
        const result=await call<{files:DriveItem[];nextPageToken:string|null}>(
          "/integrations/drive/"+encodeURIComponent(folder.connectionId)+"/folders/"+
          encodeURIComponent(folderId)+"/items?"+params);
        if(seq!==searchSequence.current)return;
        setCachedFolder(key,{files:result.files,nextPageToken:result.nextPageToken});
        setRemote({term,folderId,files:result.files,page:result.nextPageToken});
      }catch(e){if(seq===searchSequence.current)setFolderError(e instanceof Error?e.message:"Falha na busca de arquivos.");}
      finally{if(seq===searchSequence.current)setSearchBusy(false);}
    },300);
    return()=>window.clearTimeout(timer);
  },[fileSearch,activeFolderId,selectedFolder,user?.uid,call]);
  const searchActive=fileSearch.trim().length>=2&&remote?.term===fileSearch.trim()&&remote.folderId===activeFolderId;
  const displayedItems=(searchActive?remote.files:items).filter(item=>
    item.name.toLocaleLowerCase("pt-BR").includes(fileSearch.trim().toLocaleLowerCase("pt-BR")));
  const loadMoreSearch=async()=>{
    if(!selectedFolder||!remote?.page||searchBusy||!searchActive)return;
    const current=remote,seq=searchSequence.current;
    setSearchBusy(true);
    try{
      const params=new URLSearchParams({search:current.term,pageToken:current.page});
      const result=await call<{files:DriveItem[];nextPageToken:string|null}>(
        "/integrations/drive/"+encodeURIComponent(selectedFolder.connectionId)+"/folders/"+
        encodeURIComponent(current.folderId)+"/items?"+params);
      if(seq!==searchSequence.current)return;
      const files=[...current.files,...result.files.filter(item=>!current.files.some(old=>old.id===item.id))];
      setRemote({...current,files,page:result.nextPageToken});
      if(user)setCachedFolder(cacheKey(user.uid,selectedFolder.connectionId,current.folderId,current.term),
        {files,nextPageToken:result.nextPageToken});
    }catch(e){if(seq===searchSequence.current)setFolderError(e instanceof Error?e.message:"Falha ao carregar a busca.");}
    finally{if(seq===searchSequence.current)setSearchBusy(false);}
  };
  const destination:UploadDestination|null=selectedFolder&&projectId?{
    connectionId:selectedFolder.connectionId,linkedFolderId:selectedFolder.folderId,
    targetFolderId:trail.at(-1)?.id||selectedFolder.folderId,
    projectId,folderName:trail.at(-1)?.name||selectedFolder.folderName
  }:null;
  const uploadNew=(chosen:File[])=>{
    if(!destination||!chosen.length)return;
    const valid=chosen.filter(file=>file.type.startsWith("video/")||file.type.startsWith("image/")||
      file.type.startsWith("audio/")||file.type==="application/pdf");
    if(valid.length!==chosen.length){setFolderError("Envie apenas vídeo, imagem, áudio ou PDF.");return;}
    if(valid.length+files.length+pendingUploads.length>8){setFolderError("Selecione no máximo 8 materiais por aprovação, incluindo os envios pendentes.");return;}
    const {rejected}=transfers.enqueue(valid,destination);
    if(rejected)setFolderError(rejected+" arquivo(s) não foram adicionados à fila. Confira os limites do upload.");
  };
  useEffect(()=>transfers.subscribe((file,uploaded)=>{
    if(!composer||uploaded.projectId!==projectId)return;
    if(!/^(video|image|audio)\//.test(file.mimeType)&&file.mimeType!=="application/pdf")return;
    setFiles(old=>old.some(a=>a.fileId===file.id)||old.length>=8?old:
      [...old,{fileId:file.id,name:file.name,mimeType:file.mimeType,
        connectionId:uploaded.connectionId,linkedFolderId:uploaded.linkedFolderId}]);
    const target=trail.at(-1)?.id||selectedFolder?.folderId;
    if(selectedFolder&&uploaded.connectionId===selectedFolder.connectionId&&uploaded.targetFolderId===target)
      void browse(selectedFolder,target,trail);
  }),[transfers.subscribe,composer,selectedFolder,projectId,trail,browse]);
  const resetComposer=()=>{
    if(working)return;
    browseSequence.current++;searchSequence.current++;
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
    if(working||pendingUploads.length){setError("Conclua ou cancele os envios pendentes antes de compartilhar.");return;}
    if(!projectId||!clientId||!files.length) {setError("Escolha o cliente, projeto e pelo menos um arquivo.");return;}
    await run(async()=>{
      let publishWarning="";
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
          publishWarning="Solicitação salva como rascunho, mas o compartilhamento não foi concluído. Abra o registro e tente novamente. "+
            (e instanceof Error?e.message:"");
        }
      }
      setComposer(false);setReplacement(null);setFiles([]);setSelectedFolder(null);setTrail([]);setItems([]);
      if(publishWarning)setError(publishWarning);
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
      old.length+pendingUploads.length>=8?old:[...old,{fileId:file.id,name:file.name,mimeType:file.mimeType,
        connectionId:selectedFolder.connectionId,linkedFolderId:selectedFolder.folderId}]);
  };
  return <div className="reviews-panel">
    <div className="reviews-summary">
      {(["pending","changes","approved"] as const).map(s=><div key={s} className="reviews-stat">
        <span>{statusText[s]} na página</span><strong>{rows.filter(r=>r.status===s).length}</strong>
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

    {opened&&!composer&&createPortal(<div className="review-modal-backdrop" ref={dialogRef} tabIndex={-1} onMouseDown={e=>{if(e.target===e.currentTarget&&!working)setOpened(null);}}>
      <section role="dialog" aria-modal="true" aria-label="Detalhes da revisão" className="review-dialog">
        <header><div><span className="eyebrow">APROVAÇÃO · V{opened.review.version}</span><h2>{opened.review.title}</h2>
          <p>{opened.review.clientName} · {opened.review.projectName}</p></div>
          <button className="review-icon" aria-label="Fechar" disabled={working} onClick={()=>setOpened(null)}><X size={20}/></button>
        </header>
        <div className="review-dialog-body">
          <div className="reviews-detail-bar"><span className={"reviews-status status-"+opened.review.status}>{statusText[opened.review.status]}</span>
            <small>Válido até {fmt(opened.review.expiresAt)}</small></div>
          <h3>Materiais</h3>
          {opened.assets.map(a=><div className="review-asset" key={a.version+":"+a.fileId}>
            <AssetIcon mime={a.mimeType}/><span><strong>{a.name}</strong><small>Versão {a.version} · {a.grantState==="granted"?"Compartilhado":a.grantState==="revoked"?"Acesso revogado":"Não compartilhado"}</small></span>
          </div>)}
          {["pending","changes","approved"].includes(opened.review.status)&&<div className="reviews-link-box">
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
          {opened.review.status==="replacing"&&<button className="primary-button" disabled={working} onClick={()=>void run(async()=>{await call("/reviews/"+opened.review.id+"/revise","POST",{assets:[]});await openDetail(opened.review.id);})}>Concluir troca de versão</button>}
          {opened.review.status==="closing"&&<button className="primary-button" disabled={working} onClick={()=>void mutate("close")}>Concluir revogação</button>}
          {["pending","changes","approved","draft"].includes(opened.review.status)&&<button className="secondary-button" disabled={working} onClick={()=>void mutate("rotate")}>Renovar link</button>}
          {opened.review.status!=="closed"&&<button className="secondary-button" disabled={working} onClick={()=>void mutate("close")}>Encerrar revisão</button>}
        </footer>
      </section>
    </div>,document.body)}

    {composer&&createPortal(<div className="review-modal-backdrop" ref={dialogRef} tabIndex={-1} onMouseDown={e=>{if(e.target===e.currentTarget)resetComposer();}}>
      <section className="review-dialog" role="dialog" aria-modal="true" aria-label="Enviar materiais para aprovação">
        <header><div><span className="eyebrow">APROVAÇÕES / {replacement?"NOVA VERSÃO":"NOVA SOLICITAÇÃO"}</span>
          <h2>{replacement?"Selecione os novos arquivos":"Enviar para aprovação"}</h2>
          <p>Escolha os materiais que o cliente poderá revisar.</p></div>
          <button className="review-icon" disabled={working} onClick={resetComposer} aria-label="Fechar"><X size={20}/></button></header>
        <div className="review-dialog-body">
          {error&&<p className="reviews-warning" role="alert">{error}</p>}
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
            {selectedFolder&&<div className="review-file-tools">
              <label className="review-drive-search"><Search size={16}/>
                <input type="search" aria-label="Buscar arquivos no Google Drive"
                  placeholder="Buscar arquivos nesta pasta" value={fileSearch}
                  onChange={e=>setFileSearch(e.target.value)}/>
                {fileSearch&&<button type="button" aria-label="Limpar busca" onClick={()=>setFileSearch("")}><X size={14}/></button>}
              </label>
              <a className="review-drive-external" target="_blank" rel="noopener noreferrer"
                href={"https://drive.google.com/drive/folders/"+encodeURIComponent(activeFolderId)}>
                <ExternalLink size={15}/> Abrir pasta no Drive</a>
            </div>}
            {destination&&<div className="review-upload-zone"
              onDragOver={event=>{if(Array.from(event.dataTransfer.types).includes("Files"))event.preventDefault();}}
              onDrop={event=>{if(!Array.from(event.dataTransfer.types).includes("Files"))return;
                event.preventDefault();uploadNew(Array.from(event.dataTransfer.files));}}>
              <label className="secondary-button">Adicionar arquivos do dispositivo
                <input type="file" multiple accept="video/*,image/*,audio/*,application/pdf"
                  onChange={event=>{uploadNew(Array.from(event.target.files||[]));event.target.value="";}}/></label>
              <span>Ou arraste arquivos aqui. Envio direto ao seu Google Drive.</span>
            </div>}
            {transfers.authorizationNotice}
            {destination&&transfers.uploads.filter(entry=>
              entry.destination.projectId===projectId&&entry.destination.connectionId===destination.connectionId&&
              ["queued","starting","uploading","verifying"].includes(entry.status)).length>0&&
              <p className="reviews-muted" role="status">O envio está em andamento. Os arquivos serão selecionados automaticamente ao concluir.</p>}
            {pendingUploads.map(entry=><div className="review-pending-upload" key={entry.id}>
              <span>{entry.name} · {Math.floor(100*entry.sent/entry.size)}%</span>
              {entry.error&&<small role="alert">{entry.error}</small>}
              {["queued","starting","uploading","verifying"].includes(entry.status)?
                <button type="button" className="secondary-button" disabled={entry.status==="verifying"} onClick={()=>transfers.cancel(entry.id)}>Cancelar envio</button>:
                <><button type="button" className="secondary-button" disabled={entry.status!=="failed"&&!entry.canVerify&&!entry.canResume}
                  onClick={()=>transfers.retry(entry.id)}>Tentar novamente</button>
                <button type="button" className="secondary-button" onClick={()=>transfers.dismiss(entry.id)}>Remover da aprovação</button></>}
            </div>)}
            {folderError&&<p className="reviews-warning" role="alert">{folderError}</p>}
            <div className="review-files" aria-label="Arquivos disponíveis">
              {folderBusy&&!items.length&&<p role="status"><LoaderCircle size={16} className="rl-spin"/> Carregando arquivos…</p>}
              {searchBusy&&<p className="reviews-muted" role="status"><LoaderCircle size={15} className="rl-spin"/> Buscando arquivos no Google Drive…</p>}
              {!folderBusy&&!searchBusy&&selectedFolder&&!displayedItems.length&&
                <p className="reviews-muted">{fileSearch?"Nenhum arquivo encontrado nesta pasta.":"Esta pasta está vazia."}</p>}
              {displayedItems.map(f=><div className="review-picker-row" key={f.id}>
                {f.mimeType==="application/vnd.google-apps.folder"?
                  <button type="button" className="review-picker-main" onClick={()=>{
                    if(selectedFolder)void browse(selectedFolder,f.id,[...trail,{id:f.id,name:f.name}]);}}>
                    <Folder size={19}/><span className="review-picker-name">{f.name}<small>Subpasta</small></span><ChevronRight size={16}/>
                  </button>:
                  <label className={"review-picker-main"+(!supported(f)?" unsupported":"")}>
                    <input type="checkbox" disabled={!supported(f)} aria-label={"Selecionar "+f.name}
                      checked={files.some(a=>a.fileId===f.id)} onChange={()=>addFile(f)}/>
                    {selectedFolder&&user&&<DriveThumbnail item={f} scope={user.uid+":"+selectedFolder.connectionId}
                      getThumbnail={getThumbnail}/>}
                    <span className="review-picker-name" title={f.name}>{f.name}
                      <small>{supported(f)?readableFileType(f.mimeType):"Formato não aceito para aprovação"}</small></span>
                  </label>}
                <a className="review-picker-external" href={f.mimeType==="application/vnd.google-apps.folder"?
                  "https://drive.google.com/drive/folders/"+encodeURIComponent(f.id):driveFileUrl(f)}
                  target="_blank" rel="noopener noreferrer" aria-label={"Abrir "+f.name+" no Google Drive"}
                  title="Abrir no Google Drive"><ExternalLink size={16}/></a>
              </div>)}
            </div>
            {fileSearch.trim().length===1&&<p className="reviews-muted">Digite mais uma letra para pesquisar em todos os itens da pasta, não apenas os carregados.</p>}
            {(fileSearch.trim().length>=2?(searchActive&&!!remote?.page):!!nextToken)&&selectedFolder&&<button type="button" className="secondary-button"
              disabled={folderBusy||searchBusy} onClick={()=>fileSearch.trim().length>=2?
                void loadMoreSearch():void browse(selectedFolder,activeFolderId,trail,true,nextToken!)}>
              Carregar mais arquivos</button>}
          </>}
          {files.length>0&&<div className="reviews-selected"><h3>Selecionados</h3>
            {files.map(f=><div key={f.fileId}><Check size={14}/><span>{f.name}</span>
              <button onClick={()=>setFiles(x=>x.filter(a=>a.fileId!==f.fileId))} aria-label={"Remover "+f.name}><X size={15}/></button></div>)}</div>}
          <p className="reviews-muted">Os envios usam a mesma fila segura da Biblioteca. Aguarde a confirmação do Google Drive antes de compartilhar.</p>
        </div>
        <footer><button className="secondary-button" onClick={resetComposer}>Cancelar</button>
          <button className="primary-button" disabled={working||pendingUploads.length>0||!files.length||!projectId||!clientId||(!replacement&&!title.trim())||(!replacement&&mode==="google"&&!recipient.includes("@"))}
            onClick={()=>void submit()}>{working?"Preparando…":replacement?"Enviar nova versão":"Gerar aprovação"} <Send size={16}/></button></footer>
      </section>
    </div>,document.body)}
  </div>;
}
