import {useCallback,useEffect,useRef,useState} from "react";
import {Check,CheckCircle2,Clock3,ExternalLink,FileAudio,FileImage,FileText,FileVideo,
  LoaderCircle,MessageSquare,Moon,Pause,Play,Send,ShieldCheck,Sun,Video,X} from "lucide-react";
import {useAuth} from "../auth/AuthProvider";
import {useOverlayFocus} from "../drive/DriveLibraryUI";
import {captureReviewPlayback,formatReviewTime,maskReviewTime,parseReviewTime,validReviewSecond} from "./review-timecode";
import "../reviews/reviews.css";
import "./review-portal-v2.css";

type Review={title:string;message:string;studioName:string;clientName:string;projectName:string;status:string;
  version:number;expiresAt:number;mode:"link"|"google";
  role?:"reviewer"|"viewer";myVote?:"approved"|"changes"|null;approvalsReceived?:number;approvalsRequired?:number};
type Asset={fileId:string;name:string;mimeType:string};
type Comment={id:string;file_id:string;author_name:string;body:string;seconds:number|null;created_at:number};
type Decision={version:number;decision:string;author_name:string;message:string;created_at:number};
type PublicData={review:Review;assets:Asset[];comments:Comment[];decisions:Decision[]};
type Mode="light"|"dark";
const API="https://roteiva-api-dev.ewertonmendes9.workers.dev";
const messages:Record<string,string>={
  review_not_found:"Este link não existe mais ou foi revogado.",
  review_expired:"O prazo de acesso a este material terminou. Solicite um novo link ao profissional.",
  review_not_ready:"Este material ainda não está disponível para revisão.",
  review_recipient_denied:"Sua conta Google não está na lista de participantes desta revisão.",
  review_viewer_read_only:"Sua conta tem permissão de leitura, sem autorização para comentar ou decidir.",
  review_already_decided:"A decisão desta versão já foi registrada.",
  review_invalid_input:"Revise os dados preenchidos e tente novamente.",
  review_version_changed:"Uma nova versão está disponível. Atualize a página e revise o material antes de responder.",
  rate_limited:"Muitas tentativas. Tente novamente em instantes."
};
function reviewFileURL(id:string){return "https://drive.google.com/file/d/"+encodeURIComponent(id)+"/view";}
function previewURL(id:string){return "https://drive.google.com/file/d/"+encodeURIComponent(id)+"/preview";}
function FileGlyph({mime}:{mime:string}){
  if(mime.startsWith("video/"))return <FileVideo size={18}/>;
  if(mime.startsWith("image/"))return <FileImage size={18}/>;
  if(mime.startsWith("audio/"))return <FileAudio size={18}/>;
  return <FileText size={18}/>;
}
function initialTheme():Mode{
  try{
    const setting=localStorage.getItem("roteiva-review-theme");
    if(setting==="dark"||setting==="light")return setting;
  }catch{/* Privacy modes can restrict storage. */}
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches?"dark":"light";
}
export function ReviewPortal({token}:{token:string}){
  const {user,loading:authLoading,busy:authBusy,login,error:authError}=useAuth();
  const [theme,setTheme]=useState<Mode>(initialTheme);
  const [data,setData]=useState<PublicData|null>(null),[loading,setLoading]=useState(true);
  const [error,setError]=useState(""),[needsGoogle,setNeedsGoogle]=useState(false);
  const [selected,setSelected]=useState(0),[name,setName]=useState(""),[body,setBody]=useState("");
  const [minutes,setMinutes]=useState(""),[busy,setBusy]=useState(false),[decision,setDecision]=useState<"approved"|"changes"|null>(null);
  const [decisionText,setDecisionText]=useState(""),[notice,setNotice]=useState("");
  const [mediaUrl,setMediaUrl]=useState(""),[mediaMode,setMediaMode]=useState<"loading"|"native"|"drive"|"private"|"private-error">("loading");
  const [previewProgress,setPreviewProgress]=useState(0),[previewError,setPreviewError]=useState("");
  const [previewRetry,setPreviewRetry]=useState(0);
  const [playhead,setPlayhead]=useState(0),[duration,setDuration]=useState<number|null>(null);
  const [mediaFailure,setMediaFailure]=useState(false);
  const loadedVersion=useRef(0),videoRef=useRef<HTMLVideoElement>(null),commentRef=useRef<HTMLTextAreaElement>(null);
  const dialogRef=useOverlayFocus(()=>{if(!busy)setDecision(null);},!!decision);
  const request=useCallback(async<T,>(path:string,method:"GET"|"POST"="GET",payload?:unknown):Promise<T>=>{
    const auth=user?await user.getIdToken():null;
    const response=await fetch(API+path,{
      method,cache:"no-store",referrerPolicy:"no-referrer",
      headers:{"X-Review-Token":token,...(auth?{"Authorization":"Bearer "+auth}:{}),
        ...(payload?{"Content-Type":"application/json"}:{})},
      ...(payload?{body:JSON.stringify(payload)}:{})
    }).catch(()=>{throw new Error("Sem conexão com o serviço. Verifique sua internet e tente novamente.");});
    if(!response.ok){
      const json=await response.json().catch(()=>({})) as {error?:{code?:string}};
      const code=json.error?.code||"review_unavailable";
      throw Object.assign(new Error(messages[code]||"Não foi possível carregar este material. Tente novamente."),
        {code,status:response.status});
    }
    return response.json() as Promise<T>;
  },[user,token]);
  const reload=useCallback(async(preserve=false)=>{
    if(!preserve){setLoading(true);setData(null);}
    setError("");setNeedsGoogle(false);
    try{
      const value=await request<PublicData>("/reviews/public");
      const changed=loadedVersion.current!==value.review.version;
      setData(value);setSelected(current=>changed?0:Math.max(0,Math.min(current,value.assets.length-1)));
      if(changed){setMinutes("");setBody("");}
      loadedVersion.current=value.review.version;
    }catch(e){
      setData(null);
      const status=(e as {status?:number}).status;
      if(status===401||((e as {code?:string}).code==="review_recipient_denied")){
        setNeedsGoogle(true);
        setError(e instanceof Error&&status!==401?e.message:"Entre com a conta Google autorizada para visualizar.");
      }else setError(e instanceof Error?e.message:"Não foi possível carregar.");
    }finally{setLoading(false);}
  },[request]);
  useEffect(()=>{if(!authLoading)void reload();},[authLoading,reload]);
  useEffect(()=>{
    const robots=document.createElement("meta");robots.name="robots";robots.content="noindex, nofollow, noarchive";
    const ref=document.createElement("meta");ref.name="referrer";ref.content="no-referrer";
    document.head.append(robots,ref);
    return()=>{robots.remove();ref.remove();};
  },[]);
  useEffect(()=>{if(user?.displayName&&!name)setName(user.displayName);},[user?.displayName,name]);
  useEffect(()=>{try{localStorage.setItem("roteiva-review-theme",theme);}catch{/* Optional preference. */}},[theme]);
  const active=data?.assets[selected];
  const isVideo=active?.mimeType.startsWith("video/")??false;
  const activeFileId=active?.fileId;
  const activeVersion=data?.review.version;
  const privateGoogle=data?.review.mode==="google";
  const activeMime=active?.mimeType;
  useEffect(()=>{
    let alive=true,blobUrl="";
    const controller=new AbortController();
    setMediaUrl("");setMediaFailure(false);setPlayhead(0);setDuration(null);
    setPreviewProgress(0);setPreviewError("");
    setMediaMode(privateGoogle||isVideo?"loading":"drive");
    if(!activeFileId||!activeVersion||!activeMime)return;
    if(privateGoogle){
      // Avoid Google's third-party-cookie-dependent iframe. Every file chunk
      // is authorized against the verified Google identity by the Worker.
      void (async()=>{
        if(!user)throw new Error("Entre com sua conta Google autorizada para visualizar.");
        const parts:ArrayBuffer[]=[];
        const max=96*1024*1024;
        let offset=0,total=0;
        do{
          const auth=await user.getIdToken();
          const response=await fetch(API+"/reviews/public/file",{
            method:"POST",cache:"no-store",referrerPolicy:"no-referrer",signal:controller.signal,
            headers:{"Content-Type":"application/json","X-Review-Token":token,"Authorization":"Bearer "+auth},
            body:JSON.stringify({fileId:activeFileId,version:activeVersion,offset})
          });
          if(!response.ok){
            const body=await response.json().catch(()=>({})) as {error?:{code?:string}};
            if(response.status===401||response.status===403)
              throw new Error("Acesso não autorizado. Entre novamente com a conta Google permitida.");
            if(body.error?.code==="review_version_changed"||response.status===404)
              throw new Error("Este material mudou ou não está mais disponível. Atualize a revisão.");
            throw new Error("Não foi possível carregar o arquivo com segurança. Tente novamente.");
          }
          const match=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get("Content-Range")||"");
          if(response.status!==206||!match)throw new Error("O Drive enviou uma resposta inválida para a prévia.");
          const start=Number(match[1]),end=Number(match[2]),length=Number(match[3]);
          if(start!==offset||end<start||!Number.isSafeInteger(length)||length<1||length>max)
            throw new Error(length>max
              ?"Este arquivo é grande demais para a prévia integrada. Abra-o no Google Drive."
              :"A prévia recebida é inválida. Tente novamente.");
          total=length;
          const bytes=await response.arrayBuffer();
          if(bytes.byteLength!==end-start+1||offset+bytes.byteLength>max)
            throw new Error("Não foi possível validar o conteúdo retornado pelo Drive.");
          parts.push(bytes);offset+=bytes.byteLength;
          if(alive)setPreviewProgress(Math.min(100,Math.round(100*offset/total)));
        }while(offset<total&&!controller.signal.aborted);
        if(!alive||controller.signal.aborted)return;
        blobUrl=URL.createObjectURL(new Blob(parts,{type:activeMime}));
        setMediaUrl(blobUrl);setMediaMode("private");
      })().catch(err=>{
        if(alive&&!controller.signal.aborted){
          setPreviewError(err instanceof Error?err.message:"Não foi possível abrir a prévia.");
          setMediaMode("private-error");
        }
      });
    }else if(isVideo){
      void request<{url:string;expiresAt:number}>("/reviews/public/media-ticket","POST",
        {fileId:activeFileId,version:activeVersion}).then(ticket=>{
        if(alive&&ticket.url.startsWith(API+"/reviews/media?ticket=")){setMediaUrl(ticket.url);setMediaMode("native");}
        else if(alive){setMediaMode("drive");setMediaFailure(true);}
      }).catch(()=>{if(alive){setMediaMode("drive");setMediaFailure(true);}});
    }
    return()=>{alive=false;controller.abort();if(blobUrl)URL.revokeObjectURL(blobUrl);};
  },[activeFileId,activeVersion,activeMime,isVideo,privateGoogle,request,user,token,previewRetry]);
  const playableVideo=isVideo&&(mediaMode==="native"||mediaMode==="private");
  const seconds=isVideo?parseReviewTime(minutes):null;
  const invalidTime=isVideo&&!validReviewSecond(seconds,playableVideo?duration:null);
  const switchFile=(index:number)=>{
    if(index===selected)return;
    setSelected(index);setBody("");setMinutes("");setNotice("");
  };
  const markNow=()=>{
    if(!playableVideo)return;
    const value=captureReviewPlayback(videoRef.current);
    if(value===null)return;
    setMinutes(formatReviewTime(value));setNotice("Instante "+formatReviewTime(value)+" marcado. Agora escreva seu comentário.");
    commentRef.current?.focus();
  };
  const jumpTo=(secondsValue:number)=>{
    if(playableVideo&&videoRef.current){
      videoRef.current.currentTime=secondsValue;
      videoRef.current.scrollIntoView({behavior:"smooth",block:"center"});
    }else setNotice("Abra o vídeo no Google Drive e avance até "+formatReviewTime(secondsValue)+".");
  };
  const action=async(kind:"comment"|"decide",status?:"approved"|"changes")=>{
    if(!name.trim()){setNotice("Informe seu nome antes de continuar.");return;}
    if(kind==="comment"&&!body.trim()){setNotice("Escreva sua observação.");return;}
    if(kind==="comment"&&invalidTime){setNotice("Informe um tempo válido no formato mm:ss, dentro da duração do vídeo.");return;}
    if(kind==="decide"&&status==="changes"&&!decisionText.trim()){setNotice("Explique quais ajustes são necessários.");return;}
    setBusy(true);setNotice("");
    try{
      await request(kind==="comment"?"/reviews/public/comment":"/reviews/public/decide","POST",
        kind==="comment"?{version:data?.review.version,authorName:name.trim(),fileId:active?.fileId,
          body:body.trim(),seconds:isVideo?seconds:null}:
          {version:data?.review.version,authorName:name.trim(),decision:status,message:decisionText.trim()});
      if(kind==="comment"){setBody("");setMinutes("");setNotice("Comentário registrado com sucesso.");}
      else{setDecision(null);setDecisionText("");setNotice(status==="approved"?"Material aprovado com sucesso.":"Solicitação de ajustes registrada.");}
      await reload(true);
    }catch(e){setNotice(e instanceof Error?e.message:"Não foi possível registrar sua resposta.");}
    finally{setBusy(false);}
  };
  const comments=data?.comments.filter(c=>c.file_id===activeFileId)||[];
  const isReader=data?.review.role==="viewer";
  const alreadyVoted=Boolean(data?.review.myVote);
  const done=data?.review.status!=="pending"||alreadyVoted;
  return <main className="review-portal" data-theme={theme}>
    <header className="review-portal-header">
      <a href="/" aria-label="Ir para Roteiva"><img src={theme==="dark"?"/roteiva-logo-white.png":"/roteiva-logo-black.png"} alt="Roteiva"/></a>
      <div className="review-portal-topactions">
        <span className="review-portal-security"><ShieldCheck size={15}/> Espaço de aprovação</span>
        <button className="review-theme-button" aria-label={theme==="dark"?"Ativar tema claro":"Ativar tema escuro"}
          title={theme==="dark"?"Tema claro":"Tema escuro"} type="button"
          onClick={()=>setTheme(current=>current==="dark"?"light":"dark")}>
          {theme==="dark"?<Sun size={19}/>:<Moon size={19}/>}
        </button>
      </div>
    </header>
    <div className="review-portal-content">
      {loading?<div className="review-portal-state" role="status"><LoaderCircle className="rl-spin" size={27}/>Preparando seus materiais…</div>:
      !data?<section className="review-portal-state">
        <ShieldCheck size={30}/><h1>{needsGoogle?"Acesso restrito":"Material indisponível"}</h1>
        <p>{error}</p>
        {needsGoogle&&<><button className="review-action-primary" disabled={authBusy} onClick={()=>void login()}>
          {user?"Trocar conta Google":"Entrar com Google"}</button>
          {authError&&<p role="alert">{authError}</p>}{user&&<small>Conta atual: {user.email}</small>}</>}
        <button className="review-action-secondary" onClick={()=>void reload()}>Tentar novamente</button>
      </section>:
      <>
        <div className="review-portal-intro">
          <span className="review-kicker"><span className="review-kicker-dot"/> MATERIAL ENVIADO POR {data.review.studioName}</span>
          <h1>{data.review.title}</h1>
          <p>{data.review.message||"Confira os arquivos e deixe seus comentários antes de enviar sua decisão."}</p>
          <div className="review-portal-meta">
            <span><Video size={14}/> Versão {data.review.version}</span>
            <span>{data.assets.length} {data.assets.length===1?"material":"materiais"}</span>
            <span><Clock3 size={14}/> Até {new Date(data.review.expiresAt).toLocaleDateString("pt-BR")}</span>
          </div>
        </div>
        <div className="review-portal-layout">
          <div className="review-portal-maincolumn">
            <section className="review-portal-review" aria-label="Material para avaliar">
              <div className={"review-portal-stage"+(privateGoogle?" is-private":"")}>
                {mediaMode==="loading"&&<div className="review-media-state review-private-preview-state" role="status">
                  <LoaderCircle className="rl-spin" size={25}/>
                  {privateGoogle?("Carregando arquivo com acesso seguro… "+(previewProgress?previewProgress+"%":"")):"Preparando reprodução…"}
                </div>}
                {playableVideo&&<video ref={videoRef} key={activeFileId}
                  controls playsInline preload="metadata" src={mediaUrl} aria-label={"Reproduzir "+active?.name}
                  onTimeUpdate={e=>setPlayhead(e.currentTarget.currentTime)}
                  onLoadedMetadata={e=>setDuration(Number.isFinite(e.currentTarget.duration)?e.currentTarget.duration:null)}
                  onError={()=>{setMediaFailure(true);setMediaMode("drive");}}/>}
                {active&&mediaMode==="private"&&!isVideo&&active.mimeType.startsWith("image/")&&
                  <img className="review-private-preview-image" src={mediaUrl} alt={active.name}/>}
                {active&&mediaMode==="private"&&active.mimeType==="application/pdf"&&
                  <iframe className="review-private-preview-pdf" src={mediaUrl}
                    title={"Prévia PDF de "+active.name} sandbox="allow-scripts allow-downloads"/>}
                {active&&mediaMode==="private"&&active.mimeType.startsWith("audio/")&&
                  <div className="review-private-preview-audio"><FileAudio size={32}/><audio controls src={mediaUrl}/></div>}
                {mediaMode==="private-error"&&<div className="review-private-preview-error" role="alert">
                  <FileImage size={26}/><strong>Não foi possível mostrar a prévia</strong>
                  <p>{previewError}</p>
                  <button type="button" onClick={()=>setPreviewRetry(n=>n+1)}>Tentar novamente</button>
                </div>}
                {active&&mediaMode==="drive"&&!privateGoogle&&<iframe key={active.fileId} title={"Prévia de "+active.name}
                  src={previewURL(active.fileId)} referrerPolicy="no-referrer" allow="fullscreen"
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-presentation"/>}
                {!active&&<p>Nenhum material disponível.</p>}
              </div>
              <div className="review-portal-stage-footer">
                <div><strong>{active?.name}</strong><small>{playableVideo?"Player com marcação de instantes":privateGoogle?"Visualização segura no Roteiva":"Prévia fornecida pelo Google Drive"}</small></div>
                {active&&<a href={reviewFileURL(active.fileId)} target="_blank" rel="noreferrer">
                  <ExternalLink size={15}/> Abrir no Drive</a>}
              </div>
            </section>
            {playableVideo&&data.review.status==="pending"&&
              <div className="review-capture-bar">
                <div><span className="review-live-label"><span/> TEMPO ATUAL</span>
                  <strong>{formatReviewTime(playhead)}{duration!==null&&<small> / {formatReviewTime(duration)}</small>}</strong></div>
                <button type="button" className="review-capture-button" onClick={markNow}>
                  <Pause size={16}/> Marcar este instante e comentar</button>
              </div>}
            {mediaFailure&&isVideo&&<p className="review-portal-hint" role="status">
              Este vídeo está usando a prévia do Drive, que não permite ler o tempo exato.
              Você pode informar o minuto manualmente no comentário ou abrir o arquivo no Drive.
            </p>}
            <nav className="review-portal-assets" aria-label="Arquivos da aprovação">
              <div className="review-portal-assets-label"><span>Materiais para revisar</span><span>{data.assets.length} arquivos</span></div>
              {data.assets.map((a,i)=><button type="button" key={a.fileId} aria-current={i===selected}
                onClick={()=>switchFile(i)}>
                <FileGlyph mime={a.mimeType}/><span>{a.name}</span>
                {data.comments.some(c=>c.file_id===a.fileId)&&<span className="review-asset-count">{data.comments.filter(c=>c.file_id===a.fileId).length}</span>}
                {i===selected&&<Check size={15}/>}</button>)}
            </nav>
          </div>
          <section className="review-portal-comments" aria-label="Comentários">
            <div className="review-section-heading"><div className="review-section-icon"><MessageSquare size={19}/></div>
              <div><h2>Comentários</h2><p>{isVideo?"Comente cenas e marque instantes importantes.":"Deixe seu feedback sobre este arquivo."}</p></div>
              <span className="review-count">{comments.length}</span>
            </div>
            <div className="review-comment-list">
              {!comments.length&&<div className="review-empty-feedback"><MessageSquare size={22}/>
                <strong>Comece a conversa</strong><span>Nenhum comentário neste material ainda.</span></div>}
              {comments.map(c=><article className="review-portal-comment" key={c.id}>
                <div className="review-comment-top"><strong>{c.author_name}</strong>
                  <small>{new Date(c.created_at).toLocaleString("pt-BR")}</small></div>
                {isVideo&&c.seconds!==null&&<button type="button" className="review-time-link"
                  onClick={()=>jumpTo(c.seconds!)}><Play size={12}/> {formatReviewTime(c.seconds)}</button>}
                <p>{c.body}</p>
              </article>)}
            </div>
            {!done&&!isReader&&<div className="review-portal-commentform">
              <label>Seu nome<input maxLength={100} value={name} placeholder="Como podemos chamar você?"
                onChange={e=>setName(e.target.value)}/></label>
              {isVideo&&<div className="review-video-time-field">
                <div className="review-time-field-heading"><label htmlFor="review-video-second">Instante do vídeo <span>(opcional)</span></label>
                  {playableVideo&&<button type="button" onClick={markNow} className="review-use-time">
                    <Clock3 size={14}/> Usar tempo atual</button>}</div>
                <div className="review-time-input"><Clock3 size={16}/><input id="review-video-second"
                  value={minutes} placeholder="Ex.: 01:25" inputMode="numeric"
                  aria-invalid={invalidTime} aria-describedby="review-time-hint"
                  onChange={e=>setMinutes(maskReviewTime(e.target.value))}
                  onBlur={()=>{if(seconds!==null&&!invalidTime)setMinutes(formatReviewTime(seconds));}}/></div>
                <small id="review-time-hint" className={invalidTime?"review-input-error":""}>
                  {invalidTime?"Informe mm:ss válido, dentro da duração do vídeo.":playableVideo?
                    "Pause no momento desejado e capture o instante com um clique.":"Digite mm:ss (ex.: 01:25). A prévia do Drive não informa o tempo automaticamente."}</small>
              </div>}
              <label>Seu comentário<textarea ref={commentRef} maxLength={1500} rows={4} value={body}
                placeholder="O que você gostaria de comentar?" onChange={e=>setBody(e.target.value)}/></label>
              <div className="review-send-row"><span>{body.length}/1500</span>
                <button className="review-action-primary" disabled={busy||invalidTime||!body.trim()||!name.trim()}
                  onClick={()=>void action("comment")}><Send size={16}/>{busy?"Enviando…":"Adicionar comentário"}</button></div>
            </div>}
          </section>
        </div>
        {data.review.status==="pending"&&!isReader&&!alreadyVoted?<section className="review-portal-decision">
          <div className="review-decision-copy"><span className="review-decision-label">ETAPA FINAL</span>
            <h2>Tudo pronto para decidir?</h2>
            <p>Confira os materiais. Você pode aprovar ou pedir alterações.</p>
            {data.review.mode==="google"&&<p className="review-approval-progress">
              {data.review.approvalsReceived||0} de {data.review.approvalsRequired||1} revisores aprovaram.
            </p>}</div>
          <div className="review-portal-buttons">
            <button type="button" className="review-action-secondary" onClick={()=>setDecision("changes")}>
              <MessageSquare size={17}/> Solicitar ajustes</button>
            <button type="button" className="review-action-primary" onClick={()=>setDecision("approved")}>
              <CheckCircle2 size={18}/> Aprovar material</button>
          </div>
        </section>:<section className="review-portal-done"><CheckCircle2 size={24}/>
          <div><h2>{isReader?"Acompanhamento somente leitura":data.review.status==="approved"?"Material aprovado":data.review.status==="pending"?"Sua decisão foi registrada":"Feedback enviado"}</h2>
            <p>{isReader?"Você pode acompanhar os materiais, comentários e o estado da revisão, sem enviar decisões.":
              data.review.status==="pending"?"Aguardando a resposta dos demais revisores.":
              data.review.status==="approved"?"A versão foi aprovada. Obrigado!":
              "O profissional recebeu o pedido de alterações. Aguarde uma nova versão."}</p>
            {data.review.mode==="google"&&<p className="review-approval-progress">
              {data.review.approvalsReceived||0} de {data.review.approvalsRequired||1} revisores aprovaram.
            </p>}</div></section>}
        {notice&&<p role="status" className="review-portal-notice">{notice}</p>}
      </>}
    </div>
    <footer className="review-portal-footer"><ShieldCheck size={13}/> Revisão realizada através do <strong>Roteiva</strong></footer>
    {decision&&<div className="review-modal-backdrop" ref={dialogRef} tabIndex={-1}>
      <section className="review-portal-confirm" role="dialog" aria-modal="true" aria-label="Confirmar decisão">
        <button className="review-icon" aria-label="Fechar" disabled={busy} onClick={()=>setDecision(null)}><X size={19}/></button>
        {decision==="approved"?<><CheckCircle2 size={31}/><h2>Confirmar aprovação?</h2>
          <p>Você confirma que revisou os materiais da versão {data?.review.version} e que estão aprovados?</p></>:
          <><MessageSquare size={31}/><h2>Quais ajustes são necessários?</h2>
            <p>Explique as mudanças para que o profissional possa preparar a próxima versão.</p>
            <textarea rows={4} maxLength={1500} value={decisionText} onChange={e=>setDecisionText(e.target.value)}
              placeholder="Descreva os ajustes desejados…"/></>}
        <label>Seu nome<input value={name} maxLength={100} onChange={e=>setName(e.target.value)} placeholder="Seu nome"/></label>
        <div className="review-portal-buttons"><button className="review-action-secondary" onClick={()=>setDecision(null)} disabled={busy}>Cancelar</button>
          <button className="review-action-primary" disabled={busy||!name.trim()||(decision==="changes"&&!decisionText.trim())}
            onClick={()=>void action("decide",decision)}>{busy?"Registrando…":"Confirmar decisão"}</button></div>
        {notice&&<p role="alert">{notice}</p>}
      </section>
    </div>}
  </main>;
}
