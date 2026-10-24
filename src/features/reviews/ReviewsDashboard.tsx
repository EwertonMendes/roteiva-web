import { AppSelect } from "../ui/AppSelect";
import {useCallback,useEffect,useMemo,useRef,useState} from "react";
import {createPortal} from "react-dom";
import {AlertTriangle,Check,ChevronLeft,ChevronRight,ExternalLink,Folder,LoaderCircle,Plus,Search,Send,ShieldCheck,X} from "lucide-react";
import type {Client,Project} from "../../domain/workspace";
import {useAuth} from "../auth/AuthProvider";
import {useDriveApi} from "../drive/drive-api";
import {readDriveLinks,type DriveFolderLink} from "../../data/drive-folder-links";
import {readDropboxLinks,type DropboxFolderLink} from "../../data/dropbox-folder-links";
import {dropboxWebUrl} from '../dropbox/dropbox-web-url';
import {driveFileUrl,isStorageFolder,readableFileType,type DriveItem,useOverlayFocus} from "../drive/DriveLibraryUI";
import {DriveThumbnail} from "../drive/DriveThumbnail";
import {useDriveThumbnailFetch} from "../drive/useDriveThumbnailFetch";
import {cacheKey,getCachedFolder,setCachedFolder} from "../drive/drive-folder-cache";
import {useDriveTransfers} from "../drive/DriveTransfersProvider";
import type {UploadDestination} from "../drive/useDriveUploads";
import "./reviews.css";
import {ReviewOwnerWorkspace} from "./ReviewOwnerWorkspace";
import {statusText,type Mode,type Review,type Detail} from "./review-model";

type StorageFolderLink=(DriveFolderLink & {provider:'google_drive'})|DropboxFolderLink;
type Selection={fileId:string;connectionId:string;linkedFolderId:string;name:string;mimeType:string;provider:'google_drive'|'dropbox'};
const supported=(file:DriveItem)=>/^(video|image|audio)\//.test(file.mimeType)||file.mimeType==="application/pdf";
const splitEmails=(raw:string)=>raw.split(/[\n,;]+/).map(v=>v.trim().toLowerCase()).filter(Boolean);
const validEmail=(value:string)=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
export function ReviewsDashboard({clients,projects,studioName,onLibrary,startProjectId,startClientId}:{
  clients:Client[];projects:Project[];studioName:string;onLibrary:()=>void;startProjectId?:number;startClientId?:number
}){
  const {user}=useAuth(),call=useDriveApi(),transfers=useDriveTransfers();
  const getThumbnail=useDriveThumbnailFetch();
  const [rows,setRows]=useState<Review[]>([]);
  const [search,setSearch]=useState(""),[debouncedSearch,setDebouncedSearch]=useState("");
  const [status,setStatus]=useState(""),[page,setPage]=useState(0);
  const [hasMore,setHasMore]=useState(false),[refresh,setRefresh]=useState(0);
  const [loading,setLoading]=useState(true),[working,setWorking]=useState(false),[error,setError]=useState("");
  const [opened,setOpened]=useState<Detail|null>(null);
  const [composer,setComposer]=useState(false),[replacement,setReplacement]=useState<string|null>(null);
  const [composerStep,setComposerStep]=useState<"details"|"materials">("details");
  const composerBodyRef=useRef<HTMLDivElement>(null);
  const [clientId,setClientId]=useState(startClientId||0),[projectId,setProjectId]=useState(startProjectId||0);
  const [title,setTitle]=useState(""),[message,setMessage]=useState("");
  const [mode,setMode]=useState<Mode>("link"),[recipient,setRecipient]=useState("");
  const [viewers,setViewers]=useState(""),[restrictPublic,setRestrictPublic]=useState(false);
  const [shareDirect,setShareDirect]=useState(false);
  const [days,setDays]=useState(14),[links,setLinks]=useState<StorageFolderLink[]>([]);
  const [linksLoading,setLinksLoading]=useState(false);
  const [selectedFolder,setSelectedFolder]=useState<StorageFolderLink|null>(null);
  const getStorageThumbnail=useCallback(async(item:DriveItem,signal?:AbortSignal,accountId?:string)=>{
    if(selectedFolder?.provider!=='dropbox')return getThumbnail(item,signal,accountId);
    if(!user||!item.thumbnailFallback)return null;
    const token=await user.getIdToken();
    const response=await fetch('https://roteiva-api-dev.ewertonmendes9.workers.dev/integrations/dropbox/'+
      encodeURIComponent(accountId||selectedFolder.connectionId)+'/files/'+encodeURIComponent(item.id)+'/thumbnail',
      {headers:{Authorization:'Bearer '+token},signal,cache:'no-store'});
    return response.ok&&response.status!==204?response.blob():null;
  },[getThumbnail,user,selectedFolder?.provider,selectedFolder?.connectionId]);
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

  useEffect(()=>{
    const timer=window.setTimeout(()=>setDebouncedSearch(search.trim()),300);
    return()=>window.clearTimeout(timer);
  },[search]);
  const loadList=useCallback(async(signal?:AbortSignal)=>{
    const sequence=++listSequence.current;
    setLoading(true);
    try{
      const result=await call<{reviews:Review[];hasMore:boolean}>("/reviews?"+new URLSearchParams({page:String(page),q:debouncedSearch,status}),"GET",undefined,signal);
      if(sequence===listSequence.current){setRows(result.reviews);setHasMore(result.hasMore);}
    }catch(e){if(!signal?.aborted&&sequence===listSequence.current)setError(e instanceof Error?e.message:"Não foi possível carregar as aprovações.");}
    finally{if(!signal?.aborted&&sequence===listSequence.current)setLoading(false);}
  },[call,page,refresh,debouncedSearch,status]);
  useEffect(()=>{
    const controller=new AbortController();
    void loadList(controller.signal);
    return()=>controller.abort();
  },[loadList]);
  useEffect(()=>{if(startProjectId){setProjectId(startProjectId);setClientId(startClientId||projects.find(p=>p.id===startProjectId)?.clientId||0);setComposer(true);}},
    [startProjectId,startClientId,projects]);
  useEffect(()=>{if(startClientId&&!startProjectId){setClientId(startClientId);setComposer(true);}},[startClientId,startProjectId]);
  const relevantProjects=useMemo(()=>clientId?projects.filter(p=>p.clientId===clientId):projects,[clientId,projects]);
  useEffect(()=>{
    browseSequence.current++;searchSequence.current++;setFileSearch("");setRemote(null);setSearchBusy(false);
    setSelectedFolder(null);setItems([]);setTrail([]);setNextToken(null);setFolderBusy(false);setFolderError("");setLinks([]);
    if(!user||!projectId||!composer){setLinksLoading(false);return;}
    setLinksLoading(true);
    let alive=true;
    Promise.allSettled([readDriveLinks(user.uid),readDropboxLinks(user.uid)]).then(([drive,dropbox])=>{
      if(drive.status==='rejected'&&dropbox.status==='rejected')throw new Error('Não foi possível ler as pastas.');
      const google=drive.status==='fulfilled'?drive.value:[];
      const other=dropbox.status==='fulfilled'?dropbox.value:[];
      if(alive)setLinks([...google.map(l=>({...l,provider:'google_drive' as const})),...other]
       .filter(l=>l.projectId===projectId));
    }).catch(()=>{if(alive)setFolderError("Não foi possível ler as pastas vinculadas.");})
      .finally(()=>{if(alive)setLinksLoading(false);});
    return()=>{alive=false;};
  },[user,projectId,composer]);
  const browse=useCallback(async(folder:StorageFolderLink,targetId:string,path:{id:string;name:string}[],append=false,pageKey?:string)=>{
    const sequence=++browseSequence.current;
    setFolderBusy(true);setFolderError("");
    if(!append){++searchSequence.current;setFileSearch("");setRemote(null);setSearchBusy(false);setItems([]);setNextToken(null);setTrail(path);}
    try{
      const params=pageKey?"?pageToken="+encodeURIComponent(pageKey):"";
      const response=await call<{files:DriveItem[];nextPageToken:string|null}>(
        ('/integrations/'+(folder.provider==='dropbox'?'dropbox':'drive')+'/'+encodeURIComponent(folder.connectionId))+"/folders/"+encodeURIComponent(targetId)+"/items"+params);
      if(sequence!==browseSequence.current)return;
      setItems(old=>append?[...old,...response.files.filter(f=>!old.some(o=>o.id===f.id))]:response.files);
      setTrail(path);setNextToken(response.nextPageToken);
    }catch(e){if(sequence===browseSequence.current){setFolderError(e instanceof Error?e.message:"Não foi possível abrir a pasta.");if(!append)setItems([]);}}
    finally{if(sequence===browseSequence.current)setFolderBusy(false);}
  },[call]);
  const pickFolder=(folder:StorageFolderLink)=>{
    if(folder.provider==='dropbox'&&shareDirect){setShareDirect(false);setRestrictPublic(false);}
    setSelectedFolder(folder);setTrail([{id:folder.folderId,name:folder.folderName}]);
    void browse(folder,folder.folderId,[{id:folder.folderId,name:folder.folderName}]);
  };
  useEffect(()=>{
    if(!composer||!projectId||(!replacement&&composerStep!=="materials")||!links.length||selectedFolder)return;
    const folder=links[0];
    setSelectedFolder(folder);
    void browse(folder,folder.folderId,[{id:folder.folderId,name:folder.folderName}]);
  },[browse,composer,composerStep,links,projectId,replacement,selectedFolder]);
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
          ('/integrations/'+(folder.provider==='dropbox'?'dropbox':'drive')+'/'+encodeURIComponent(folder.connectionId))+"/folders/"+
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
      const params=new URLSearchParams({search:current.term,pageToken:current.page!});
      const result=await call<{files:DriveItem[];nextPageToken:string|null}>(
        ('/integrations/'+(selectedFolder.provider==='dropbox'?'dropbox':'drive')+'/'+encodeURIComponent(selectedFolder.connectionId))+"/folders/"+
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
    provider:selectedFolder.provider,connectionId:selectedFolder.connectionId,linkedFolderId:selectedFolder.folderId,
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
        provider:uploaded.provider||'google_drive',connectionId:uploaded.connectionId,linkedFolderId:uploaded.linkedFolderId}]);
    const target=trail.at(-1)?.id||selectedFolder?.folderId;
    if(selectedFolder&&uploaded.connectionId===selectedFolder.connectionId&&uploaded.targetFolderId===target)
      void browse(selectedFolder,target,trail);
  }),[transfers.subscribe,composer,selectedFolder,projectId,trail,browse]);
  const resetComposer=()=>{
    if(working)return;
    browseSequence.current++;searchSequence.current++;
    setComposer(false);setReplacement(null);setComposerStep("details");setFiles([]);setTitle("");setMessage("");setSelectedFolder(null);setViewers("");setRestrictPublic(false);setShareDirect(false);
    setTrail([]);setItems([]);setError("");setFolderError("");
  };
  const newReview=()=>{
    setClientId(0);setProjectId(0);setRecipient("");setViewers("");setRestrictPublic(false);setShareDirect(false);setTitle("");setMessage("");setFiles([]);setMode("link");
    setReplacement(null);setComposerStep("details");setComposer(true);setOpened(null);setError("");setFolderError("");
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
    catch(e){
      const asset=(e as {asset?:{fileId?:string;fileName?:string}}|null)?.asset;
      const selectedName=asset?.fileId&&!asset.fileName?files.find(file=>file.fileId===asset.fileId)?.name:null;
      const message=e instanceof Error?e.message:"Não foi possível concluir a operação.";
      setError(selectedName?`Não foi possível concluir "${selectedName}": ${message}`:message);
    }
    finally{setWorking(false);}
  };
  const submit=async()=>{
    if(shareDirect&&files.some(f=>f.provider==='dropbox')){
      setError('O compartilhamento direto do original ainda não está disponível para arquivos Dropbox. Desative essa opção para utilizar a aprovação segura do Roteiva.');
      return;
    }
    if(working||pendingUploads.length){setError("Conclua ou cancele os envios pendentes antes de compartilhar.");return;}
    if(!projectId||!clientId||!files.length) {setError("Escolha o cliente, projeto e pelo menos um arquivo.");return;}
    if(!replacement&&missingDetails.length){setComposerStep("details");setError(missingDetails[0]);return;}
    await run(async()=>{
      let publishWarning="";
      const selections=files.map(f=>({fileId:f.fileId,linkedFolderId:f.linkedFolderId,connectionId:f.connectionId,provider:f.provider}));
      if(replacement){
        const beforeVersion=opened?.review.version??0;
        const endpoint="/reviews/"+replacement;
        let result:Detail;
        try{
          result=(await call<{review:Detail}>(endpoint+"/revise","POST",{assets:selections})).review;
        }catch(original){
          // A request may have committed a version but lost its HTTP response.
          // Check the authoritative server state before allowing a retry.
          const latest=await call<Detail>(endpoint);
          setOpened(latest);
          if(latest.review.version>beforeVersion&&latest.review.status==="pending"){
            result=latest;
          }else if(["replacing","draft","publishing"].includes(latest.review.status)){
            result=(await call<{review:Detail}>(endpoint+"/revise","POST",{assets:selections})).review;
          }else{
            throw original;
          }
        }
        setOpened(result);
      }else{
        const reviewers=mode==="google"?splitEmails(recipient):[];
        const readers=mode==="google"?splitEmails(viewers):[];
        if(mode==="google"&&(!reviewers.length||new Set([...reviewers,...readers]).size!==reviewers.length+readers.length)){
          throw new Error("Informe ao menos um revisor Google e não repita e-mails entre revisores e leitores.");
        }
        const participants=[...reviewers.map(email=>({email,role:"reviewer"})),...readers.map(email=>({email,role:"viewer"}))];
        const created=await call<{id:string}>("/reviews","POST",{
          clientId,projectId,studioName,title,message,mode,recipientEmail:reviewers[0]||"",
          participants,driveShareEnabled:mode==="google"&&shareDirect,
          restrictExistingPublic:mode==="google"&&shareDirect&&restrictPublic,
          expiresInDays:days,assets:selections
        });
        setOpened(await call<Detail>("/reviews/"+created.id));
        try{
          const published=await call<{review:Detail}>("/reviews/"+created.id+"/publish","POST");
          setOpened(published.review);
        }catch(e){
          publishWarning="A solicitação foi salva, mas ainda não foi ativada. "+
            (e instanceof Error?e.message:"Falha ao preparar os arquivos.")+
            " Você pode tentar novamente usando “Ativar compartilhamento”, sem precisar recriar a aprovação.";
        }
      }
      setComposer(false);setReplacement(null);setFiles([]);setSelectedFolder(null);setTrail([]);setItems([]);
      if(publishWarning)setError(publishWarning);
    });
  };
  const beginRevision=()=>{
    if(!opened||working)return;
    setClientId(opened.review.clientId);setProjectId(opened.review.projectId);setReplacement(opened.review.id);
    setFiles([]);setError("");setComposerStep("materials");setComposer(true);
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
  const chosenProject=projects.find(p=>p.id===projectId);
  const reviewEmails=mode==="google"?splitEmails(recipient):[];
  const readerEmails=mode==="google"?splitEmails(viewers):[];
  const allEmails=[...reviewEmails,...readerEmails];
  const participantIssue=mode!=="google"?"":!reviewEmails.length?
    "Adicione pelo menos um e-mail de revisor.":allEmails.some(email=>!validEmail(email))?
    "Corrija os e-mails inválidos dos participantes.":new Set(allEmails).size!==allEmails.length?
    "Cada e-mail deve aparecer apenas uma vez entre revisores e leitores.":"";
  const missingDetails=[
    ...(!clientId?["Selecione um cliente."]:[]),
    ...(!projectId?["Selecione um projeto."]:[]),
    ...(!title.trim()?["Informe o título da aprovação."]:[]),
    ...(participantIssue?[participantIssue]:[])
  ];
  const goToMaterials=()=>{
    if(missingDetails.length){
      setError(missingDetails[0]);
      composerBodyRef.current?.scrollTo({top:0,behavior:"smooth"});
      return;
    }
    setError("");setComposerStep("materials");
    composerBodyRef.current?.scrollTo({top:0});
  };
  const addFile=(file:DriveItem)=>{
    if(!selectedFolder)return;
    if(!supported(file))return;
    setFiles(old=>old.some(f=>f.fileId===file.id)?old.filter(f=>f.fileId!==file.id):
      old.length+pendingUploads.length>=8?old:[...old,{fileId:file.id,name:file.name,mimeType:file.mimeType,
        provider:selectedFolder.provider,connectionId:selectedFolder.connectionId,linkedFolderId:selectedFolder.folderId}]);
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
      <AppSelect aria-label="Filtrar aprovações" value={status} onValueChange={value=>{setStatus(value);setPage(0);}}>
        <option value="">Todas as situações</option>
        {(["draft","pending","changes","approved","closed"] as const).map(s=><option key={s} value={s}>{statusText[s]}</option>)}
      </AppSelect>
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
      <section role="dialog" aria-modal="true" aria-label="Detalhes da revisão" className="review-dialog rowner-dialog">
        <ReviewOwnerWorkspace key={opened.review.id} detail={opened} working={working} error={error}
          onClose={()=>setOpened(null)} onRevise={beginRevision} onPublish={()=>void mutate("publish")}
          onRotate={()=>void mutate("rotate")} onEnd={()=>void mutate("close")}
          onCompleteClose={()=>void mutate("close")}
          onResume={withFiles=>{
            if(withFiles){beginRevision();return;}
            void run(async()=>{
              const result=await call<{review:Detail}>("/reviews/"+opened.review.id+"/revise","POST",{assets:[]});
              setOpened(result.review);
            });
          }}/>
      </section>
    </div>,document.body)}

    {composer&&createPortal(<div className="review-modal-backdrop" ref={dialogRef} tabIndex={-1} onMouseDown={e=>{if(e.target===e.currentTarget)resetComposer();}}>
      <section className="review-dialog review-composer-dialog" role="dialog" aria-modal="true" aria-label="Enviar materiais para aprovação">
        <header><div><span className="eyebrow">APROVAÇÕES / {replacement?"NOVA VERSÃO":"NOVA SOLICITAÇÃO"}</span>
          <h2>{replacement?"Selecione os novos arquivos":"Enviar para aprovação"}</h2>
          <p>{replacement?"Escolha os arquivos da nova versão.":"Configure o acesso e selecione os materiais, sem perder o contexto."}</p></div>
          <button className="review-icon" disabled={working} onClick={resetComposer} aria-label="Fechar"><X size={20}/></button></header>
        {!replacement&&<div className="review-composer-steps" aria-label="Etapas da nova aprovação">
          <span className={"review-composer-step"+(composerStep==="details"?" active":" complete")}>
            <span className="review-step-number">{composerStep==="materials"?<Check size={14}/>:1}</span>
            <span>Configuração</span>
          </span>
          <span className="review-step-connector" aria-hidden="true"/>
          <span className={"review-composer-step"+(composerStep==="materials"?" active":"")}>
            <span className="review-step-number">2</span><span>Selecionar materiais</span>
          </span>
        </div>}
        <div className="review-dialog-body" ref={composerBodyRef}>
          {!replacement&&composerStep==="details"&&<div className="review-composer-intro">
            <h3>Quem vai revisar?</h3>
            <p>Comece pelo cliente e projeto, depois defina como os participantes entrarão na aprovação.</p>
          </div>}
          {error&&<p className="reviews-warning" role="alert">{error}</p>}
          {(replacement||composerStep==="details")&&<div className="review-fields">
            <label>Cliente
              <AppSelect aria-label="Cliente" disabled={!!replacement} value={clientId} onValueChange={value=>{
                const id=Number(value);setClientId(id);setProjectId(0);setFiles([]);setSelectedFolder(null);
                setRecipient(clients.find(c=>c.id===id)?.email||"");
              }}><option value={0}>Selecionar cliente</option>{clients.map(c=><option value={c.id} key={c.id}>{c.name}</option>)}</AppSelect></label>
            <label>Projeto
              <AppSelect aria-label="Projeto" disabled={!!replacement} value={projectId} onValueChange={value=>{
                setProjectId(Number(value));setFiles([]);setSelectedFolder(null);setTrail([]);setItems([]);
              }}><option value={0}>Selecionar projeto</option>{relevantProjects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</AppSelect></label>
            {!replacement&&<>
              <label>Título da aprovação<input maxLength={180} required value={title} onChange={e=>setTitle(e.target.value)} placeholder="Ex.: Primeiro corte da campanha"/></label>
              <label>Mensagem (opcional)<textarea maxLength={1500} rows={2} value={message} onChange={e=>setMessage(e.target.value)} placeholder="O que o cliente deve avaliar?"/></label>
              <label>Tipo de acesso<AppSelect aria-label="Tipo de acesso" value={mode} onValueChange={value=>{setMode(value as Mode);setShareDirect(false);setRestrictPublic(false);}}>
                <option value="link">Acesso por link de aprovação</option><option value="google">Acesso restrito com conta Google</option>
              </AppSelect></label>
              {mode==="link"?<p className="reviews-info">Quem receber o link poderá revisar os materiais pelo Roteiva, sem precisar entrar com Google. O Roteiva cria apenas o acesso necessário para exibir os materiais; permissões públicas existentes no Drive não são alteradas.</p>:
                <div className="review-participants-config">
                  <h3>Participantes Google</h3>
                  <p className="reviews-muted">Somente os e-mails indicados poderão entrar nesta aprovação do Roteiva. Isso não altera a privacidade dos arquivos originais no Google Drive. Separe os e-mails por vírgulas ou linhas diferentes.</p>
                  <label>Revisores · podem comentar, aprovar ou solicitar ajustes
                    <textarea required rows={3} value={recipient} onChange={e=>setRecipient(e.target.value)}
                      placeholder={"revisor1@gmail.com\nrevisor2@gmail.com"}/>
                  </label>
                  <label>Leitores · podem visualizar materiais, comentários e decisões
                    <textarea rows={3} value={viewers} onChange={e=>setViewers(e.target.value)}
                      placeholder={"diretoria@gmail.com\nobservador@gmail.com"}/>
                  </label>
                  <p className="reviews-info">A aprovação só fica concluída depois que todos os revisores aprovarem. Um pedido de ajustes devolve a versão ao estúdio. Leitores nunca podem enviar comentários ou decisões.</p>
                  <div className="review-share-heading">
                    <h4>Permissões no Google Drive</h4>
                    <p>Estas opções são adicionais ao acesso pelo Roteiva. Desativadas, não concedem acesso direto aos arquivos no Drive.</p>
                  </div>
                  <label className="review-sharing-option">
                    <span className="review-sharing-copy">
                      <strong>Permitir abrir também pelo Google Drive</strong>
                      <small>Em arquivos privados, concede permissão de <b>Leitor</b> aos e-mails quando o Drive autorizar. Se o arquivo já for público, reutiliza o acesso existente sem modificar a pasta. Os papéis de revisor e leitor continuam protegidos no Roteiva.</small>
                    </span>
                    <input type="checkbox" disabled={files.some(f=>f.provider==='dropbox')} checked={shareDirect}
                      onChange={e=>{setShareDirect(e.target.checked);if(!e.target.checked)setRestrictPublic(false);}}/>
                    <span className="review-sharing-switch" aria-hidden="true"/>
                  </label>
                  {shareDirect&&<label className="review-sharing-option review-sharing-option-danger">
                    <span className="review-sharing-copy">
                      <strong><AlertTriangle size={16} aria-hidden="true"/> Remover acesso público existente no Drive</strong>
                      <small>Remove apenas permissões públicas <b>diretas</b> dos arquivos, quando autorizado pelo Google. <b>Links antigos podem parar de funcionar.</b> Pastas públicas, grupos e domínios permanecem sob controle do proprietário.</small>
                    </span>
                    <input type="checkbox" checked={restrictPublic} onChange={e=>setRestrictPublic(e.target.checked)}/>
                    <span className="review-sharing-switch" aria-hidden="true"/>
                  </label>}
                  <p className="review-sharing-footnote">O acesso à aprovação é protegido por conta Google mesmo se o Drive original for público. Para tornar os arquivos originais privados, ajuste também as permissões no Drive.</p>
                </div>}
              <label>Validade<AppSelect aria-label="Validade" value={days} onValueChange={value=>setDays(Number(value))}>
                <option value={7}>7 dias</option><option value={14}>14 dias</option><option value={30}>30 dias</option>
              </AppSelect></label>
            </>}
            {chosenClient&&!relevantProjects.length&&<p className="reviews-muted">Este cliente ainda não possui projetos vinculados.</p>}
          </div>}
           {(replacement||composerStep==="materials")&&<>
           {!replacement&&<div className="review-composer-context">
             <div>
               <small>{chosenClient?.name} · {chosenProject?.name}</small>
               <strong>{title}</strong>
               <span>{mode==="google"?"Somente participantes com Google":"Acesso por link"} · {days} dias</span>
             </div>
             <button type="button" className="secondary-button" onClick={()=>{setComposerStep("details");setError("");composerBodyRef.current?.scrollTo({top:0});}}>
               Editar configuração
             </button>
           </div>}
           <div className="review-materials-heading">
             <h3>Arquivos dos projetos <span>({files.length}/8)</span></h3>
             <p>Escolha pelo menos um arquivo. Você pode selecionar até 8 imagens, vídeos, áudios ou PDFs.</p>
           </div>
          {!projectId?<p className="reviews-muted">Selecione um projeto para explorar os arquivos vinculados.</p>:
           linksLoading?<p className="reviews-muted" role="status"><LoaderCircle size={16} className="rl-spin"/> Carregando pastas do projeto…</p>:
           !links.length?<div className="reviews-empty"><Folder size={26}/><p>Este projeto ainda não possui pastas vinculadas.</p>
            <button className="secondary-button" onClick={()=>{resetComposer();onLibrary();}}>Vincular pasta na Biblioteca</button></div>:
          <>
            <div className="review-folder-tabs">{links.map(l=><button type="button" key={l.id} className={selectedFolder?.id===l.id?"active":""}
              onClick={()=>pickFolder(l)}><Folder size={15}/>{l.folderName} · {l.provider==='dropbox'?'Dropbox':'Drive'}</button>)}</div>
            {selectedFolder&&<div className="review-breadcrumbs">{trail.map((node,i)=><button key={node.id}
              onClick={()=>void browse(selectedFolder,node.id,trail.slice(0,i+1))}>
                {i>0&&<ChevronRight size={12}/>} {node.name}</button>)}</div>}
            {selectedFolder&&<div className="review-file-tools">
              <label className="review-drive-search"><Search size={16}/>
                <input type="search" aria-label="Buscar arquivos na pasta"
                  placeholder="Buscar arquivos nesta pasta" value={fileSearch}
                  onChange={e=>setFileSearch(e.target.value)}/>
                {fileSearch&&<button type="button" aria-label="Limpar busca" onClick={()=>setFileSearch("")}><X size={14}/></button>}
              </label>
              <a className="review-drive-external" target="_blank" rel="noopener noreferrer"
                href={selectedFolder?.provider==='dropbox'?'https://www.dropbox.com/home':
                 "https://drive.google.com/drive/folders/"+encodeURIComponent(activeFolderId)}>
                <ExternalLink size={15}/> Abrir {selectedFolder?.provider==='dropbox'?'Dropbox':'pasta no Drive'}</a>
            </div>}
            {destination&&<div className="review-upload-zone"
              onDragOver={event=>{if(Array.from(event.dataTransfer.types).includes("Files"))event.preventDefault();}}
              onDrop={event=>{if(!Array.from(event.dataTransfer.types).includes("Files"))return;
                event.preventDefault();uploadNew(Array.from(event.dataTransfer.files));}}>
              <label className="secondary-button">Adicionar arquivos do dispositivo
                <input type="file" multiple accept="video/*,image/*,audio/*,application/pdf"
                  onChange={event=>{uploadNew(Array.from(event.target.files||[]));event.target.value="";}}/></label>
              <span>Ou arraste arquivos aqui. Envio direto para o provedor selecionado.</span>
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
              {searchBusy&&<p className="reviews-muted" role="status"><LoaderCircle size={15} className="rl-spin"/> Buscando arquivos na pasta…</p>}
              {!folderBusy&&!searchBusy&&selectedFolder&&!displayedItems.length&&
                <p className="reviews-muted">{fileSearch?"Nenhum arquivo encontrado nesta pasta.":"Esta pasta está vazia."}</p>}
              {displayedItems.map(f=><div className="review-picker-row" key={f.id}>
                {isStorageFolder(f.mimeType)?
                  <button type="button" className="review-picker-main" onClick={()=>{
                    if(selectedFolder)void browse(selectedFolder,f.id,[...trail,{id:f.id,name:f.name}]);}}>
                    <Folder size={19}/><span className="review-picker-name">{f.name}<small>Subpasta</small></span><ChevronRight size={16}/>
                  </button>:
                  <label className={"review-picker-main"+(!supported(f)?" unsupported":"")}>
                    <input type="checkbox" disabled={!supported(f)} aria-label={"Selecionar "+f.name}
                      checked={files.some(a=>a.fileId===f.id&&a.connectionId===selectedFolder?.connectionId)} onChange={()=>addFile(f)}/>
                    {selectedFolder&&user&&<DriveThumbnail item={f} scope={user.uid+":"+selectedFolder.connectionId}
                      getThumbnail={getStorageThumbnail}/>}
                    <span className="review-picker-name" title={f.name}><span>{f.name}</span>
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
          <p className="reviews-muted">Os envios usam a mesma fila segura da Biblioteca. Aguarde a confirmação do provedor antes de compartilhar.</p>
           </>}
         </div>
        <footer className="review-composer-footer">
           <div className="review-composer-footnote" role="status">
             {replacement?
               (pendingUploads.length?"Aguarde a conclusão dos envios.":files.length?"Nova versão pronta para enviar.":"Selecione pelo menos um arquivo para esta versão."):
               composerStep==="details"?
                 (missingDetails.length?missingDetails[0]:"Configuração pronta. Avance para selecionar arquivos."):
                 pendingUploads.length?"Aguarde a conclusão dos envios ao Drive.":
                 files.length?`${files.length} material(is) selecionado(s) · pronto para gerar.`:"Selecione pelo menos um arquivo para gerar a aprovação."}
           </div>
           <div className="review-composer-actions">
             {!replacement&&composerStep==="materials"?
               <button className="secondary-button" disabled={working} onClick={()=>{setComposerStep("details");setError("");composerBodyRef.current?.scrollTo({top:0});}}>
                 <ChevronLeft size={16}/> Voltar
               </button>:
               <button className="secondary-button" disabled={working} onClick={resetComposer}>Cancelar</button>}
             {!replacement&&composerStep==="details"?
               <button className="primary-button" disabled={working} onClick={goToMaterials}>
                 Selecionar materiais <ChevronRight size={16}/>
               </button>:
               <button className="primary-button" disabled={working||pendingUploads.length>0||!files.length}
                 onClick={()=>void submit()}>{working?"Preparando…":replacement?"Enviar nova versão":"Gerar aprovação"} <Send size={16}/></button>}
           </div>
         </footer>
      </section>
    </div>,document.body)}
  </div>;
}
