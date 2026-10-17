import { useEffect, useState } from "react";
import { CheckCircle2, Cloud, RefreshCw, ShieldCheck, Unplug } from "lucide-react";
import { useAuth } from "../auth/AuthProvider";

const API = "https://roteiva-api-dev.ewertonmendes9.workers.dev";
type Connection = {id:string;google_email:string;status:"connected"|"reconnect_required"|"revocation_pending";scopes:string};
type Account = {user:{displayName:string;emailAddress:string}};

const messages:Record<string,string> = {
  oauth_not_configured:"O teste de conexão com o Google ainda não foi habilitado no DEV.",
  reconnect_required:"O Google solicitou uma nova autorização. Conecte a conta novamente.",
  invalid_identity:"Sua sessão expirou. Entre novamente no Roteiva.",
  authentication_required:"Sua sessão não foi identificada. Entre novamente no Roteiva.",
  rate_limited:"Muitas solicitações. Aguarde alguns instantes e tente novamente.",
  drive_unavailable:"Não foi possível consultar o Drive. Tente novamente.",
  google_unavailable:"O Google está indisponível temporariamente.",
  offline_access_unavailable:"O Google não forneceu uma credencial de acesso contínuo. Revise o acesso deste aplicativo nas permissões da sua Conta Google e tente conectar novamente.",
  drive_permission_missing:"O acesso aos arquivos do Google Drive não foi concedido. Tente conectar novamente e confira as permissões solicitadas.",
  drive_verification_unavailable:"Não foi possível confirmar o acesso ao Drive neste momento. Tente novamente em alguns instantes.",
  google_identity_missing:"O Google não confirmou a identidade da conta. Tente novamente.",
  invalid_google_identity:"Não conseguimos validar com segurança a conta Google. Tente novamente.",
  connection_changed:"Essa conexão foi modificada. Atualize e tente novamente.",
  connection_failed:"A conexão não pôde ser concluída. Tente novamente ou consulte o suporte.",
};

export function DriveConnectionPanel() {
  const {user}=useAuth();
  const [connections,setConnections]=useState<Connection[]>([]);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [result,setResult]=useState("");
  const [confirmId,setConfirmId]=useState("");
  const [account,setAccount]=useState<Record<string,Account["user"]>>({});

  async function call<T>(path:string,method:"GET"|"POST"="GET"):Promise<T> {
    if(!user)throw new Error("Faça login para continuar.");
    let response:Response|undefined;
    for(let attempt=0;attempt<2;attempt++){
      const token=await user.getIdToken(attempt>0);
      response=await fetch(API+path,{
        method,
        headers:{Authorization:"Bearer "+token},
        cache:"no-store",
      });
      if(response.status!==401)break;
    }
    if(!response?.ok){
      const body=await response?.json().catch(()=>({})) as {error?:{code?:string}}|undefined;
      const code=body?.error?.code||"service_unavailable";
      throw new Error(messages[code]||"Não foi possível concluir a operação. Tente novamente.");
    }
    return response.json() as Promise<T>;
  }

  async function load() {
    if(!user)return;
    setLoading(true);setError("");
    try {const data=await call<{connections:Connection[]}>("/integrations/drive");
      setConnections(data.connections);
    } catch(reason){setError(reason instanceof Error?reason.message:"Não foi possível carregar a conexão.");}
    finally{setLoading(false);}
  }

  useEffect(()=>{
    if(!user)return;
    let active=true;
    const initial=async()=>{
      try{
        const token=await user.getIdToken();
        const response=await fetch(API+"/integrations/drive",{headers:{Authorization:"Bearer "+token},cache:"no-store"});
        if(!response.ok)throw new Error("Não foi possível consultar suas conexões Drive.");
        const data=await response.json() as {connections:Connection[]};
        if(active)setConnections(data.connections);
      }catch(reason){if(active)setError(reason instanceof Error?reason.message:"Falha na conexão.");}
      finally{if(active)setLoading(false);}
    };
    void initial();
    return ()=>{active=false;};
  },[user]);

  async function connect() {
    setBusy(true);setError("");setResult("");
    try {
      const data=await call<{launchUrl:string}>("/oauth/drive/start","POST");
      const target=new URL(data.launchUrl);
      if(target.origin!==API || target.pathname!=="/oauth/drive/launch")throw new Error("Resposta OAuth inesperada.");
      // Top-level navigation is required so the Worker sets a first-party cookie.
      window.location.assign(target.toString());
    }catch(reason){setError(reason instanceof Error?reason.message:"Não foi possível conectar.");setBusy(false);}
  }

  async function verify(id:string) {
    setBusy(true);setError("");setResult("");
    try {const data=await call<Account>("/integrations/drive/"+encodeURIComponent(id)+"/about");
      setAccount(old=>({...old,[id]:data.user}));
      setResult("Google Drive respondeu à consulta autenticada. A conexão está funcionando.");
    }catch(reason){setError(reason instanceof Error?reason.message:"Não foi possível validar.");}
    finally{setBusy(false);}
  }

  async function disconnect(id:string) {
    setBusy(true);setError("");setResult("");
    try {
      await call<{status:string}>("/integrations/drive/"+encodeURIComponent(id)+"/disconnect","POST");
      setConfirmId("");setAccount(old=>{const next={...old};delete next[id];return next;});
      await load();setResult("Conexão removida. Os arquivos permanecem no seu Google Drive.");
    }catch(reason){setError(reason instanceof Error?reason.message:"Não foi possível desconectar.");}
    finally{setBusy(false);}
  }

  const callback=new URLSearchParams(window.location.search).get("drive");
  return <section className="panel studio-section" aria-label="Integração Google Drive">
    <div className="studio-toolbar" style={{justifyContent:"space-between",gap:12,flexWrap:"wrap"}}>
      <div><span className="eyebrow">INTEGRAÇÃO DEV</span><h2 style={{display:"flex",alignItems:"center",gap:8}}><Cloud size={21}/> Google Drive</h2></div>
      <button className="secondary-button" onClick={()=>void load()} disabled={loading||busy}><RefreshCw size={15}/> Atualizar</button>
    </div>
    <p>Conecte seu Drive para testar a autorização segura. Seus arquivos permanecem na conta Google. A biblioteca de pastas e mídia será implementada depois da validação desta etapa.</p>
    {callback==="connected"&&<p role="status"><CheckCircle2 size={16}/> O Google retornou uma conexão autorizada. Confira sua conta abaixo.</p>}
    {callback==="cancelled"&&<p role="status">Autorização cancelada. Nenhuma conexão foi alterada.</p>}
    {callback && callback!=="connected" && callback!=="cancelled" && <p role="alert" className="auth-error">{messages[callback] || messages.connection_failed}</p>}
    {loading?<p role="status">Consultando conexões…</p>:
      connections.length? <div style={{display:"grid",gap:12}}>
        {connections.map(item=><div key={item.id} className="panel" style={{padding:16,display:"grid",gap:10}}>
          <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
            <ShieldCheck size={18}/>
            <strong>{item.google_email}</strong>
            <small>{item.status==="connected"?"Conectado":item.status==="reconnect_required"?"Reconexão necessária":"Revogação pendente"}</small>
          </div>
          {account[item.id]&&<small>Conta confirmada pelo Drive: {account[item.id].displayName} · {account[item.id].emailAddress}</small>}
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            <button className="secondary-button" disabled={busy||item.status!=="connected"} onClick={()=>void verify(item.id)}>Testar acesso</button>
            {confirmId===item.id? <>
              <button className="secondary-button" disabled={busy} onClick={()=>setConfirmId("")}>Cancelar</button>
              <button className="secondary-button" disabled={busy} onClick={()=>void disconnect(item.id)}><Unplug size={15}/> Confirmar desconexão</button>
            </>:<button className="secondary-button" disabled={busy} onClick={()=>setConfirmId(item.id)}>Desconectar</button>}
          </div>
        </div>)}
      </div> : <p>Nenhuma conta Google Drive vinculada.</p>}
    <button className="primary-button" disabled={busy||loading} onClick={()=>void connect()}><Cloud size={16}/> {busy?"Aguarde…":"Conectar Google Drive"}</button>
    {error&&<p role="alert" className="auth-error">{error}</p>}
    {result&&<p role="status">{result}</p>}
    <small>Disponível apenas no DEV para usuários de teste. A autorização Drive é separada do login no Roteiva. Não conceda acesso a materiais sensíveis nesta prova de conceito.</small>
  </section>;
}
