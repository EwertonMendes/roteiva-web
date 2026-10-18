import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, Cloud, FolderOpen, Link2, MoreHorizontal, Plus, RefreshCw, ShieldCheck, Unplug } from "lucide-react";
import { useAuth } from "../auth/AuthProvider";
import { driveFolderLinkId, linkDriveFolder, readDriveLinks, unlinkDriveFolder, type DriveFolderLink } from "../../data/drive-folder-links";
import type { Project } from "../../domain/workspace";
import { DRIVE_FOLDER, DriveFileExplorer, DriveFolderPicker, DrivePreview, DriveUnlinkConfirm, driveFileUrl, isPreviewable, type DriveItem, type DriveTrail } from "./DriveLibraryUI";
import "./drive-library.css";

const API = "https://roteiva-api-dev.ewertonmendes9.workers.dev";
const READ = "https://www.googleapis.com/auth/drive.readonly";
const INTENT = "roteiva-drive-folder-project";
type Connection = {id:string;google_email:string;status:"connected"|"reconnect_required"|"revocation_pending";scopes:string};
type FolderPage = {folders:DriveItem[];nextPageToken:string|null;incompleteSearch?:boolean};
type FilePage = {folder:{id:string;name:string};files:DriveItem[];nextPageToken:string|null;incompleteSearch?:boolean};
const messages:Record<string,string> = {
  oauth_not_configured:"A integração do Drive ainda não está disponível neste ambiente.",
  reconnect_required:"Sua autorização expirou. Conecte novamente.",
  offline_access_unavailable:"O Google não forneceu acesso contínuo. Revise as permissões do Roteiva na Conta Google e tente novamente.",
  drive_permission_missing:"O acesso solicitado ao Drive não foi autorizado.",
  drive_read_permission_missing:"Para escolher pastas existentes, o Google precisa autorizar a leitura do Drive. Tente conectar novamente e aceite a permissão.",
  invalid_identity:"Entre novamente no Roteiva para continuar.",
  authentication_required:"Entre novamente no Roteiva para continuar.",
  rate_limited:"Muitas solicitações. Aguarde um instante.",
  drive_unavailable:"O Google Drive não respondeu. Tente novamente.",
  google_unavailable:"Não foi possível contatar o Google. Tente novamente em instantes.",
  drive_transport_failed:"A consulta de arquivos ao Google Drive falhou na rede. Tente novamente em instantes.",
  drive_transport_timeout:"O Google Drive demorou demais para responder. Tente novamente.",
  drive_redirect_invalid:"O Google Drive retornou um redirecionamento inválido. A equipe precisa verificar o serviço.",
  drive_redirect_denied:"O Google Drive retornou um redirecionamento não autorizado. A operação foi bloqueada por segurança.",
  google_token_transport_failed:"Não foi possível renovar o acesso pelo serviço de autenticação do Google. Tente novamente em instantes.",
  google_token_timeout:"O serviço de autenticação do Google demorou demais para responder. Tente novamente.",
  google_token_upstream_failed:"O serviço de autenticação do Google retornou uma resposta inesperada. A equipe precisa verificar a integração.",
  google_token_redirect_blocked:"A autenticação do Google retornou um redirecionamento não esperado. A solicitação foi interrompida para proteger sua conta.",
  google_temporarily_unavailable:"O Google está temporariamente indisponível. Tente novamente em instantes.",
  google_oauth_client_invalid:"A autorização Google do Roteiva precisa de correção no servidor. Seus vínculos foram preservados.",
  google_oauth_request_invalid:"O servidor do Roteiva não conseguiu renovar a autorização Google. A equipe precisa revisar a configuração.",
  google_oauth_rejected:"O Google recusou a renovação da conexão. A configuração precisa ser verificada antes de tentar novamente.",
  token_refresh_retry_later:"A conexão com o Google está temporariamente ocupada. Aguarde alguns segundos e tente novamente.",
  token_refresh_busy:"A conexão com o Google está processando outra solicitação. Aguarde alguns segundos.",
  google_rate_limited:"O Google limitou temporariamente as solicitações. Aguarde e tente novamente.",
  drive_folder_not_found:"Pasta indisponível ou sem permissão.",
  invalid_google_response:"Não foi possível interpretar os dados do Drive.",
  connection_changed:"A conexão foi alterada. Atualize para continuar.",
  connection_failed:"Não foi possível concluir a conexão. Tente novamente.",
};

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
  const callback=new URLSearchParams(window.location.search).get("drive");

  const call=useCallback(async <T,>(path:string,method:"GET"|"POST"="GET"):Promise<T>=>{
    if(!user)throw new Error("Entre novamente no Roteiva.");
    let response:Response|undefined;
    for(let i=0;i<2;i++){
      const token=await user.getIdToken(i===1);
      response=await fetch(API+path,{method,headers:{Authorization:"Bearer "+token},cache:"no-store"});
      if(response.status!==401)break;
    }
    if(!response?.ok){
      const payload=await response?.json().catch(()=>({})) as {error?:{code?:string}}|undefined;
      throw new Error(messages[payload?.error?.code||""]||"Não foi possível concluir a operação.");
    }
    return response.json() as Promise<T>;
  },[user]);

  const refresh=useCallback(async()=>{
    if(!user)return [];
    setLinkError("");
    // Connection and folder links have independent failure boundaries.
    const linksRequest=readDriveLinks(user.uid)
      .then(folders=>{setLinks(folders);countCallback.current?.(folders.length);})
      .catch(()=>setLinkError("Não foi possível atualizar as pastas vinculadas. Tente atualizar novamente."));
    let accounts:{connections:Connection[]};
    try{accounts=await call<{connections:Connection[]}>("/integrations/drive");}
    catch(cause){setAccountFailed(true);throw cause;}
    finally{void linksRequest;}
    setConnections(accounts.connections);
    setAccountFailed(false);
    return accounts.connections;
  },[call,user]);

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
          const next=[...old,link];countCallback.current?.(next.length);return next;
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
      if(viewing?.id===link.id){++fileRequest.current;setViewing(null);setFiles([]);autoOpened.current="";}
      setLinks(old=>{const next=old.filter(l=>l.id!==link.id);countCallback.current?.(next.length);return next;});
      setUnlinkTarget(null);setResult("Vínculo removido. Nenhum arquivo foi apagado do Drive.");
    }catch(e){setError(e instanceof Error?e.message:"Não foi possível desvincular.");}
    finally{setBusy(false);}
  }

  async function openFiles(link:DriveFolderLink,token?:string|null,append=false,folderId=link.folderId,nextPath:DriveTrail[]=[{id:link.folderId,name:link.folderName}]){
    const requestId=++fileRequest.current;
    setFileBusy(true);setError("");
    if(!append){setViewing(link);setViewPath(nextPath);setFiles([]);setFilePage(null);}
    try{
      const qs=token?"?pageToken="+encodeURIComponent(token):"";
      const data=await call<FilePage>("/integrations/drive/"+encodeURIComponent(link.connectionId)+"/folders/"+encodeURIComponent(folderId)+"/items"+qs);
      if(requestId!==fileRequest.current)return;
      setViewing(link);setViewPath(nextPath);
      setFiles(old=>append?[...old,...data.files]:data.files);
      setFilePage(data.nextPageToken);
      if(data.incompleteSearch)setResult("O Google informou que alguns resultados podem estar incompletos.");
    }catch(e){if(requestId===fileRequest.current)setError(e instanceof Error?e.message:"Não foi possível visualizar os arquivos.");}
    finally{if(requestId===fileRequest.current)setFileBusy(false);}
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
    setBusy(true);setError("");
    try{
      await call("/integrations/drive/"+encodeURIComponent(id)+"/disconnect","POST");
      setConfirmId("");setPicker(false);setViewing(null);++fileRequest.current;
      await refresh();
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
            {authorized.length>1&&<select aria-label="Selecionar conta Google Drive" value={connection?.id||""} onChange={e=>setSelectedAccount(e.target.value)}>
              {authorized.map(c=><option key={c.id} value={c.id}>{c.google_email}</option>)}</select>}
            <button className="secondary-button" type="button" disabled={busy} onClick={()=>void refresh().catch(e=>setError(e instanceof Error?e.message:"Não foi possível atualizar."))}><RefreshCw size={15}/> Atualizar conexão</button>
            {confirmId?<><p>Desconectar esta conta? As pastas vinculadas não serão apagadas.</p>
              <button className="secondary-button" type="button" disabled={busy} onClick={()=>setConfirmId("")}>Cancelar</button>
              <button className="secondary-button" type="button" disabled={busy} onClick={()=>void disconnect(confirmId)}><Unplug size={15}/> Confirmar desconexão</button></>:
              <button className="secondary-button" type="button" disabled={busy} onClick={()=>setConfirmId(currentAccount?.id||"")}><Unplug size={15}/> Desconectar</button>}
          </div></details>:null}
        <button className="primary-button" type="button" disabled={!ready||busy||accountFailed} onClick={chooseFolders}><Plus size={16}/>{connected.length?"Vincular pasta":"Conectar Drive"}</button>
      </div>
    </header>
    {!ready?<div className="rl-status" role="status">Carregando Biblioteca…</div>:null}
    {callback==="connected"&&<div className="rl-status" role="status"><ShieldCheck size={17}/><p>Google Drive autorizado.</p></div>}
    {callback==="cancelled"&&<div className="rl-status" role="status">Autorização cancelada.</div>}
    {oauthError(callback)&&<div className="rl-status" role="alert">{oauthError(callback)}</div>}
    {error&&<div className="rl-status" role="alert"><p>{error}</p>{accountFailed&&<button className="rl-retry" type="button" onClick={()=>void refresh().catch(e=>setError(e instanceof Error?e.message:"Falha ao atualizar."))}>Tentar novamente</button>}</div>}
    {linkError&&<div className="rl-status" role="alert"><p>{linkError}</p><button className="rl-retry" type="button" onClick={()=>void refresh().catch(e=>setError(e instanceof Error?e.message:"Falha ao atualizar."))}>Atualizar</button></div>}
    {result&&<div className="rl-status" role="status">{result}</div>}
    {ready&&!connected.length&&!accountFailed?<div className="rl-status"><Cloud size={18}/><p>Conecte sua conta Google para escolher pastas dos projetos. Os arquivos continuarão armazenados no seu Drive.</p></div>:null}
    {ready&&connected.length>0&&!authorized.length?<div className="rl-status" role="alert"><p>É necessário autorizar a leitura das pastas existentes.</p><button type="button" className="rl-retry" onClick={()=>void connect(selectedProjectId)}>Autorizar acesso</button></div>:null}
    <div className="rl-explorer" data-mobile-detail={!!viewing}>
      <aside className="rl-folders" aria-label="Pastas vinculadas">
        <div className="rl-folders-header"><h3>Pastas {selectedProjectId?"do projeto":"dos projetos"}</h3><small>{relevant.length}</small></div>
        <div className="rl-folder-list">
          {relevant.map(link=><div className="rl-folder-entry" data-active={viewing?.id===link.id} key={link.id}>
            <button className="rl-folder-button" type="button" title={link.folderName} onClick={()=>void openFiles(link)} aria-current={viewing?.id===link.id?"true":undefined}>
              <FolderOpen size={18}/><span><b>{link.folderName}</b><small>{projects.find(p=>p.id===link.projectId)?.name||"Projeto indisponível"}</small></span>
            </button>
            <details className="rl-menu"><summary aria-label={"Opções da pasta "+link.folderName}><MoreHorizontal size={18}/></summary>
              <div className="rl-menu-items"><button type="button" onClick={()=>void openFiles(link)}>Abrir pasta</button>
                <button type="button" disabled={busy} onClick={()=>setUnlinkTarget(link)}>Desvincular do projeto</button>
              </div></details>
          </div>)}
          {!relevant.length&&<div className="rl-state"><FolderOpen size={27}/><p>Nenhuma pasta vinculada {selectedProjectId?"a este projeto":"aos projetos"}.</p>
            <button type="button" className="secondary-button" disabled={!ready||busy} onClick={chooseFolders}>Vincular pasta</button></div>}
        </div>
      </aside>
      <DriveFileExplorer folderName={viewing?.folderName} path={viewPath} files={files} loading={fileBusy} hasMore={!!filePage}
        onBack={()=>{++fileRequest.current;setViewing(null);setFiles([]);autoOpened.current=(selectedProjectId||"all")+":"+(relevant[0]?.id||"");}}
        onNavigate={(id,path)=>{if(viewing)void openFiles(viewing,null,false,id,path);}}
        onOpen={openItem} onMore={()=>{if(viewing&&filePage)void openFiles(viewing,filePage,true,viewPath.at(-1)?.id||viewing.folderId,viewPath);}}/>
    </div>
    {picker&&<DriveFolderPicker projects={projects} projectId={selectedProjectId} onProjectChange={onSelectProject}
      folders={folderList} path={trail} loading={folderBusy} working={busy} canRead={!!connection}
      hasMore={!!folderPage} mode={rootMode} onModeChange={mode=>void browse(mode,[{id:mode,name:mode==="root"?"Meu Drive":"Todas as pastas"}],null,false,mode)} linkedIds={linkedIds} error={error} onClose={closePicker}
      onNavigate={(id,path)=>void browse(id,path)} onMore={()=>void browse(trail.at(-1)?.id||"root",trail,folderPage,true)}
      onLink={linkFolders} onConnect={()=>void connect(selectedProjectId)}/>}
    {preview&&<DrivePreview item={preview} onClose={()=>setPreview(null)}/>}
    {unlinkTarget&&<DriveUnlinkConfirm name={unlinkTarget.folderName} busy={busy} onCancel={()=>setUnlinkTarget(null)} onConfirm={()=>void removeFolder(unlinkTarget)}/>}
  </section>;
}
