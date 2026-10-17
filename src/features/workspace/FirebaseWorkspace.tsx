import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DashboardClient from "../../dashboard-client";
import { firebaseServices } from "../../lib/firebase";
import { FirestoreWorkspace, dataErrorMessage } from "../../data/firestore-workspace";
import { emptyWorkspace, type WorkspaceData } from "../../domain/workspace";
import { routeFromLocation, type WorkspaceRoute } from "../../lib/workspace-routing";
import { domainsForRoute } from "../../lib/workspace-scopes";
import type { Domain } from "../../data/firestore-sync";
import { collections } from "../../data/workspace-codec";
import type { WorkspaceCommand } from "../../data/firestore-commands";
import { useAuth } from "../auth/AuthProvider";
import { useRegistrationProfile } from "../auth/RegistrationGate";

export function FirebaseWorkspace() {
  const {user,logout,busy,error:authError}=useAuth();
  const profileContext=useRegistrationProfile();
  const repository=useMemo(()=>new FirestoreWorkspace(firebaseServices().db,user!.uid),[user!.uid]);
  const [initial,setInitial]=useState<{workspace:WorkspaceData;theme:"light"|"dark"}>();
  const [businessLoaded,setBusinessLoaded]=useState(false);
  const [loadingBusiness,setLoadingBusiness]=useState(false);
  const [overviewMetrics,setOverviewMetrics]=useState<{clientCount:number;receivableAmount:number}>();
  const [error,setError]=useState("");
  const [saving,setSaving]=useState(false);
  const [status,setStatus]=useState("Dados na nuvem");
  const [version,setVersion]=useState(0);
  const [remoteChanges,setRemoteChanges]=useState(false);
  const [syncWarning,setSyncWarning]=useState("");
  const lastCheck=useRef(0);
  const scopeRequest=useRef(0);
  const queue=useRef(Promise.resolve());
  const pending=useRef(0);
  const failed=useRef(false);
  useEffect(()=>{
    let active=true;
    failed.current=false;
    setRemoteChanges(false);setSyncWarning("");
    setError(""); setInitial(undefined);setBusinessLoaded(false);setOverviewMetrics(undefined);
    (async()=>{
      const route=routeFromLocation(window.location,{base:import.meta.env.BASE_URL,useHash:false});
      const domains=domainsForRoute(route);
      const [workspace,theme,stats]=await Promise.all([
        domains.length ? repository.load(domains) : Promise.resolve(emptyWorkspace()),
        repository.loadTheme(),
        route.view==="overview" ? repository.overviewMetrics() : Promise.resolve(undefined),
      ]);
      if (active) {
        setBusinessLoaded(domains.length>0);
        if (stats) setOverviewMetrics(stats);
        setInitial({workspace,theme:theme || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark":"light")});
      }
    })().catch(reason=>{if(active){failed.current=true;setError(dataErrorMessage(reason));}});
    return ()=>{active=false;};
  },[repository,user,version]);
  // Revalidate only when returning to the app, not on every screen navigation.
  useEffect(() => {
    if (!initial) return;
    let active = true;
    const check = async () => {
      if (document.visibilityState !== "visible" || pending.current || failed.current) return;
      if (Date.now() - lastCheck.current < 60000) return;
      lastCheck.current = Date.now();
      try {
        const changed = await repository.hasExternalChanges();
        if (active && changed) setRemoteChanges(true);
      } catch {
        if (active) setSyncWarning("Não foi possível conferir atualizações externas. Verifique sua conexão.");
      }
    };
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {active=false;window.removeEventListener("focus",check);
      document.removeEventListener("visibilitychange",check);};
  },[repository,initial,version]);
  const ensureDomains=useCallback(async(domains:readonly Domain[]):Promise<WorkspaceData>=>{
    if (repository.hasLoaded(domains) && initial) return initial.workspace;
    const request=++scopeRequest.current;
    setLoadingBusiness(true);
    try {
      const workspace=await repository.load(domains);
      if (request===scopeRequest.current) {
        setInitial(current=>current?{...current,workspace}:current);
        setBusinessLoaded(repository.hasLoaded(domains));
      }
      return workspace;
    } catch(reason) {
      if (request===scopeRequest.current) setError(dataErrorMessage(reason));
      throw reason;
    } finally {
      if (request===scopeRequest.current) setLoadingBusiness(false);
    }
  },[repository,initial]);
  const ensureFullWorkspace=useCallback(()=>ensureDomains(["clients","projects","tasks","deliveries","events","financeEntries","activities"]),[ensureDomains]);
  const onRouteChange=useCallback((route:WorkspaceRoute)=>{
    if (route.view==="overview" && !overviewMetrics) {
      void repository.overviewMetrics().then(setOverviewMetrics).catch(reason=>setError(dataErrorMessage(reason)));
    }
    const required=domainsForRoute(route);
    if (!required.length || repository.hasLoaded(required)) return;
    void ensureDomains(required).catch(()=>undefined);
  },[repository,ensureDomains,overviewMetrics]);
  useEffect(()=>{
    if (!saving) return;
    const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue="";};
    window.addEventListener("beforeunload",warn);
    return ()=>window.removeEventListener("beforeunload",warn);
  },[saving]);
  const enqueue=useCallback((operation:()=>Promise<unknown>)=>{
    pending.current++;
    setSaving(true); setStatus("Salvando na nuvem…");
    queue.current=queue.current.then(async()=>{
      if (failed.current) return;
      await operation();
      setStatus("Salvo na nuvem");
    }).catch(reason=>{
      failed.current=true;setError(dataErrorMessage(reason));setStatus("Alterações não confirmadas");
    }).finally(()=>{pending.current--;if(!pending.current)setSaving(false);});
  },[]);
  const saveTheme=useCallback((theme:"light"|"dark")=>enqueue(()=>repository.saveTheme(theme)),[repository,enqueue]);
  const executeCommands=useCallback((commands:readonly WorkspaceCommand[])=>
    enqueue(()=>repository.applyCommands(commands)),[repository,enqueue]);
  if (!user) return null;
  return <>
    {saving && <div className="cloud-operation" role="status">Salvando na nuvem…</div>}
    {authError && <p className="cloud-banner" role="alert">{authError}</p>}
    {remoteChanges && !error && <section className="cloud-recovery" role="status">
      <h2>Há alterações em outro dispositivo</h2>
      <p>Seus dados foram modificados em outra aba ou dispositivo. Atualize para consultar a versão mais recente antes de continuar editando.</p>
      <button className="primary-button" disabled={saving} onClick={()=>setVersion(v=>v+1)}>Atualizar dados</button>
    </section>}
    {syncWarning && !error && <p className="cloud-banner" role="status">{syncWarning}</p>}
    {error && <section className="cloud-recovery" role="alert">
      <h2>Precisamos recuperar a conexão com seus dados</h2><p>{error}</p>
      <p>A versão confirmada na nuvem será restaurada. Alterações não salvas nesta aba serão descartadas.</p>
      <button className="primary-button" disabled={saving} onClick={()=>setVersion(v=>v+1)}>Recarregar dados da nuvem</button>
      <button className="secondary-button" disabled={saving||busy} onClick={()=>void logout()}>Sair da conta</button>
    </section>}
    {!initial && !error && <main className="studio-loading" role="status">Carregando seu espaço na nuvem…</main>}
    {loadingBusiness && !error && <main className="studio-loading" role="status">Carregando os dados do seu espaço…</main>}
    {initial && !loadingBusiness && (overviewMetrics || routeFromLocation(window.location,{base:import.meta.env.BASE_URL,useHash:false}).view!=="overview") && <div inert={!!error || remoteChanges} aria-busy={saving}>
      <DashboardClient key={user.uid+"-"+version} firstName={profileContext?.profile.displayName || user.displayName || "Profissional"} profile={profileContext?.profile || null} onSaveProfile={profileContext?.saveProfile} email={user.email || ""} photoURL={user.photoURL || undefined}
        initialWorkspace={initial.workspace} initialTheme={initial.theme} onCommands={businessLoaded ? executeCommands : undefined} onLoadWorkspace={repository.hasLoaded(collections) ? undefined : ensureFullWorkspace} onRouteChange={onRouteChange} onThemeChange={saveTheme}
        overviewMetrics={{
          clientCount:repository.hasLoaded(["clients"]) ? initial.workspace.clients.length : (overviewMetrics?.clientCount ?? initial.workspace.clients.length),
          receivableAmount:repository.hasLoaded(["financeEntries"]) ? initial.workspace.financeEntries
            .filter(e=>e.kind!=="expense"&&e.status==="A receber").reduce((n,e)=>n+Math.round(e.amount*100),0)/100
            : (overviewMetrics?.receivableAmount ?? 0),
        }} cloudStatus={status} saving={saving} onLogout={()=>void logout()} />
    </div>}
  </>;
}
