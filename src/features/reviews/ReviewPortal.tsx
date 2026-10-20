import {useCallback,useEffect,useRef,useState} from "react";
import {ArrowLeft,CheckCircle2,ChevronLeft,ChevronRight,ExternalLink,FileAudio,FileImage,FileText,FileVideo,LoaderCircle,MessageSquare,Send,ShieldCheck,X} from "lucide-react";
import {useAuth} from "../auth/AuthProvider";
import {useOverlayFocus} from "../drive/DriveLibraryUI";
import "../reviews/reviews.css";

type Review={title:string;message:string;studioName:string;clientName:string;projectName:string;status:string;
  version:number;expiresAt:number;mode:"link"|"google"};
type Asset={fileId:string;name:string;mimeType:string};
type Comment={id:string;file_id:string;author_name:string;body:string;seconds:number|null;created_at:number};
type Decision={version:number;decision:string;author_name:string;message:string;created_at:number};
type PublicData={review:Review;assets:Asset[];comments:Comment[];decisions:Decision[]};
const API="https://roteiva-api-dev.ewertonmendes9.workers.dev";
const messages:Record<string,string>={
  review_not_found:"Este link não existe mais ou foi revogado.",
  review_expired:"O prazo de acesso a este material terminou. Solicite um novo link ao profissional.",
  review_not_ready:"Este material ainda não está disponível para revisão.",
  review_recipient_denied:"Este link foi reservado para outra conta Google.",
  review_already_decided:"A decisão desta versão já foi registrada.",
  review_invalid_input:"Revise os dados preenchidos e tente novamente.",
  review_version_changed:"Uma nova versão está disponível. Atualize a página e revise o material antes de responder.",
  rate_limited:"Muitas tentativas. Tente novamente em instantes."
};
const time=(secs:number|null)=>secs===null?"":Math.floor(secs/60)+":"+String(secs%60).padStart(2,"0");
function reviewFileURL(id:string){
  return "https://drive.google.com/file/d/"+encodeURIComponent(id)+"/view";
}
function previewURL(id:string){
  return "https://drive.google.com/file/d/"+encodeURIComponent(id)+"/preview";
}
function FileGlyph({mime}:{mime:string}){
  if(mime.startsWith("video/"))return <FileVideo size={17}/>;
  if(mime.startsWith("image/"))return <FileImage size={17}/>;
  if(mime.startsWith("audio/"))return <FileAudio size={17}/>;
  return <FileText size={17}/>;
}
export function ReviewPortal({token}:{token:string}){
  const {user,loading:authLoading,busy:authBusy,login,error:authError}=useAuth();
  const [data,setData]=useState<PublicData|null>(null),[loading,setLoading]=useState(true);
  const [error,setError]=useState(""),[needsGoogle,setNeedsGoogle]=useState(false);
  const [selected,setSelected]=useState(0),[name,setName]=useState(""),[body,setBody]=useState("");
  const [minutes,setMinutes]=useState(""),[busy,setBusy]=useState(false),[decision,setDecision]=useState<"approved"|"changes"|null>(null);
  const [decisionText,setDecisionText]=useState(""),[notice,setNotice]=useState("");
  const loadedVersion=useRef(0);
  const dialogRef=useOverlayFocus(()=>{if(!busy)setDecision(null);},!!decision);
  const request=useCallback(async<T,>(path:string,method:"GET"|"POST"="GET",payload?:unknown):Promise<T>=>{
    const auth=user?await user.getIdToken():null;
    const response=await fetch(API+path,{
      method,cache:"no-store",referrerPolicy:"no-referrer",
      headers:{"X-Review-Token":token,...(auth?{"Authorization":"Bearer "+auth}:{}),...(payload?{"Content-Type":"application/json"}:{})},
      ...(payload?{body:JSON.stringify(payload)}:{})
    }).catch(()=>{throw new Error("Sem conexão com o serviço. Verifique sua internet e tente novamente.");});
    if(!response.ok){
      const json=await response.json().catch(()=>({})) as {error?:{code?:string}};
      const code=json.error?.code||"review_unavailable";
      throw Object.assign(new Error(messages[code]||"Não foi possível carregar este material. Tente novamente."),{code,status:response.status});
    }
    return response.json() as Promise<T>;
  },[user,token]);
  const reload=useCallback(async()=>{
    setLoading(true);setError("");setData(null);setNeedsGoogle(false);
    try{
      const value=await request<PublicData>("/reviews/public");
      const versionChanged=loadedVersion.current!==value.review.version;
      setData(value);setSelected(current=>versionChanged?0:Math.max(0,Math.min(current,value.assets.length-1)));
      loadedVersion.current=value.review.version;setNeedsGoogle(false);
    }catch(e){
      const status=(e as {status?:number}).status;
      if(status===401||((e as {code?:string}).code==="review_recipient_denied")){
        setNeedsGoogle(true);
        setError(e instanceof Error&&status!==401?e.message:"Entre com a conta Google autorizada para visualizar.");
      }else setError(e instanceof Error?e.message:"Não foi possível carregar.");
    }finally{setLoading(false);}
  },[request]);
  useEffect(()=>{if(!authLoading)void reload();},[authLoading,reload]);
  useEffect(()=>{
    const meta=document.createElement("meta");meta.name="robots";meta.content="noindex, nofollow, noarchive";document.head.appendChild(meta);
    return()=>{meta.remove();};
  },[]);
  useEffect(()=>{if(user?.displayName&&!name)setName(user.displayName);},[user?.displayName,name]);
  const active=data?.assets[selected];
  const seconds=minutes.trim()?(()=>{
    const match=/^(\d{1,4}):([0-5]\d)$/.exec(minutes.trim());
    return match?Number(match[1])*60+Number(match[2]):NaN;
  })():null;
  const action=async(kind:"comment"|"decide",status?:"approved"|"changes")=>{
    if(!name.trim()){setNotice("Informe seu nome antes de continuar.");return;}
    if(kind==="comment"&&!body.trim()){setNotice("Escreva sua observação.");return;}
    if(kind==="comment"&&seconds!==null&&(!Number.isInteger(seconds)||seconds>172800)){
      setNotice("Informe um tempo no formato mm:ss.");return;
    }
    if(kind==="decide"&&status==="changes"&&!decisionText.trim()){setNotice("Explique quais ajustes são necessários.");return;}
    setBusy(true);setNotice("");
    try{
      await request(kind==="comment"?"/reviews/public/comment":"/reviews/public/decide","POST",
        kind==="comment"?{version:data?.review.version,authorName:name.trim(),fileId:active?.fileId,body:body.trim(),seconds}:
          {version:data?.review.version,authorName:name.trim(),decision:status,message:decisionText.trim()});
      if(kind==="comment"){setBody("");setMinutes("");setNotice("Comentário registrado.");}
      else{setDecision(null);setDecisionText("");setNotice(status==="approved"?"Material aprovado com sucesso.":"Solicitação de ajustes registrada.");}
      await reload();
    }catch(e){setNotice(e instanceof Error?e.message:"Não foi possível registrar sua resposta.");}
    finally{setBusy(false);}
  };
  return <main className="review-portal">
    <header className="review-portal-header"><a href="/" aria-label="Ir para Roteiva"><img src="/roteiva-logo-black.png" alt="Roteiva"/></a>
      <span><ShieldCheck size={16}/> Espaço de aprovação</span></header>
    <div className="review-portal-content">
      {loading?<div className="review-portal-state" role="status"><LoaderCircle className="rl-spin" size={26}/>Carregando material…</div>:
      !data?<section className="review-portal-state">
        <ShieldCheck size={30}/><h1>{needsGoogle?"Acesso restrito":"Material indisponível"}</h1>
        <p>{error}</p>
        {needsGoogle&&<><button className="primary-button" disabled={authBusy} onClick={()=>void login()}>
          {user?"Trocar conta Google":"Entrar com Google"}</button>
          {authError&&<p role="alert">{authError}</p>}
          {user&&<small>Conta atual: {user.email}</small>}</>}
        <button className="secondary-button" onClick={()=>void reload()}>Tentar novamente</button>
      </section>:
      <>
        <div className="review-portal-intro">
          <span className="eyebrow">{data.review.studioName} · REVISÃO DE MATERIAL</span>
          <h1>{data.review.title}</h1>
          <p>{data.review.message||"Seu material está pronto para revisão. Confira os arquivos e deixe seu feedback."}</p>
          <div className="review-portal-meta"><span>Versão {data.review.version}</span><span>·</span>
            <span>{data.assets.length} {data.assets.length===1?"arquivo":"arquivos"}</span>
            <span>·</span><span>Disponível até {new Date(data.review.expiresAt).toLocaleDateString("pt-BR")}</span>
          </div>
        </div>
        <section className="review-portal-review" aria-label="Material para avaliar">
          <div className="review-portal-stage">
            {active&&<iframe key={active.fileId} title={"Prévia de "+active.name} src={previewURL(active.fileId)}
              referrerPolicy="no-referrer" allow="fullscreen" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-presentation"/>}
            {!active&&<p>Nenhum material disponível.</p>}
          </div>
          <div className="review-portal-stage-footer">
            <div><strong>{active?.name}</strong><small>Visualização fornecida pelo Google Drive</small></div>
            {active&&<a href={reviewFileURL(active.fileId)} target="_blank" rel="noreferrer"><ExternalLink size={16}/> Abrir no Drive</a>}
          </div>
        </section>
        {data.assets.length>1&&<nav className="review-portal-assets" aria-label="Arquivos da aprovação">
          {data.assets.map((a,i)=><button type="button" key={a.fileId} aria-current={i===selected} onClick={()=>setSelected(i)}>
            <FileGlyph mime={a.mimeType}/><span>{a.name}</span></button>)}
        </nav>}
        <p className="review-portal-hint">Se a prévia não carregar, escolha <strong>Abrir no Drive</strong>. Dependendo do formato ou das permissões Google, a visualização integrada pode não estar disponível.</p>
        <section className="review-portal-comments" aria-label="Comentários">
          <h2><MessageSquare size={19}/> Comentários</h2>
          {data.comments.filter(c=>c.file_id===active?.fileId).map(c=><article className="review-portal-comment" key={c.id}>
            <strong>{c.author_name}{c.seconds!==null?" · "+time(c.seconds):""}</strong>
            <small>{new Date(c.created_at).toLocaleString("pt-BR")}</small><p>{c.body}</p>
          </article>)}
          {!data.comments.filter(c=>c.file_id===active?.fileId).length&&<p className="reviews-muted">Ainda não há comentários neste arquivo.</p>}
          {data.review.status==="pending"&&<div className="review-portal-commentform">
            <label>Seu nome<input maxLength={100} value={name} placeholder="Como podemos chamar você?" onChange={e=>setName(e.target.value)}/></label>
            <label>Comentário<textarea maxLength={1500} rows={3} value={body} placeholder="O que você gostaria de comentar?" onChange={e=>setBody(e.target.value)}/></label>
            <label>Minuto do vídeo (opcional)<input value={minutes} placeholder="Ex.: 01:25" onChange={e=>setMinutes(e.target.value)} inputMode="text"/></label>
            <button className="secondary-button" disabled={busy} onClick={()=>void action("comment")}><Send size={15}/> Adicionar comentário</button>
          </div>}
        </section>
        {data.review.status==="pending"?<section className="review-portal-decision">
          <h2>Qual é a sua decisão?</h2><p>Escolha uma das opções após revisar os materiais.</p>
          <div className="review-portal-buttons">
            <button type="button" className="secondary-button" onClick={()=>setDecision("changes")}><MessageSquare size={17}/> Solicitar ajustes</button>
            <button type="button" className="primary-button" onClick={()=>setDecision("approved")}><CheckCircle2 size={17}/> Aprovar material</button>
          </div>
        </section>:<section className="review-portal-done"><CheckCircle2 size={24}/><h2>{data.review.status==="approved"?"Material aprovado":"Feedback enviado"}</h2>
          <p>{data.review.status==="approved"?"Sua aprovação foi registrada. Obrigado!":"O profissional recebeu seu pedido de alterações. Aguarde uma nova versão."}</p></section>}
        {notice&&<p role="status" className="review-portal-notice">{notice}</p>}
      </>}
    </div>
    <footer className="review-portal-footer">Revisão realizada através do <strong>Roteiva</strong></footer>
    {decision&&<div className="review-modal-backdrop" ref={dialogRef} tabIndex={-1}>
      <section className="review-portal-confirm" role="dialog" aria-modal="true" aria-label="Confirmar decisão">
        <button className="review-icon" aria-label="Fechar" disabled={busy} onClick={()=>setDecision(null)}><X size={19}/></button>
        {decision==="approved"?<><CheckCircle2 size={31}/><h2>Confirmar aprovação?</h2>
          <p>Você confirma que revisou os materiais da versão {data?.review.version} e que estão aprovados?</p></>:
          <><MessageSquare size={31}/><h2>Quais ajustes são necessários?</h2>
            <p>Explique as mudanças para que o profissional possa preparar a próxima versão.</p>
            <textarea rows={4} maxLength={1500} value={decisionText} onChange={e=>setDecisionText(e.target.value)} placeholder="Descreva os ajustes desejados…"/></>}
        <label>Seu nome<input value={name} maxLength={100} onChange={e=>setName(e.target.value)} placeholder="Seu nome"/></label>
        <div className="review-portal-buttons"><button className="secondary-button" onClick={()=>setDecision(null)} disabled={busy}>Cancelar</button>
          <button className="primary-button" disabled={busy||!name.trim()||(decision==="changes"&&!decisionText.trim())}
            onClick={()=>void action("decide",decision)}>{busy?"Registrando…":"Confirmar decisão"}</button></div>
        {notice&&<p role="alert">{notice}</p>}
      </section>
    </div>}
  </main>;
}
