import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, ChevronRight, Cloud, ExternalLink, File, FileAudio, FileImage, FileText, FileVideo, Folder, FolderOpen, Link2, RefreshCw, ShieldCheck, Unplug, X } from "lucide-react";
import { useAuth } from "../auth/AuthProvider";
import { linkDriveFolder, readDriveLinks, unlinkDriveFolder, type DriveFolderLink } from "./drive-folder-links";
import type { Project } from "../../domain/workspace";

const API = "https://roteiva-api-dev.ewertonmendes9.workers.dev";
const READ = "https://www.googleapis.com/auth/drive.readonly";
const INTENT = "roteiva-drive-folder-project";
type Connection = {id:string;google_email:string;status:"connected"|"reconnect_required"|"revocation_pending";scopes:string};
type Item = {id:string;name:string;mimeType:string;size?:string;modifiedTime?:string;webViewLink?:string};
type FolderPage = {folders:Item[];nextPageToken:string|null;incompleteSearch?:boolean};
type FilePage = {folder:{id:string;name:string};files:Item[];nextPageToken:string|null;incompleteSearch?:boolean};
type Trail = {id:string;name:string};
const FOLDER = "application/vnd.google-apps.folder";
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
  google_unavailable:"A conexão com o Google está indisponível no momento.",
  drive_folder_not_found:"Pasta indisponível ou sem permissão.",
  invalid_google_response:"Não foi possível interpretar os dados do Drive.",
  connection_changed:"A conexão foi alterada. Atualize para continuar.",
  connection_failed:"Não foi possível concluir a conexão. Tente novamente.",
};
const kindIcon = (mime:string) => mime===FOLDER?Folder:
  mime.startsWith("video/")?FileVideo:mime.startsWith("image/")?FileImage:
  mime.startsWith("audio/")?FileAudio:mime.includes("pdf")||mime.includes("document")?FileText:File;
const sizeText=(s?:string)=>{
  const n=Number(s);if(!Number.isFinite(n)||n<0)return "";
  return n>=1e9?(n/1e9).toFixed(1)+" GB":n>=1e6?(n/1e6).toFixed(1)+" MB":Math.max(1,Math.ceil(n/1000))+" KB";
};
function oauthError(code:string|null):string {
  if (!code||code==="connected"||code==="cancelled")return "";
  return messages[code] || messages.connection_failed;
}

export function DriveConnectionPanel({
  projects, selectedProjectId, onSelectProject,
}:{
  projects:readonly Project[]; selectedProjectId?:number; onSelectProject:(id:string)=>void;
}) {
  const {user}=useAuth();
  const [connections,setConnections]=useState<Connection[]>([]);
  const [links,setLinks]=useState<DriveFolderLink[]>([]);
  const [ready,setReady]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [result,setResult]=useState("");
  const [confirmId,setConfirmId]=useState("");
  const [picker,setPicker]=useState(false);
  const [trail,setTrail]=useState<Trail[]>([{id:"root",name:"Meu Drive"}]);
  const [folderList,setFolderList]=useState<Item[]>([]);
  const [folderPage,setFolderPage]=useState<string|null>(null);
  const [folderBusy,setFolderBusy]=useState(false);
  const [viewing,setViewing]=useState<DriveFolderLink|null>(null);
  const [files,setFiles]=useState<Item[]>([]);
  const [filePage,setFilePage]=useState<string|null>(null);
  const [fileBusy,setFileBusy]=useState(false);
  const [preview,setPreview]=useState<Item|null>(null);
  const [selectedAccount,setSelectedAccount]=useState("");
  const [rootMode,setRootMode]=useState<"root"|"all">("root");
  const connected=connections.filter(c=>c.status==="connected");
  const authorized=connected.filter(c=>c.scopes.split(/\s+/).includes(READ));
  const connection=authorized.find(c=>c.id===selectedAccount)||authorized[0];
  const relevant=selectedProjectId?links.filter(l=>l.projectId===selectedProjectId):links;
  const thisProject=projects.find(p=>p.id===selectedProjectId);
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
    const [accounts,folders]=await Promise.all([
      call<{connections:Connection[]}>("/integrations/drive"),
      readDriveLinks(user.uid),
    ]);
    setConnections(accounts.connections);setLinks(folders);
    return accounts.connections;
  },[call,user]);

  useEffect(()=>{
    let active=true;
    async function init(){
      setReady(false);setError("");
      try{
        await refresh();
        if(!active)return;
        if (callback && callback!=="connected") sessionStorage.removeItem(INTENT);
      }catch(e){if(active)setError(e instanceof Error?e.message:"Falha ao carregar o Drive.");}
      finally{if(active)setReady(true);}
    }
    void init();
    return ()=>{active=false;};
    // Only initialize when the signed-in identity changes; project changes
    // must not reset the folder chooser or refresh the same data repeatedly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[user?.uid]);

  useEffect(()=>{
    if(!ready || callback!=="connected")return;
    const pending=sessionStorage.getItem(INTENT);
    if(!pending)return;
    if(projects.some(project=>String(project.id)===pending) && authorized.length){
      sessionStorage.removeItem(INTENT);
      onSelectProject(pending);
      setPicker(true);
    }
  },[ready,callback,projects,authorized.length,onSelectProject]);

  async function connect(projectId?:number){
    setError("");setResult("");setBusy(true);
    try {
      if(projectId && Number.isSafeInteger(projectId))sessionStorage.setItem(INTENT,String(projectId));
      else sessionStorage.removeItem(INTENT);
      const {launchUrl}=await call<{launchUrl:string}>("/oauth/drive/start","POST");
      const url=new URL(launchUrl);
      if(url.origin!==API || url.pathname!=="/oauth/drive/launch")throw new Error("Resposta do Google inválida.");
      // Direct navigation creates the secure first-party OAuth cookie.
      window.location.assign(url.toString());
    }catch(e){
      sessionStorage.removeItem(INTENT);
      setError(e instanceof Error?e.message:"Não foi possível conectar.");
      setBusy(false);
    }
  }

  async function browse(parent:string, nextTrail:Trail[],pageToken?:string|null,append=false, mode:"root"|"all"=rootMode){
    if(!connection)return;
    setFolderBusy(true);setError("");
    try{
      const params=new URLSearchParams({parentId:parent});
      if(pageToken)params.set("pageToken",pageToken);
      const data=await call<FolderPage>("/integrations/drive/"+encodeURIComponent(connection.id)+"/folders?"+params);
      setFolderList(old=>append?[...old,...data.folders]:data.folders);
      setFolderPage(data.nextPageToken);
      setTrail(nextTrail);setRootMode(mode);
    }catch(e){setError(e instanceof Error?e.message:"Não foi possível abrir a pasta.");}
    finally{setFolderBusy(false);}
  }

  async function chooseFolders(){
    if(!selectedProjectId){setError("Selecione um projeto na parte superior antes de vincular pastas.");return;}
    if(!connection){await connect(selectedProjectId);return;}
    setPicker(true);setFolderList([]);
    setTrail([{id:"root",name:"Meu Drive"}]);setRootMode("root");
    void browse("root",[{id:"root",name:"Meu Drive"}],null,false,"root");
  }

  useEffect(()=>{
    if(picker && connection){
      void browse("root",[{id:"root",name:"Meu Drive"}],null,false,"root");
    }
    // Initial load occurs when the dialog becomes visible.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[picker,connection?.id]);

  async function addFolder(folder:Item){
    if(!user||!selectedProjectId||!connection)return;
    if(links.some(l=>l.connectionId===connection.id&&l.projectId===selectedProjectId&&l.folderId===folder.id)){
      setResult("Esta pasta já está vinculada a este projeto.");return;
    }
    setBusy(true);setError("");
    try{
      await linkDriveFolder(user.uid,selectedProjectId,connection.id,folder);
      setLinks(await readDriveLinks(user.uid));
      setResult("Pasta \""+folder.name+"\" vinculada ao projeto.");
    }catch(e){setError(e instanceof Error?e.message:"Não foi possível vincular a pasta.");}
    finally{setBusy(false);}
  }

  async function removeFolder(link:DriveFolderLink){
    if(!user)return;
    setBusy(true);setError("");
    try{
      await unlinkDriveFolder(user.uid,link.id);
      if(viewing?.id===link.id){setViewing(null);setFiles([]);}
      setLinks(old=>old.filter(l=>l.id!==link.id));
      setResult("Vínculo removido. Nenhum arquivo foi apagado do Drive.");
    }catch(e){setError(e instanceof Error?e.message:"Não foi possível desvincular.");}
    finally{setBusy(false);}
  }

  async function openFiles(link:DriveFolderLink,token?:string|null,append=false){
    setFileBusy(true);setError("");
    try{
      const qs=token?"?pageToken="+encodeURIComponent(token):"";
      const data=await call<FilePage>("/integrations/drive/"+encodeURIComponent(link.connectionId)+"/folders/"+encodeURIComponent(link.folderId)+"/items"+qs);
      setViewing(link);
      setFiles(old=>append?[...old,...data.files]:data.files);
      setFilePage(data.nextPageToken);
      if(data.incompleteSearch)setResult("O Google informou que a busca pode estar incompleta.");
    }catch(e){setError(e instanceof Error?e.message:"Não foi possível visualizar os arquivos.");}
    finally{setFileBusy(false);}
  }

  async function disconnect(id:string){
    setBusy(true);setError("");
    try{
      await call("/integrations/drive/"+encodeURIComponent(id)+"/disconnect","POST");
      setConfirmId("");setPicker(false);setViewing(null);
      await refresh();
      setResult("Conta desconectada. Os arquivos originais permanecem no Google Drive.");
    }catch(e){setError(e instanceof Error?e.message:"Não foi possível desconectar.");}
    finally{setBusy(false);}
  }

  return <section className="panel studio-section" aria-label="Biblioteca Google Drive">
    <div className="studio-toolbar" style={{justifyContent:"space-between",gap:12,flexWrap:"wrap"}}>
      <div><span className="eyebrow">ARQUIVOS DOS PROJETOS</span>
        <h2 style={{display:"flex",alignItems:"center",gap:8}}><Cloud size={21}/> Google Drive</h2></div>
      <button className="secondary-button" disabled={!ready||busy} onClick={()=>void refresh().catch(e=>setError(e.message))}>
        <RefreshCw size={15}/> Atualizar
      </button>
    </div>
    {!ready ? <p role="status">Carregando integração…</p> : <>
      {connected.length ? <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",margin:"10px 0 16px"}}>
        <ShieldCheck size={17}/><strong>{connected.map(c=>c.google_email).join(", ")}</strong>
        <span style={{fontSize:12,opacity:.8}}>{authorized.length?"Drive conectado":"Permissões de pastas pendentes"}</span>
        <button className="secondary-button" disabled={busy} onClick={()=>{setConfirmId(connected[0].id===confirmId?"":connected[0].id);}}><Unplug size={14}/> Desconectar</button>
        {confirmId && <><button className="secondary-button" onClick={()=>setConfirmId("")}>Cancelar</button>
          <button className="secondary-button" disabled={busy} onClick={()=>void disconnect(confirmId)}>Confirmar desconexão</button></>}
      </div> : <p>Conecte sua conta uma vez e escolha pastas para trabalhar nos projetos. O Google solicitará leitura do seu Drive; o Roteiva organiza somente as pastas que você vincular.</p>}
      {!connected.length ?
        <button className="primary-button" disabled={busy} onClick={()=>void connect(selectedProjectId)}>
          <Cloud size={16}/> {busy?"Conectando…":"Conectar Google Drive"}
        </button>
        : <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center",marginBottom:16}}>
          <button className="primary-button" disabled={busy||!selectedProjectId} onClick={()=>void chooseFolders()}>
            <Link2 size={16}/> Vincular pastas {thisProject?"ao "+thisProject.name:"ao projeto"}
          </button>
          {!selectedProjectId && <small>Escolha um projeto no seletor acima para vincular pastas.</small>}
          {!authorized.length && <small>Ao vincular, o Google pedirá uma única atualização da permissão de leitura para sua conta já conectada.</small>}
        </div>}
      {callback==="connected" && <p role="status"><CheckCircle2 size={15}/> Drive autorizado. {selectedProjectId?"Selecione agora as pastas do projeto.":"Escolha um projeto para vincular suas pastas."}</p>}
      {callback==="cancelled" && <p role="status">Autorização cancelada.</p>}
      {oauthError(callback) && <p role="alert" className="auth-error">{oauthError(callback)}</p>}
      {error && <p role="alert" className="auth-error">{error}</p>}
      {result && <p role="status">{result}</p>}
      <div style={{display:"grid",gap:10,marginTop:16}}>
        <h3 style={{fontSize:15}}>Pastas vinculadas {thisProject?"— "+thisProject.name:""}</h3>
        {relevant.map(link=><div className="panel" key={link.id} style={{display:"flex",alignItems:"center",gap:12,padding:"12px 16px",flexWrap:"wrap"}}>
          <FolderOpen size={19}/>
          <div style={{flex:1,minWidth:160}}>
            <strong>{link.folderName}</strong>
            <div style={{fontSize:12,opacity:.7}}>{projects.find(p=>p.id===link.projectId)?.name||"Projeto indisponível"}</div>
          </div>
          <button className="secondary-button" disabled={fileBusy||busy} onClick={()=>void openFiles(link)}>Ver arquivos</button>
          <button className="secondary-button" disabled={busy} onClick={()=>void removeFolder(link)} aria-label={"Desvincular "+link.folderName}><X size={15}/></button>
        </div>)}
        {!relevant.length&&<p style={{opacity:.75}}>Nenhuma pasta vinculada {thisProject?"a este projeto":"aos projetos"}.</p>}
      </div>
      {viewing && <div className="panel" style={{marginTop:16,padding:16}}>
        <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"center",flexWrap:"wrap"}}>
          <h3 style={{fontSize:15,display:"flex",gap:8,alignItems:"center"}}><FolderOpen size={18}/>{viewing.folderName}</h3>
          <button className="secondary-button" onClick={()=>setViewing(null)}>Fechar</button>
        </div>
        {fileBusy && <p role="status">Carregando arquivos…</p>}
        {!files.length&&!fileBusy && <p>Nenhum arquivo encontrado diretamente nesta pasta.</p>}
        <div style={{display:"grid",gap:8,marginTop:12}}>
          {files.map(file=>{const Icon=kindIcon(file.mimeType);return <div key={file.id} style={{display:"flex",gap:10,alignItems:"center",padding:"10px 0",borderBottom:"1px solid var(--border,#ffffff19)",flexWrap:"wrap"}}>
            <Icon size={19}/><div style={{flex:1,minWidth:160}}>
              <strong style={{fontSize:13}}>{file.name}</strong>
              <div style={{fontSize:11,opacity:.65}}>{file.mimeType===FOLDER?"Subpasta":sizeText(file.size)} {file.modifiedTime?" · "+new Date(file.modifiedTime).toLocaleDateString("pt-BR"):""}</div>
            </div>
            {file.mimeType!==FOLDER && !file.mimeType.startsWith("application/vnd.google-apps.") &&
              <button className="secondary-button" onClick={()=>setPreview(file)}>Prévia</button>}
            <a className="secondary-button" target="_blank" rel="noreferrer" href={file.webViewLink||"https://drive.google.com/file/d/"+encodeURIComponent(file.id)+"/view"}>
              <ExternalLink size={14}/> Drive
            </a>
          </div>;})}
        </div>
        {filePage && <button className="secondary-button" disabled={fileBusy} onClick={()=>void openFiles(viewing,filePage,true)}>Carregar mais arquivos</button>}
        <small style={{opacity:.7}}>Arquivos originais mantidos no Google Drive. Prévia incorporada depende das permissões e do navegador.</small>
      </div>}
    </>}
    {picker && connection && selectedProjectId && <div role="presentation" style={{position:"fixed",inset:0,zIndex:400,background:"rgba(0,0,0,.76)",display:"grid",placeItems:"center",padding:16}} onMouseDown={e=>{if(e.target===e.currentTarget)setPicker(false);}}>
      <div role="dialog" aria-modal="true" aria-label="Selecionar pastas do Google Drive" className="panel" style={{width:"min(660px,100%)",maxHeight:"min(80vh,820px)",overflow:"auto",padding:20}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12}}>
          <div><h2 style={{fontSize:19}}>Vincular pastas</h2><p style={{fontSize:13,opacity:.8}}>Projeto: {thisProject?.name}</p></div>
          <button className="secondary-button" onClick={()=>setPicker(false)} aria-label="Fechar seletor"><X size={18}/></button>
        </div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap",margin:"16px 0"}}>
          <button className="secondary-button" onClick={()=>void browse("root",[{id:"root",name:"Meu Drive"}],null,false,"root")}>Meu Drive</button>
          <button className="secondary-button" onClick={()=>void browse("all",[{id:"all",name:"Todas as pastas"}],null,false,"all")}>Todas as pastas</button>
        </div>
        <nav aria-label="Localização" style={{display:"flex",alignItems:"center",gap:5,flexWrap:"wrap",marginBottom:12}}>
          {trail.map((node,i)=><span key={node.id} style={{display:"inline-flex",alignItems:"center",gap:5}}>
            {i>0&&<ChevronRight size={13}/>}
            <button className="secondary-button" onClick={()=>void browse(node.id,trail.slice(0,i+1))}>{node.name}</button>
          </span>)}
        </nav>
        {folderBusy&&<p role="status">Buscando pastas…</p>}
        <div style={{display:"grid",gap:7}}>
          {folderList.map(folder=><div key={folder.id} style={{display:"flex",alignItems:"center",gap:9,padding:"10px",border:"1px solid var(--border,#ffffff20)",borderRadius:10}}>
            <Folder size={17}/><button onClick={()=>void browse(folder.id,[...trail,{id:folder.id,name:folder.name}])} style={{flex:1,textAlign:"left",background:"none",color:"inherit",border:0,cursor:"pointer",padding:4}}>
              {folder.name} <ChevronRight size={12} style={{display:"inline"}}/>
            </button>
            <button className="primary-button" disabled={busy} onClick={()=>void addFolder(folder)}>
              {links.some(l=>l.projectId===selectedProjectId&&l.connectionId===connection.id&&l.folderId===folder.id)?"Vinculada":"Vincular"}
            </button>
          </div>)}
          {!folderBusy&&!folderList.length&&<p>Nenhuma pasta encontrada nesta localização.</p>}
        </div>
        {folderPage&&<button className="secondary-button" disabled={folderBusy} onClick={()=>void browse(trail[trail.length-1].id,trail,folderPage,true)}>Carregar mais</button>}
        <p style={{fontSize:12,marginTop:12,opacity:.75}}>Você pode vincular quantas pastas precisar. Os arquivos continuam no Google Drive.</p>
      </div>
    </div>}
    {preview && <div role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)setPreview(null);}} style={{position:"fixed",inset:0,zIndex:500,background:"rgba(0,0,0,.85)",display:"grid",placeItems:"center",padding:16}}>
      <div role="dialog" aria-modal="true" aria-label={"Prévia de "+preview.name} className="panel" style={{width:"min(1000px,100%)",padding:12}}>
        <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"center",padding:"5px 8px 12px"}}>
          <strong>{preview.name}</strong><button className="secondary-button" onClick={()=>setPreview(null)}><X size={17}/> Fechar</button>
        </div>
        <iframe title={"Prévia de "+preview.name} referrerPolicy="no-referrer" allow="fullscreen" src={"https://drive.google.com/file/d/"+encodeURIComponent(preview.id)+"/preview"} style={{width:"100%",height:"min(65vh,650px)",border:0,borderRadius:8}}/>
        <p style={{marginTop:8,fontSize:12}}>Caso não abra, acesse o arquivo diretamente no <a href={preview.webViewLink||"https://drive.google.com/file/d/"+encodeURIComponent(preview.id)+"/view"} target="_blank" rel="noreferrer">Google Drive</a>.</p>
      </div>
    </div>}
  </section>;
}
