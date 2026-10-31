import {AppButton} from "../ui/AppButton";
import { AppSelect } from "../ui/AppSelect";
import { FolderActionsMenu } from "./FolderActionsMenu";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, Cloud, FolderOpen, Link2, Plus, RefreshCw, ShieldCheck, Unplug } from "lucide-react";
import { useAuth } from "../auth/AuthProvider";
import { driveFolderLinkId, linkDriveFolder, readDriveLinks, unlinkDriveFolder, type DriveFolderLink } from "../../data/drive-folder-links";
import type { Project } from "../../domain/workspace";
import { DRIVE_FOLDER, DriveFileExplorer, StorageFolderPicker, DrivePreview, DriveUnlinkConfirm, driveFileUrl, isPreviewable, type DriveItem, type DriveTrail } from "./DriveLibraryUI";
import {clearDriveThumbnailCache} from "./DriveThumbnail";
import {useDriveThumbnailFetch} from "./useDriveThumbnailFetch";
import {cacheKey,getCachedFolder,setCachedFolder,clearDriveFolderCache} from "./storage-folder-cache";
import type {UploadDestination} from "./useDriveUploads";
import {useDriveTransfers} from "./DriveTransfersProvider";
import {useDriveApi,messages} from "./drive-api";
import {useStorageConnections} from "./StorageConnectionsProvider";
import {invalidateStorageConnection} from "./storage-image-cache";
import type {UploadedFile} from "./drive-upload-client";
import "./drive-library.css";

const API = "https://roteiva-api-dev.ewertonmendes9.workers.dev";
const READ = "https://www.googleapis.com/auth/drive.readonly";
const INTENT = "roteiva-drive-folder-project";
type Connection = {id:string;google_email:string;status:"connected"|"reconnect_required"|"revocation_pending";scopes:string};
type FolderPage = {folders:DriveItem[];nextPageToken:string|null;incompleteSearch?:boolean};
type FilePage = {folder:{id:string;name:string};files:DriveItem[];nextPageToken:string|null;incompleteSearch?:boolean};


function oauthError(code:string|null):string {
  if (!code||code==="connected"||code==="cancelled")return "";
  return messages[code] || messages.connection_failed;
}


export function DriveConnectionPanel({
  projects,selectedProjectId,onSelectProject,onLinkedFolderCountChange,
}:{
  projects:readonly Project[];
  selectedProjectId?:number;
  onSelectProject:(id:string)=>void;
  onLinkedFolderCountChange?:(count:number)=>void;
}) {
  const {user}=useAuth();
  const [connections,setConnections]=useState<Connection[]>([]);
  const [links,setLinks]=useState<DriveFolderLink[]>([]);
  const [ready,setReady]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [linkError,setLinkError]=useState("");
  const [linksLoaded,setLinksLoaded]=useState(false);
  const [accountFailed,setAccountFailed]=useState(false);
  const [result,setResult]=useState("");
  const [confirmId,setConfirmId]=useState("");
  const [picker,setPicker]=useState(false);
  const [trail,setTrail]=useState<DriveTrail[]>([{id:"root",name:"Meu Drive"}]);
  const [folderList,setFolderList]=useState<DriveItem[]>([]);
  const [folderPage,setFolderPage]=useState<string|null>(null);
  const [folderBusy,setFolderBusy]=useState(false);
  const [viewing,setViewing]=useState<DriveFolderLink|null>(null);
  const [files,setFiles]=useState<DriveItem[]>([]);
  const [viewPath,setViewPath]=useState<DriveTrail[]>([]);
  const [filePage,setFilePage]=useState<string|null>(null);
  const [fileBusy,setFileBusy]=useState(false);
  const [searchText,setSearchText]=useState("");
  const [remote,setRemote]=useState<{term:string;folderId:string;files:DriveItem[];page:string|null}|null>(null);
  const [searchBusy,setSearchBusy]=useState(false);
  const searchRequest=useRef(0);
  const previousScope=useRef("");
  const [preview,setPreview]=useState<DriveItem|null>(null);
  const [unlinkTarget,setUnlinkTarget]=useState<DriveFolderLink|null>(null);
  const [selectedAccount,setSelectedAccount]=useState("");
  const [rootMode,setRootMode]=useState<"root"|"all">("root");
  const folderRequest=useRef(0);
  const fileRequest=useRef(0);
  const autoOpened=useRef("");
  const countCallback=useRef(onLinkedFolderCountChange);
  countCallback.current=onLinkedFolderCountChange;
  const connected=connections.filter(c=>c.status==="connected");
  const authorized=connected.filter(c=>c.scopes.split(/\s+/).includes(READ));
  const connection=authorized.find(c=>c.id===selectedAccount)||authorized[0];
  const relevant=selectedProjectId?links.filter(l=>l.projectId===selectedProjectId):links;
  const getThumbnail=useDriveThumbnailFetch();

  useEffect(()=>{
    if(!user?.uid || (ready&&!connection)){
      if(previousScope.current){
        clearDriveThumbnailCache();clearDriveFolderCache();
        ++fileRequest.current;++searchRequest.current;
        setRemote(null);
      }
      previousScope.current="";
      return;
    }
    if(!connection?.id)return; // OAuth metadata still loading; preserve session cache.
    const scope=user.uid+":"+connection.id;
    if(previousScope.current&&previousScope.current!==scope){
      clearDriveThumbnailCache();clearDriveFolderCache();
      ++fileRequest.current;++searchRequest.current;
      setRemote(null);
    }
    previousScope.current=scope;
  },[user?.uid,connection?.id,ready]);

  const callback=new URLSearchParams(window.location.search).get("drive");

  const call=useDriveApi();

  const onUploadComplete=useCallback((uploaded:UploadedFile,dest:UploadDestination)=>{
    if(!user)return;
    if(viewing?.connectionId!==dest.connectionId||viewing.projectId!==dest.projectId||
       (viewPath.at(-1)?.id||viewing.folderId)!==dest.targetFolderId)return;
    const item:DriveItem={id:uploaded.id,name:uploaded.name,mimeType:uploaded.mimeType,
      size:uploaded.size,webViewLink:uploaded.webViewLink,thumbnailTicket:uploaded.thumbnailTicket,modifiedTime:uploaded.modifiedTime};
    setFiles(previous=>[item,...previous.filter(existing=>existing.id!==item.id)]);
    setRemote(previous=>{
      if(!previous||previous.folderId!==dest.targetFolderId||
         !item.name.toLocaleLowerCase("pt-BR").includes(previous.term.toLocaleLowerCase("pt-BR")))return previous;
      return {...previous,files:[item,...previous.files.filter(existing=>existing.id!==item.id)]};
    });
  },[user?.uid,viewing?.id,viewing?.connectionId,viewing?.projectId,viewing?.folderId,viewPath]);
  const uploads=useDriveTransfers();
  useEffect(()=>uploads.subscribe(onUploadComplete),[uploads.subscribe,onUploadComplete]);
  function uploadFiles(chosen:File[]){
    if(!viewing||!user||!viewPath.length)return;
    const destination:UploadDestination={
      connectionId:viewing.connectionId,linkedFolderId:viewing.folderId,
      targetFolderId:viewPath.at(-1)?.id||viewing.folderId,
      projectId:viewing.projectId,folderName:viewPath.at(-1)?.name||viewing.folderName,
    };
    const {rejected}=uploads.enqueue(chosen,destination);
    setError(rejected?rejected+" arquivo(s) não foram adicionados. Confira os tamanhos e o limite de 100 arquivos na fila.":"");
  }

  const refresh=useCallback(async(force=false)=>{
    if(!user)return [];
    setLinkError("");
    // Connection and folder links have independent failure boundaries.
    const linksRequest=readDriveLinks(user.uid)
      .then(folders=>{setLinks(folders);setLinksLoaded(true);})
      .catch(()=>{setLinksLoaded(false);setLinkError("Não foi possível atualizar as pastas vinculadas. Tente atualizar novamente.");});
    let accounts:{connections:Connection[]};
    try{const state=await storage.refresh(force);accounts={connections:state.drive.map(c=>({id:c.id,google_email:c.email,status:c.status as Connection["status"],scopes:c.scopes}))};}
    catch(cause){setAccountFailed(true);throw cause;}
    finally{void linksRequest;}
    setConnections(accounts.connections);
    setAccountFailed(false);
    return accounts.connections;
  },[storage.refresh,user]);

  useEffect(()=>{
    if(linksLoaded)countCallback.current?.(links.length);
  },[links,linksLoaded]);

  useEffect(()=>{
    let active=true;
    async function init(){
      setReady(false);setError("");
      try{
        await refresh();
        if(!active)return;
        if(callback&&callback!=="connected")sessionStorage.removeItem(INTENT);
      }catch(e){if(active)setError(e instanceof Error?e.message:"Falha ao carregar o Drive.");}
      finally{if(active)setReady(true);}
    }
    void init();
    return ()=>{active=false;};
    // Do not re-initialize on selection changes; identity owns the integration.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[user?.uid]);

  useEffect(()=>{
    if(!ready||callback!=="connected")return;
    const pending=sessionStorage.getItem(INTENT);
    if(!pending)return;
    if(projects.some(p=>String(p.id)===pending)&&authorized.length){
      sessionStorage.removeItem(INTENT);onSelectProject(pending);setPicker(true);
    }
  },[ready,callback,projects,authorized.length,onSelectProject]);

  async function connect(projectId?:number){
    setError("");setResult("");setBusy(true);
    try{
      if(projectId&&Number.isSafeInteger(projectId))sessionStorage.setItem(INTENT,String(projectId));
      else sessionStorage.removeItem(INTENT);
      const {launchUrl}=await call<{launchUrl:string}>("/oauth/drive/start","POST");
      const url=new URL(launchUrl);
      if(url.origin!==API||url.pathname!=="/oauth/drive/launch")throw new Error("Resposta do Google inválida.");
      window.location.assign(url.toString());
    }catch(e){
      sessionStorage.removeItem(INTENT);
      setError(e instanceof Error?e.message:"Não foi possível conectar.");setBusy(false);
    }
  }

  async function browse(parent:string,nextTrail:DriveTrail[],pageToken?:string|null,append=false,mode:"root"|"all"=rootMode){
    if(!connection)return;
    const requestId=++folderRequest.current;
    setFolderBusy(true);setError("");
    if(!append){setFolderList([]);setFolderPage(null);setTrail(nextTrail);}
    try{
      const params=new URLSearchParams({parentId:parent});
      if(pageToken)params.set("pageToken",pageToken);
      const data=await call<FolderPage>("/integrations/drive/"+encodeURIComponent(connection.id)+"/folders?"+params);
      if(requestId!==folderRequest.current)return;
      setFolderList(old=>append?[...old,...data.folders]:data.folders);
      setFolderPage(data.nextPageToken);setTrail(nextTrail);setRootMode(mode);
      if(data.incompleteSearch)setResult("O Google informou que alguns resultados podem estar incompletos.");
    }catch(e){if(requestId===folderRequest.current)setError(e instanceof Error?e.message:"Não foi possível abrir a pasta.");}
    finally{if(requestId===folderRequest.current)setFolderBusy(false);}
  }

  function closePicker(){++folderRequest.current;setPicker(false);setError("");}
  function chooseFolders(){
    setError("");
    if(!connected.length){void connect(selectedProjectId);return;}
    setPicker(true);setFolderList([]);setFolderPage(null);
    setTrail([{id:"root",name:"Meu Drive"}]);setRootMode("root");
  }
  useEffect(()=>{
    if(picker&&connection&&selectedProjectId)void browse("root",[{id:"root",name:"Meu Drive"}],null,false,"root");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[picker,connection?.id,selectedProjectId]);

  async function linkFolders(items:DriveItem[]):Promise<boolean>{
    if(!user||!selectedProjectId||!connection)return false;
    setBusy(true);setError("");
    const failed:string[]=[];
    let completed=0;
    for(const folder of items){
      if(links.some(l=>l.connectionId===connection.id&&l.projectId===selectedProjectId&&l.folderId===folder.id))continue;
      try{
        await linkDriveFolder(user.uid,selectedProjectId,connection.id,folder);
        const link:DriveFolderLink={id:driveFolderLinkId(selectedProjectId,connection.id,folder.id),
          projectId:selectedProjectId,connectionId:connection.id,folderId:folder.id,folderName:folder.name};
        setLinks(old=>{
          if(old.some(item=>item.id===link.id))return old;
          return [...old,link];
        });
        completed++;
      }catch{failed.push(folder.name);}
    }
    setBusy(false);
    if(completed)setResult(completed===1?"Pasta vinculada ao projeto.":completed+" pastas vinculadas ao projeto.");
    if(failed.length){setError("Não foi possível vincular: "+failed.join(", ")+". Confira a conexão e tente novamente.");return false;}
    return true;
  }

  async function removeFolder(link:DriveFolderLink){
    if(!user)return;
    setBusy(true);setError("");
    try{
      await unlinkDriveFolder(user.uid,link.id);
      clearDriveFolderCache();
      if(viewing?.id===link.id){++fileRequest.current;setViewing(null);setFiles([]);autoOpened.current="";}
      setLinks(old=>old.filter(l=>l.id!==link.id));
      setUnlinkTarget(null);setResult("Vínculo removido. Nenhum arquivo foi apagado do Drive.");
    }catch(e){setError(e instanceof Error?e.message:"Não foi possível desvincular.");}
    finally{setBusy(false);}
  }

  async function openFiles(link:DriveFolderLink,token?:string|null,append=false,
    folderId=link.folderId,nextPath:DriveTrail[]=[{id:link.folderId,name:link.folderName}]){
    if(!user)return;
    const requestId=++fileRequest.current;
    const key=cacheKey(user.uid,link.connectionId,folderId,"",token||"");
    const cached=!append?getCachedFolder(key):undefined;
    setFileBusy(!cached);setError("");
    if(!append){
      ++searchRequest.current;
      setSearchText("");setRemote(null);setSearchBusy(false);
      setViewing(link);setViewPath(nextPath);
      setFiles(cached?.files||[]);setFilePage(cached?.nextPageToken||null);
    }
    try{
      // Fresh results render instantly. Revalidate older entries in the background.
      if(cached&&Date.now()-cached.fetchedAt<30_000)return;
      const qs=token?"?pageToken="+encodeURIComponent(token):"";
      const data=await call<FilePage>("/integrations/drive/"+encodeURIComponent(link.connectionId)+
        "/folders/"+encodeURIComponent(folderId)+"/items"+qs);
      if(requestId!==fileRequest.current)return;
      setCachedFolder(key,{files:data.files,nextPageToken:data.nextPageToken});
      setViewing(link);setViewPath(nextPath);
      setFiles(old=>append?[...old,...data.files]:data.files);
      setFilePage(data.nextPageToken);
      if(data.incompleteSearch)setResult("O Google informou que alguns resultados podem estar incompletos.");
    }catch(e){
      if(requestId!==fileRequest.current)return;
      const code=(e as {code?:string}).code;
      if(code==="connection_not_found"||code==="reconnect_required"||code==="drive_permission_denied"||
        code==="authentication_required"||code==="invalid_identity"||code==="drive_folder_not_found"){
        clearDriveFolderCache();setFiles([]);setFilePage(null);
      }
      setError(e instanceof Error?e.message:"Não foi possível visualizar os arquivos.");
    }finally{if(requestId===fileRequest.current)setFileBusy(false);}
  }

  useEffect(()=>{
    const folderId=viewPath.at(-1)?.id||viewing?.folderId;
    const term=searchText.trim();
    const requestId=++searchRequest.current;
    setRemote(null);setSearchBusy(false);
    if(!user||!viewing||!folderId||term.length<2)return;
    const owner=user.uid,account=viewing.connectionId;
    const timer=window.setTimeout(async()=>{
      const key=cacheKey(owner,account,folderId,term);
      const cached=getCachedFolder(key);
      if(cached){
        if(requestId===searchRequest.current)setRemote({term,folderId,files:cached.files,page:cached.nextPageToken});
        if(Date.now()-cached.fetchedAt<30_000)return;
      }
      if(requestId===searchRequest.current)setSearchBusy(true);
      try{
        const qs=new URLSearchParams({search:term});
        const response=await call<FilePage>("/integrations/drive/"+encodeURIComponent(account)+
          "/folders/"+encodeURIComponent(folderId)+"/items?"+qs);
        if(requestId!==searchRequest.current)return;
        setCachedFolder(key,{files:response.files,nextPageToken:response.nextPageToken});
        setRemote({term,folderId,files:response.files,page:response.nextPageToken});
      }catch(e){
        if(requestId===searchRequest.current)setError(e instanceof Error?e.message:"Falha na busca.");
      }finally{if(requestId===searchRequest.current)setSearchBusy(false);}
    },280);
    return ()=>window.clearTimeout(timer);
  },[searchText,viewing?.id,viewPath,call,user?.uid]);
  
  async function loadMoreSearch(){
    if(!viewing||!user||!remote?.page||searchBusy)return;
    const current=remote;
    const requestId=searchRequest.current;
    const folderId=current.folderId;
    setSearchBusy(true);
    try{
      const params=new URLSearchParams({search:current.term,pageToken:current.page!});
      const data=await call<FilePage>("/integrations/drive/"+encodeURIComponent(viewing.connectionId)+
        "/folders/"+encodeURIComponent(folderId)+"/items?"+params);
      if(requestId!==searchRequest.current)return;
      setRemote({...current,files:[...current.files,...data.files],page:data.nextPageToken});
    }catch(e){if(requestId===searchRequest.current)setError(e instanceof Error?e.message:"Falha na busca.");}
    finally{if(requestId===searchRequest.current)setSearchBusy(false);}
  }

  useEffect(()=>{
    ++fileRequest.current;setViewing(null);setFiles([]);autoOpened.current="";
  },[selectedProjectId]);

  useEffect(()=>{
    if(!ready||!relevant.length||viewing)return;
    const first=relevant[0];
    const key=(selectedProjectId||"all")+":"+first.id;
    if(autoOpened.current===key)return;
    autoOpened.current=key;
    void openFiles(first);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[ready,links,selectedProjectId,connection?.id,viewing]);

  async function disconnect(id:string){
    uploads.cancelAll(id);
    setBusy(true);setError("");
    try{
      await call("/integrations/drive/"+encodeURIComponent(id)+"/disconnect","POST");
      if(user)await invalidateStorageConnection(user.uid,"google_drive",id);
      clearDriveThumbnailCache();clearDriveFolderCache();
      setConfirmId("");setPicker(false);setViewing(null);++fileRequest.current;
      await refresh(true);
      setResult("Conta desconectada. Seus arquivos permanecem no Google Drive.");
    }catch(e){setError(e instanceof Error?e.message:"Não foi possível desconectar.");}
    finally{setBusy(false);}
  }
  function openItem(file:DriveItem){
    if(!viewing)return;
    if(file.mimeType===DRIVE_FOLDER){void openFiles(viewing,null,false,file.id,[...viewPath,{id:file.id,name:file.name}]);return;}
    if(isPreviewable(file)){setPreview(file);return;}
    window.open(driveFileUrl(file),"_blank","noopener,noreferrer");
  }

  const linkedIds=new Set(links.filter(link=>link.projectId===selectedProjectId&&link.connectionId===connection?.id).map(link=>link.folderId));
  const currentAccount=connection||connected.find(c=>c.id===selectedAccount)||connected[0];
  return <section className="rl-library" aria-label="Biblioteca Google Drive">
    <header className="rl-toolbar">
      <div className="rl-title"><span className="rl-title-icon"><FolderOpen size={20}/></span><div><h2>Arquivos dos projetos</h2><p>Explore as pastas vinculadas ao seu Google Drive.</p></div></div>
      <div className="rl-toolbar-actions">
        {connected.length?<details className="rl-account"><summary aria-label="Gerenciar Google Drive"><ShieldCheck size={16}/><span className="rl-account-text">Drive conectado</span><ChevronDown size={14}/></summary>
          <div className="rl-account-panel"><div><strong>Google Drive conectado</strong><p>{currentAccount?.google_email}</p></div>
            {authorized.length>1&&<AppSelect aria-label="Selecionar conta Google Drive" value={connection?.id||""} onValueChange={value=>setSelectedAccount(value)}>
              {authorized.map(c=><option key={c.id} value={c.id}>{c.google_email}</option>)}</AppSelect>}
            <AppButton className="secondary-button" type="button" disabled={busy} onClick={()=>void refresh(true).catch(e=>setError(e instanceof Error?e.message:"Não foi possível atualizar."))}><RefreshCw size={15}/> Atualizar conexão</AppButton>
            {confirmId?<><p>Desconectar esta conta? As pastas vinculadas não serão apagadas.</p>
              <AppButton className="secondary-button" type="button" disabled={busy} onClick={()=>setConfirmId("")}>Cancelar</AppButton>
              <AppButton className="secondary-button" type="button" disabled={busy} onClick={()=>void disconnect(confirmId)}><Unplug size={15}/> Confirmar desconexão</AppButton></>:
              <AppButton className="secondary-button" type="button" disabled={busy} onClick={()=>setConfirmId(currentAccount?.id||"")}><Unplug size={15}/> Desconectar</AppButton>}
          </div></details>:null}
        <AppButton className="primary-button" type="button" disabled={!ready||busy||accountFailed} onClick={chooseFolders}><Plus size={16}/>{connected.length?"Vincular pasta":"Conectar Drive"}</AppButton>
      </div>
    </header>
    {!ready?<div className="rl-status" role="status">Carregando Biblioteca…</div>:null}
    {callback==="connected"&&<div className="rl-status" role="status"><ShieldCheck size={17}/><p>Google Drive autorizado.</p></div>}
    {callback==="cancelled"&&<div className="rl-status" role="status">Autorização cancelada.</div>}
    {oauthError(callback)&&<div className="rl-status" role="alert">{oauthError(callback)}</div>}
    {error&&<div className="rl-status" role="alert"><p>{error}</p>{accountFailed&&<AppButton className="rl-retry" type="button" onClick={()=>void refresh().catch(e=>setError(e instanceof Error?e.message:"Falha ao atualizar."))}>Tentar novamente</AppButton>}</div>}
    {linkError&&<div className="rl-status" role="alert"><p>{linkError}</p><AppButton className="rl-retry" type="button" onClick={()=>void refresh().catch(e=>setError(e instanceof Error?e.message:"Falha ao atualizar."))}>Atualizar</AppButton></div>}
    {result&&<div className="rl-status" role="status">{result}</div>}
    {ready&&!connected.length&&!accountFailed?<div className="rl-status"><Cloud size={18}/><p>Conecte sua conta Google para escolher pastas dos projetos. Os arquivos continuarão armazenados no seu Drive.</p></div>:null}
    {ready&&connected.length>0&&!authorized.length?<div className="rl-status" role="alert"><p>É necessário autorizar a leitura das pastas existentes.</p><AppButton type="button" className="rl-retry" onClick={()=>void connect(selectedProjectId)}>Autorizar acesso</AppButton></div>:null}
    <div className="rl-explorer" data-mobile-detail={!!viewing}>
      <aside className="rl-folders" aria-label="Pastas vinculadas">
        <div className="rl-folders-header"><h3>Pastas {selectedProjectId?"do projeto":"dos projetos"}</h3><small>{relevant.length}</small></div>
        <div className="rl-folder-list">
          {relevant.map(link=><div className="rl-folder-entry" data-active={viewing?.id===link.id} key={link.id}>
            <AppButton className="rl-folder-button" type="button" title={link.folderName} onClick={()=>void openFiles(link)} aria-current={viewing?.id===link.id?"true":undefined}>
              <FolderOpen size={18}/><span><b>{link.folderName}</b><small>{projects.find(p=>p.id===link.projectId)?.name||"Projeto indisponível"}</small></span>
            </AppButton>
            <FolderActionsMenu name={link.folderName} disabled={busy}
              onOpen={()=>void openFiles(link)} onUnlink={()=>setUnlinkTarget(link)}/>
          </div>)}
          {!relevant.length&&<div className="rl-state"><FolderOpen size={27}/><p>Nenhuma pasta vinculada {selectedProjectId?"a este projeto":"aos projetos"}.</p>
            <AppButton type="button" className="secondary-button" disabled={!ready||busy} onClick={chooseFolders}>Vincular pasta</AppButton></div>}
        </div>
      </aside>
      <DriveFileExplorer folderName={viewing?.folderName} path={viewPath} files={files} loading={fileBusy} hasMore={searchText.trim().length>=2
          ? (remote&&searchText.trim()===remote.term?!!remote.page:false)
          : !!filePage}
        thumbnailScope={(user?.uid||"")+":"+(viewing?.connectionId||connection?.id||"")} getThumbnail={getThumbnail}
        searchResults={remote?.folderId===(viewPath.at(-1)?.id||viewing?.folderId)?remote?.files:undefined}
        searchTerm={remote?.term} searchLoading={searchBusy} onSearchChange={setSearchText}
        onBack={()=>{++fileRequest.current;setViewing(null);setFiles([]);autoOpened.current=(selectedProjectId||"all")+":"+(relevant[0]?.id||"");}}
        onNavigate={(id,path)=>{if(viewing)void openFiles(viewing,null,false,id,path);}}
        onOpen={openItem} onUploadFiles={uploadFiles} uploadDisabled={!viewing||!user||fileBusy} onMore={()=>{
          if(remote&&searchText.trim()===remote.term){void loadMoreSearch();}
          else if(viewing&&filePage)void openFiles(viewing,filePage,true,viewPath.at(-1)?.id||viewing.folderId,viewPath);
        }}/>
    </div>
    {picker&&<StorageFolderPicker projects={projects} projectId={selectedProjectId} onProjectChange={onSelectProject}
      folders={folderList} path={trail} loading={folderBusy} working={busy} canRead={!!connection}
      hasMore={!!folderPage} mode={rootMode} onModeChange={mode=>void browse(mode,[{id:mode,name:mode==="root"?"Meu Drive":"Todas as pastas"}],null,false,mode)} linkedIds={linkedIds} error={error} onClose={closePicker}
      onNavigate={(id,path)=>void browse(id,path)} onMore={()=>void browse(trail.at(-1)?.id||"root",trail,folderPage,true)}
      onLink={linkFolders} onConnect={()=>void connect(selectedProjectId)}/>}
    {preview&&<DrivePreview item={preview} onClose={()=>setPreview(null)}
      position={files.filter(isPreviewable).findIndex(file=>file.id===preview.id)+1}
      total={files.filter(isPreviewable).length}
      onPrevious={(()=>{const list=files.filter(isPreviewable);const index=list.findIndex(file=>file.id===preview.id);return index>0?()=>setPreview(list[index-1]):undefined;})()}
      onNext={(()=>{const list=files.filter(isPreviewable);const index=list.findIndex(file=>file.id===preview.id);return index>=0&&index<list.length-1?()=>setPreview(list[index+1]):undefined;})()}/>} 
    {unlinkTarget&&<DriveUnlinkConfirm name={unlinkTarget.folderName} busy={busy} onCancel={()=>setUnlinkTarget(null)} onConfirm={()=>void removeFolder(unlinkTarget)}/>}
  </section>;
}
