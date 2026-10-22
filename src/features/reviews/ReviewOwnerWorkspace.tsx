import {useEffect,useMemo,useRef,useState} from "react";
import {CheckCircle2,ChevronRight,Clock3,Copy,ExternalLink,FileAudio,FileImage,FileText,
  FileVideo,FolderOpen,Grid2X2,History,Link2,List,LoaderCircle,MessageSquare,RotateCcw,Search,Send,ShieldCheck,X} from "lucide-react";
import {formatReviewTime} from "./review-timecode";
import {useDriveApi} from "../drive/drive-api";
import {DriveThumbnail} from "../drive/DriveThumbnail";
import {useDriveThumbnailFetch} from "../drive/useDriveThumbnailFetch";
import {useAuth} from "../auth/AuthProvider";
import {fmt,statusText,type Asset,type Comment,type Detail} from "./review-model";
import "./review-owner-workspace.css";

function Glyph({mime}:{mime:string}){
  if(mime.startsWith("video/"))return <FileVideo size={19}/>;
  if(mime.startsWith("image/"))return <FileImage size={19}/>;
  if(mime.startsWith("audio/"))return <FileAudio size={19}/>;
  return <FileText size={19}/>;
}
const driveUrl=(id:string)=>"https://drive.google.com/file/d/"+encodeURIComponent(id)+"/view";
const previewUrl=(id:string)=>"https://drive.google.com/file/d/"+encodeURIComponent(id)+"/preview";
const longDate=(time:number)=>new Date(time).toLocaleString("pt-BR",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"});
function InfoEmpty({text}:{text:string}){return <p className="rowner-empty">{text}</p>;}
function ShareArea({detail}:{detail:Detail}){
  const {title,url="",expiresAt}=detail.review;
  const [copied,setCopied]=useState(false);
  useEffect(()=>setCopied(false),[url]);
  const content="Olá! Seu material está disponível para revisão: "+title+"\n"+url;
  return <section className="rowner-share" aria-label="Compartilhar aprovação">
    <div className="rowner-share-heading">
      <div><Link2 size={17}/><strong>Link do cliente</strong></div>
      <small>Válido até {fmt(expiresAt)}</small>
    </div>
    <div className="rowner-share-controls">
      <input type="text" readOnly aria-label="Link da revisão" value={url} onFocus={e=>e.currentTarget.select()}/>
      <button className="rowner-share-copy" disabled={!url} onClick={async()=>{
        try{await navigator.clipboard.writeText(url);setCopied(true);}
        catch{window.prompt("Copie o link:",url);}
      }}><Copy size={15}/>{copied?"Copiado!":"Copiar link"}</button>
      <a href={"https://wa.me/?text="+encodeURIComponent(content)} target="_blank" rel="noopener noreferrer"
        aria-label="Compartilhar aprovação por WhatsApp">WhatsApp <ExternalLink size={14}/></a>
      <a href={"mailto:?subject="+encodeURIComponent("Material para aprovação · "+title)+"&body="+encodeURIComponent(content)}
        aria-label="Enviar aprovação por e-mail">E-mail <Send size={14}/></a>
    </div>
    <details className="rowner-share-help"><summary>Como funciona o acesso?</summary>
      <p>O link permite abrir os arquivos desta revisão. Permissões preexistentes no Google Drive continuam sob controle do proprietário, mesmo após encerrar a revisão.</p>
    </details>
  </section>;
}
function CommentCard({comment,asset,selected,onSelect}:{comment:Comment;asset:Asset|null;selected:boolean;onSelect:()=>void}){
  return <article className={"rowner-comment"+(selected?" is-selected":"")} data-comment-id={comment.id}>
    <div className="rowner-comment-header"><span className="rowner-avatar" aria-hidden="true">{comment.author_name.trim().slice(0,1).toUpperCase()||"C"}</span>
      <div className="rowner-comment-by"><strong>{comment.author_name}</strong><small>{longDate(comment.created_at)}</small></div></div>
    <p>{comment.body}</p>
    {asset&&<button type="button" className="rowner-comment-file" onClick={onSelect}
      aria-label={"Ver material "+asset.name+(comment.seconds!==null?" no minuto "+formatReviewTime(comment.seconds):"")}>
      <Glyph mime={asset.mimeType}/><span title={asset.name}>{asset.name}</span>
      {comment.seconds!==null&&<span className="rowner-timestamp"><Clock3 size={12}/>{formatReviewTime(comment.seconds)}</span>}
      <ChevronRight size={14}/>
    </button>}
  </article>;
}
export function ReviewOwnerWorkspace({detail,working,error,onClose,onRevise,onPublish,onRotate,onEnd,onResume,onCompleteClose}:{
  detail:Detail;working:boolean;error?:string;onClose:()=>void;onRevise:()=>void;onPublish:()=>void;
  onRotate:()=>void;onEnd:()=>void;onResume:(withFiles:boolean)=>void;onCompleteClose:()=>void
}){
  const {review,assets,comments,decisions}=detail;
  const driveCall=useDriveApi();
  const getThumbnail=useDriveThumbnailFetch();
  const {user}=useAuth();
  const [fileSearch,setFileSearch]=useState("");
  const [typeFilter,setTypeFilter]=useState<"all"|"video"|"image"|"audio"|"pdf">("all");
  const [galleryView,setGalleryView]=useState<"grid"|"list">("grid");
  const [visibleLimit,setVisibleLimit]=useState(6);
  // Resolve the actual immediate parent lazily. Historical approvals need no
  // migration: their owner-only detail already contains the linked project folder.
  const [parentFolders,setParentFolders]=useState<Record<string,string|null>>({});
  const currentAssets=useMemo(()=>assets.filter(a=>a.version===review.version),[assets,review.version]);
  const currentComments=useMemo(()=>comments.filter(c=>c.version===review.version),[comments,review.version]);
  const priorComments=comments.filter(c=>c.version<review.version);
  const oldVersions=[...new Set([...assets.map(a=>a.version),...comments.map(c=>c.version),...decisions.map(d=>d.version)].filter(v=>v<review.version))].sort((a,b)=>b-a);
  const latestDecision=useMemo(()=>[...decisions].filter(d=>d.version===review.version).sort((a,b)=>b.created_at-a.created_at)[0], [decisions,review.version]);
  const featuredId=currentAssets.find(a=>currentComments.some(c=>c.file_id===a.fileId))?.fileId||currentAssets[0]?.fileId;
  const [selectedFile,setSelectedFile]=useState<string|undefined>(featuredId);
  const [feedbackAll,setFeedbackAll]=useState(true);
  const [notice,setNotice]=useState("");
  const mediaRef=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    setSelectedFile(featuredId);setNotice("");setFeedbackAll(true);
    setFileSearch("");setTypeFilter("all");setVisibleLimit(6);
  },[review.id,review.version,featuredId]);
  const active=currentAssets.find(a=>a.fileId===selectedFile)||currentAssets[0];
  const parentKey=active?.connectionId&&active.fileId
    ?active.connectionId+":"+active.fileId:"";
  useEffect(()=>{
    if(!active?.connectionId||!parentKey||Object.prototype.hasOwnProperty.call(parentFolders,parentKey))return;
    let mounted=true;
    void driveCall<{file?:{parents?:string[]}}>(
      "/integrations/drive/"+encodeURIComponent(active.connectionId)+
      "/metadata?fileId="+encodeURIComponent(active.fileId)
    ).then(response=>{
      if(!mounted)return;
      const parent=response.file?.parents?.[0];
      setParentFolders(previous=>({...previous,[parentKey]:
        typeof parent==="string"&&/^[A-Za-z0-9_-]{1,200}$/.test(parent)?parent:null}));
    }).catch(()=>{
      if(mounted)setParentFolders(previous=>({...previous,[parentKey]:null}));
    });
    return()=>{mounted=false;};
  },[active?.connectionId,active?.fileId,driveCall,parentKey,parentFolders]);
  const exactParent=parentKey?parentFolders[parentKey]:undefined;
  const folderId=exactParent||active?.linkedFolderId;
  const displayedComments=feedbackAll?currentComments:currentComments.filter(c=>c.file_id===active?.fileId);
  const fileCounts=useMemo(()=>{
    const counts=new Map<string,number>();
    for(const comment of currentComments)counts.set(comment.file_id,(counts.get(comment.file_id)||0)+1);
    return counts;
  },[currentComments]);
  const fileKind=(mime:string):"video"|"image"|"audio"|"pdf"=>
    mime.startsWith("video/")?"video":mime.startsWith("image/")?"image":
    mime.startsWith("audio/")?"audio":"pdf";
  const fileKindLabel=(mime:string)=>({video:"Vídeo",image:"Imagem",audio:"Áudio",pdf:"PDF"})[fileKind(mime)];
  const filteredAssets=useMemo(()=>currentAssets.filter(asset=>
    (typeFilter==="all"||fileKind(asset.mimeType)===typeFilter)&&
    asset.name.toLocaleLowerCase("pt-BR").includes(fileSearch.trim().toLocaleLowerCase("pt-BR"))
  ),[currentAssets,fileSearch,typeFilter]);
  const visibleAssets=filteredAssets.slice(0,visibleLimit);
  const remainingAssets=filteredAssets.length-visibleAssets.length;
  const blocked=review.status==="closed";
  const previewable=active&&active.grantState==="granted"&&!blocked;
  const showMaterials=review.status!=="draft"||currentAssets.length>0;
  function focusMaterial(comment:Comment){
    setSelectedFile(comment.file_id);
    setFileSearch("");setTypeFilter("all");
    setVisibleLimit(Math.max(6,currentAssets.findIndex(a=>a.fileId===comment.file_id)+1));
    setNotice(comment.seconds!==null?
      "Comentário no instante "+formatReviewTime(comment.seconds)+". A prévia do Drive não permite avançar automaticamente para esse segundo; use os controles do vídeo.":"Material selecionado na prévia.");
    mediaRef.current?.scrollIntoView({behavior:"smooth",block:"nearest"});
  }
  return <>
    <header className="rowner-header">
      <div className="rowner-heading">
        <span className="eyebrow">APROVAÇÕES / {review.clientName} / V{review.version}</span>
        <h2>{review.title}</h2>
        <p>{review.projectName} <span aria-hidden="true">·</span> {review.clientName}</p>
      </div>
      <button type="button" className="review-icon" disabled={working} aria-label="Fechar" onClick={onClose}><X size={20}/></button>
    </header>
    <div className="review-dialog-body rowner-body">
      {error&&<div className="reviews-warning" role="alert">{error}</div>}
      {["pending","changes","approved"].includes(review.status)&&<ShareArea detail={detail}/>}
      <section className="rowner-overview" aria-label="Situação da aprovação">
        <div className="rowner-overview-top">
          <div className="rowner-overview-intro"><span className={"reviews-status status-"+review.status}>{statusText[review.status]}</span>
            <h3>{review.status==="changes"?"O cliente pediu alterações":review.status==="approved"?"Materiais aprovados":review.status==="pending"?"Aguardando a avaliação do cliente":"Acompanhe a revisão"}</h3>
            <p>{review.status==="changes"?"Confira o feedback abaixo e prepare a próxima versão.":review.status==="pending"?"Os arquivos estão disponíveis; veja os comentários e acompanhe a resposta.":review.status==="approved"?"O cliente concluiu esta versão. O histórico permanece disponível.":"Todas as versões e comentários estão organizados abaixo."}</p>
          </div>

        </div>
        {latestDecision&&<div className={"rowner-latest-decision "+(latestDecision.decision==="changes"?"is-changes":"is-approved")}>
          {latestDecision.decision==="changes"?<MessageSquare size={18}/>:<CheckCircle2 size={18}/>}
          <div><strong>{latestDecision.decision==="changes"?"Pedido de ajustes":"Material aprovado"} · V{latestDecision.version}</strong>
            <p>{latestDecision.message||"Sem observações adicionais."}</p>
            <small>{latestDecision.author_name} · {longDate(latestDecision.created_at)}</small>
          </div>
        </div>}
        <div className="rowner-metrics">
          <span><FileImage size={15}/> <strong>{currentAssets.length}</strong> {currentAssets.length===1?"material":"materiais"} na V{review.version}</span>
          <span><MessageSquare size={15}/> <strong>{currentComments.length}</strong> {currentComments.length===1?"comentário":"comentários"} na V{review.version}</span>
          <span><History size={15}/> <strong>{oldVersions.length+1}</strong> {oldVersions.length===0?"versão":"versões"} no histórico</span>
        </div>
      </section>
      {review.mode==="google"&&detail.participants&&detail.participants.length>0&&
        <section className="rowner-participants" aria-label="Participantes autorizados">
          <h3>Participantes autorizados</h3>
          <p>{review.driveShareEnabled
            ?"O acesso direto ao Drive utiliza permissões já existentes em arquivos públicos ou concede leitura individual quando necessário e autorizado."
            :"Acesso restrito ao portal Roteiva. Nenhuma permissão adicional foi criada no Google Drive."}</p>
          <p>{detail.participants.filter(p=>p.role==="reviewer"&&detail.votes?.some(v=>v.email===p.email&&v.version===review.version&&v.decision==="approved")).length}
            {" de "}{detail.participants.filter(p=>p.role==="reviewer").length} revisores aprovaram esta versão.</p>
          <div>{detail.participants.map(participant=>{
            const vote=detail.votes?.find(v=>v.email===participant.email&&v.version===review.version);
            return <span className="rowner-participant" key={participant.email}>
              <strong>{participant.email}</strong>
              <small>{participant.role==="viewer"?"Leitor · somente leitura":
                vote?.decision==="approved"?"Revisor · aprovou":
                vote?.decision==="changes"?"Revisor · solicitou ajustes":
                "Revisor · aguardando resposta"}</small>
            </span>;
          })}</div>
        </section>}
      {showMaterials&&<div className="rowner-workspace">
        <section className="rowner-materials" aria-label="Materiais da versão atual">
          <div className="rowner-section-label"><div><h3>Materiais · V{review.version}</h3><small>Selecione para visualizar</small></div></div>
          <div className="rowner-gallery-toolbar">
            <span className="rowner-gallery-count">{currentAssets.length} {currentAssets.length===1?"arquivo":"arquivos"}</span>
            <div className="rowner-gallery-layout" role="group" aria-label="Visualização dos materiais">
              <button type="button" aria-label="Ver materiais em grade" aria-pressed={galleryView==="grid"}
                onClick={()=>setGalleryView("grid")}><Grid2X2 size={16}/></button>
              <button type="button" aria-label="Ver materiais em lista" aria-pressed={galleryView==="list"}
                onClick={()=>setGalleryView("list")}><List size={17}/></button>
            </div>
          </div>
          {currentAssets.length>=5&&<div className="rowner-gallery-filters">
            <label className="rowner-gallery-search">
              <Search size={16} aria-hidden="true"/>
              <input aria-label="Buscar materiais por nome" type="search" placeholder="Buscar arquivo…"
                value={fileSearch} onChange={e=>{setFileSearch(e.target.value);setVisibleLimit(6);}}/>
            </label>
            <select aria-label="Filtrar materiais por tipo" value={typeFilter}
              onChange={e=>{setTypeFilter(e.target.value as typeof typeFilter);setVisibleLimit(6);}}>
              <option value="all">Todos os tipos</option>
              <option value="video">Vídeos</option><option value="image">Imagens</option>
              <option value="audio">Áudios</option><option value="pdf">PDFs</option>
            </select>
          </div>}
          <div className="rowner-file-list" data-view={galleryView} aria-label="Galeria de materiais">
            {visibleAssets.map(a=><button type="button" key={a.fileId}
              className={"rowner-file"+(active?.fileId===a.fileId?" is-active":"")}
              aria-pressed={active?.fileId===a.fileId} aria-label={"Selecionar arquivo "+a.name}
              title={a.name} onClick={()=>{setSelectedFile(a.fileId);setNotice("");}}>
              <span className="rowner-file-art">
                {user&&a.connectionId?<DriveThumbnail
                  item={{id:a.fileId,name:a.name,mimeType:a.mimeType,
                    thumbnailFallback:a.grantState==="granted"&&review.status!=="closed"}}
                  scope={user.uid+":"+a.connectionId} getThumbnail={getThumbnail}/>:
                  <span className="rowner-file-fallback"><Glyph mime={a.mimeType}/></span>}
                {active?.fileId===a.fileId&&<span className="rowner-file-selected" aria-hidden="true"><CheckCircle2 size={19} fill="currentColor"/></span>}
                {!!fileCounts.get(a.fileId)&&<span className="rowner-file-count"
                  aria-label={fileCounts.get(a.fileId)+" comentários"}><MessageSquare size={12}/>{fileCounts.get(a.fileId)}</span>}
              </span>
              <span className="rowner-file-name"><strong>{a.name}</strong>
                <small>{fileKindLabel(a.mimeType)}</small>
              </span>
            </button>)}
          </div>
          {!filteredAssets.length&&<p className="rowner-gallery-empty">Nenhum arquivo corresponde aos filtros.
            <button type="button" onClick={()=>{setFileSearch("");setTypeFilter("all");setVisibleLimit(6);}}>Limpar filtros</button>
          </p>}
          {remainingAssets>0&&<button type="button" className="rowner-gallery-more"
            onClick={()=>setVisibleLimit(v=>v+6)}>Mostrar mais {Math.min(6,remainingAssets)} de {remainingAssets} arquivos <ChevronRight size={15}/></button>}
          {currentAssets.length>=5&&<p className="rowner-gallery-summary">
            Exibindo {visibleAssets.length} de {filteredAssets.length} {filteredAssets.length===1?"resultado":"resultados"}
          </p>}
          <div className="rowner-preview" ref={mediaRef}>
            <div className="rowner-preview-head"><strong title={active?.name}>{active?.name||"Selecione um material"}</strong>
              <div className="rowner-preview-actions">
                {active&&folderId&&<a href={"https://drive.google.com/drive/folders/"+encodeURIComponent(folderId)}
                  target="_blank" rel="noopener noreferrer"
                  aria-label={exactParent?"Abrir pasta do arquivo no Google Drive":"Abrir pasta vinculada ao projeto no Google Drive"}
                  title={exactParent?"Pasta onde o arquivo está salvo":"Pasta vinculada ao projeto"}>
                  <FolderOpen size={15}/> {exactParent?"Abrir pasta":"Pasta do projeto"}
                </a>}
                {active&&<a href={driveUrl(active.fileId)} target="_blank" rel="noopener noreferrer"
                  aria-label={"Abrir "+active.name+" no Google Drive"}><ExternalLink size={14}/> Abrir arquivo</a>}
              </div></div>
            <div className="rowner-preview-stage">
              {previewable?<iframe key={active.fileId} title={"Prévia de "+active.name}
                src={previewUrl(active.fileId)} loading="lazy" referrerPolicy="no-referrer"
                allow="fullscreen" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-presentation"/>:
                <div className="rowner-preview-empty"><ShieldCheck size={24}/><p>{blocked?"Revisão encerrada.":active?.grantState==="revoked"?"O compartilhamento deste material foi encerrado.":"Prévia indisponível até o compartilhamento ser concluído."}</p></div>}
            </div>
            {notice&&<p className="rowner-preview-notice" role="status">{notice}</p>}
          </div>
        </section>
        <section className="rowner-feedback" aria-label="Feedback do cliente">
          <div className="rowner-section-label"><div><h3>Comentários · V{review.version}</h3>
            <small>{currentComments.length? "Comentários dos materiais enviados":"Aguardando observações do cliente"}</small></div>
            <span className="rowner-comment-total">{currentComments.length}</span></div>
          {currentAssets.length>1&&currentComments.length>0&&<div className="rowner-feedback-filter" role="group" aria-label="Filtrar comentários">
            <button type="button" className={feedbackAll?"is-active":""} aria-pressed={feedbackAll}
              onClick={()=>setFeedbackAll(true)}>Todos ({currentComments.length})</button>
            <button type="button" className={!feedbackAll?"is-active":""} aria-pressed={!feedbackAll}
              onClick={()=>setFeedbackAll(false)}>Arquivo selecionado ({fileCounts.get(active?.fileId||"")||0})</button></div>}
          <div className="rowner-comment-list">
            {displayedComments.length?displayedComments.map(c=><CommentCard key={c.id} comment={c} selected={active?.fileId===c.file_id}
              asset={currentAssets.find(a=>a.fileId===c.file_id)||null} onSelect={()=>focusMaterial(c)}/>):
              <InfoEmpty text={feedbackAll?"Nenhum comentário nesta versão. Quando o cliente comentar, você verá o arquivo e o instante aqui.":"Este arquivo ainda não tem comentários. Use Todos para ver observações dos outros materiais."}/>}
          </div>
        </section>
      </div>}
      {(oldVersions.length>0||decisions.length>1||priorComments.length>0)&&<details className="rowner-history">
        <summary><span><History size={18}/> Histórico das versões anteriores</span>
          <small>{oldVersions.length} versões · {priorComments.length} comentários anteriores</small></summary>
        <div className="rowner-history-inner">
          {oldVersions.map(v=>{
            const oldAssets=assets.filter(a=>a.version===v),oldComments=priorComments.filter(c=>c.version===v);
            const decision=decisions.find(d=>d.version===v);
            return <section key={v} className="rowner-history-version">
              <div className="rowner-history-title"><strong>Versão {v}</strong><span>{decision?.decision==="changes"?"Ajustes solicitados":decision?.decision==="approved"?"Aprovada":"Sem decisão"}</span></div>
              {decision&&<div className="rowner-history-decision"><p>{decision.message||"Sem observações adicionais."}</p><small>{decision.author_name} · {longDate(decision.created_at)}</small></div>}
              <p className="rowner-history-files">{oldAssets.map(a=>a.name).join(" · ")}</p>
              {oldComments.map(c=><div className="rowner-history-comment" key={c.id}>
                <strong>{c.author_name}{c.seconds!==null?" · "+formatReviewTime(c.seconds):""}</strong>
                <small>{oldAssets.find(a=>a.fileId===c.file_id)?.name||"Arquivo"} · {longDate(c.created_at)}</small>
                <p>{c.body}</p></div>)}
            </section>;
          })}
        </div>
      </details>}
    </div>
    <footer className="rowner-footer">
      <span className="rowner-footer-state">{working?<LoaderCircle size={15} className="rl-spin"/>:<ShieldCheck size={15}/>}
        {working?"Atualizando…":statusText[review.status]}</span>
      <div className="rowner-footer-actions">
        {["draft","publishing"].includes(review.status)&&<button className="primary-button" disabled={working} onClick={onPublish}>Ativar compartilhamento</button>}
        {review.status==="changes"&&<button className="primary-button" disabled={working} onClick={onRevise}>Enviar nova versão <Send size={15}/></button>}
        {review.status==="replacing"&&<button className="primary-button" disabled={working}
          onClick={()=>onResume(!assets.some(a=>a.version===review.version+1))}>
          {assets.some(a=>a.version===review.version+1)?"Concluir troca de versão":"Retomar seleção de arquivos"}</button>}
        {review.status==="closing"&&<button className="primary-button" disabled={working} onClick={onCompleteClose}>Concluir revogação</button>}
        {["pending","changes","approved","draft"].includes(review.status)&&<button className="secondary-button" disabled={working} onClick={onRotate}><RotateCcw size={14}/> Renovar link</button>}
        {review.status!=="closed"&&<button className="secondary-button rowner-end" disabled={working} onClick={onEnd}>Encerrar revisão</button>}
      </div>
    </footer>
  </>;
}
