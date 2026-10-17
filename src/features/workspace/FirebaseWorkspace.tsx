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
import { retryFirestoreRead,transientFirestoreRead,firestoreCode } from "../../data/firestore-recovery";

export function FirebaseWorkspace() {
  const {user,logout,busy,error:authError}=useAuth();
  const profileContext=useRegistrationProfile();
  const repository=useMemo(()=>new FirestoreWorkspace(firebaseServices().db,user!.uid),[user!.uid]);
  const [initial,setInitial]=useState<{workspace:WorkspaceData;theme:"light"|"dark"}>();
  const [businessLoaded,setBusinessLoaded]=useState(false);
  const [loadingBusiness,setLoadingBusiness]=useState(false);
  const [overviewMetrics,setOverviewMetrics]=useState<Awaited<ReturnType<FirestoreWorkspace["overviewMetrics"]>>>();
  const [projectPage,setProjectPage]=useState<{total:number;hasMore:boolean;status:string}>();
  const [clientPage,setClientPage]=useState<{total:number;recurring:number;hasMore:boolean}>();
  const [financePeriod,setFinancePeriod]=useState<string>();
  const [financeBars,setFinanceBars]=useState<{key:string;bars:number[]}>();
  const [calendarPeriod,setCalendarPeriod]=useState<string>();
  const [error,setError]=useState("");
  const [failedWrite,setFailedWrite]=useState(false);
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
  const automaticAttempts=useRef(0);
  useEffect(()=>{
    let active=true;
    let ready=false;
    let retryTimer:ReturnType<typeof setTimeout>|undefined;
    failed.current=false;
    setRemoteChanges(false);setSyncWarning("");
    setError("");setFailedWrite(false); setInitial(undefined);setBusinessLoaded(false);setOverviewMetrics(undefined);setProjectPage(undefined);setClientPage(undefined);setFinancePeriod(undefined);setFinanceBars(undefined);setCalendarPeriod(undefined);
    (async()=>{
      await retryFirestoreRead(async()=>{
      const route=routeFromLocation(window.location,{base:import.meta.env.BASE_URL,useHash:false});
      const domains=domainsForRoute(route);
      const [workspaceState,theme]=await Promise.all([
        (async()=>{
          if (domains.length) await repository.load(domains);
          if(route.view==="overview" || (route.view==="projects" && !route.projectId)){
            const size=route.view==="overview"?4:24;
            const page=await repository.projectPage({reset:true,size});
            if(route.view==="overview"){
              const d=new Date(),year=d.getFullYear(),month=d.getMonth();
              const workspace=await retryFirestoreRead(()=>repository.calendarWindow(year,month));
              return {workspace,page:{...page,workspace},calendar:`${year}-${month}`};
            }
            return {workspace:page.workspace,page};
          }
          if(route.view==="clients" && !route.clientId){
            const clients=await repository.clientPage({reset:true,size:24});
            return {workspace:clients.workspace,clients};
          }
          if(route.view==="finance"){
            const now=new Date(),year=now.getFullYear(),month=now.getMonth();
            const workspace=await repository.financeMonth(year,month);
            const bars=await repository.financeYearBars(year);
            return {workspace,finance:{year,month,bars}};
          }
          if(route.view==="calendar"){
            const date=new Date(),year=date.getFullYear(),month=date.getMonth();
            return {workspace:await repository.calendarWindow(year,month),calendar:`${year}-${month}`};
          }
          return {workspace:domains.length ? await repository.load(domains) : emptyWorkspace()};
        })(),
        repository.loadTheme(),
      ]);
      const stats=route.view==="overview" ?
        await repository.overviewMetrics(workspaceState.page?.workspace.projects) : undefined;
      if (active) {
        ready=true;
        automaticAttempts.current=0;
        setBusinessLoaded(domains.length>0);
        if (stats) setOverviewMetrics(stats);
        if (workspaceState.page && route.view==="projects")
          setProjectPage({total:workspaceState.page.total,hasMore:workspaceState.page.hasMore,status:"Todos"});
        if (workspaceState.clients)
          setClientPage({total:workspaceState.clients.total,recurring:workspaceState.clients.recurring,hasMore:workspaceState.clients.hasMore});
        if("finance" in workspaceState && workspaceState.finance){
          const {year,month,bars}=workspaceState.finance;
          const key=year+"-"+month+"-";
          setFinancePeriod(key);setFinanceBars({key:year+"-",bars});
        }
        if("calendar" in workspaceState && workspaceState.calendar)setCalendarPeriod(workspaceState.calendar);
        setInitial({workspace:workspaceState.workspace,theme:theme || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark":"light")});
      }
      },{isCurrent:()=>active});
    })().catch(reason=>{
      if(!active)return;
      // Do not turn a recoverable read error into an endless "reload" screen.
      // Recreate the read pipeline automatically with capped backoff.
      const code=firestoreCode(reason);
      const blocked=["permission-denied","unauthenticated","resource-exhausted"].includes(code);
      if(blocked){
        failed.current=true;setError(dataErrorMessage(reason));
        return;
      }
      const summary=(reason as {message?:unknown}|null)?.message;
      console.warn("[Roteiva] Aguardando nova tentativa de leitura",{
        code:code||"unexpected",
        reason:typeof summary==="string"?summary.slice(0,180):"unknown",
      });
      const attempt=automaticAttempts.current++;
      // Do not loop forever on a deterministic client/schema problem.
      // Temporary network failures continue reconnecting in the background.
      if(!transientFirestoreRead(reason) && attempt>=2){
        failed.current=true;
        setError("A sincronização não pôde ser concluída automaticamente. O acesso aos seus dados foi interrompido para evitar informações incorretas.");
        return;
      }
      const delay=Math.min(30000,2000*2**Math.min(attempt,4));
      retryTimer=setTimeout(()=>{if(active)setVersion(value=>value+1);},delay);
    });
    const online=()=>{if(active && !ready){clearTimeout(retryTimer);setVersion(value=>value+1);}};
    window.addEventListener("online",online);
    return ()=>{active=false;clearTimeout(retryTimer);window.removeEventListener("online",online);};
  },[repository,version]);
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
        if(active && changed){
          if(!pending.current)setVersion(value=>value+1);
          else setRemoteChanges(true);
        }
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
      // Navigation never reads an older snapshot while its own mutation is pending.
      await queue.current;
      if(failed.current)throw new Error("Conflito: há uma alteração não confirmada.");
      const workspace=await retryFirestoreRead(()=>repository.load(domains));
      if (request===scopeRequest.current) {
        setInitial(current=>current?{...current,workspace}:current);
        setBusinessLoaded(repository.hasLoaded(domains));
      }
      return workspace;
    } catch(reason) {
      if(request===scopeRequest.current){
        if(transientFirestoreRead(reason) && !pending.current)setVersion(value=>value+1);
        else setError(dataErrorMessage(reason));
      }
      throw reason;
    } finally {
      if (request===scopeRequest.current) setLoadingBusiness(false);
    }
  },[repository,initial]);
  const ensureFullWorkspace=useCallback(()=>ensureDomains(["clients","projects","tasks","deliveries","events","financeEntries","activities"]),[ensureDomains]);
  const fetchProjectPage=useCallback(async(status:string,reset:boolean)=>{
    const request=++scopeRequest.current;
    setLoadingBusiness(true);
    try{
      await queue.current;
      if(failed.current)throw new Error("Conflito: há uma alteração não confirmada.");
      // The project editor needs the complete client selector even on a paged list.
      await repository.load(["clients","activities"]);
      const result=await retryFirestoreRead(()=>repository.projectPage({status,reset,size:24}));
      if(request===scopeRequest.current){
        setInitial(current=>current?{...current,workspace:result.workspace}:current);
        setBusinessLoaded(true);
        setProjectPage({total:result.total,hasMore:result.hasMore,status});
      }
    }catch(reason){
      if(request===scopeRequest.current){
        if(transientFirestoreRead(reason) && !pending.current)setVersion(value=>value+1);
        else setError(dataErrorMessage(reason));
      }
    }finally{
      if(request===scopeRequest.current)setLoadingBusiness(false);
    }
  },[repository]);
  const fetchClientPage=useCallback(async(reset:boolean)=>{
    const request=++scopeRequest.current;
    setLoadingBusiness(true);
    try{
      await queue.current;
      if(failed.current)throw new Error("Conflito: há uma alteração não confirmada.");
      await repository.load(["projects","activities"]);
      const result=await retryFirestoreRead(()=>repository.clientPage({reset,size:24}));
      if(request===scopeRequest.current){
        setInitial(current=>current?{...current,workspace:result.workspace}:current);
        setBusinessLoaded(true);
        setClientPage({total:result.total,recurring:result.recurring,hasMore:result.hasMore});
      }
    }catch(reason){
      if(request===scopeRequest.current){
        if(transientFirestoreRead(reason) && !pending.current)setVersion(value=>value+1);
        else setError(dataErrorMessage(reason));
      }
    }finally{
      if(request===scopeRequest.current)setLoadingBusiness(false);
    }
  },[repository]);
  const searchAllClients=useCallback(()=>{
    void ensureDomains(["clients","projects","financeEntries","deliveries","activities"]).catch(()=>undefined);
  },[ensureDomains]);
  const searchAllProjects=useCallback(()=>{
    void ensureDomains(["clients","projects","tasks","events","financeEntries","activities"]).catch(()=>undefined);
  },[ensureDomains]);

  const loadFinancePeriod=useCallback(async(year:number,month:number,clientId?:number)=>{
    const key=year+"-"+month+"-"+(clientId||"");
    if(financePeriod===key && financeBars?.key===year+"-"+(clientId||""))return;
    const request=++scopeRequest.current;
    setLoadingBusiness(true);
    try {
      await queue.current;
      if(failed.current)throw Error("Conflito: há uma gravação não confirmada.");
      await repository.load(["clients","projects","activities"]);
      const workspace=await retryFirestoreRead(()=>repository.financeMonth(year,month));
      const bars=await retryFirestoreRead(()=>repository.financeYearBars(year,clientId));
      if(request===scopeRequest.current){
        setInitial(current=>current?{...current,workspace}:current);
        setBusinessLoaded(true);setFinancePeriod(key);
        setFinanceBars({key:year+"-"+(clientId||""),bars});
      }
    }catch(reason){if(request===scopeRequest.current){
        if(transientFirestoreRead(reason) && !pending.current)setVersion(value=>value+1);
        else setError(dataErrorMessage(reason));
      }}
    finally{if(request===scopeRequest.current)setLoadingBusiness(false);}
  },[repository,financePeriod,financeBars]);
  const loadCalendarPeriod=useCallback(async(year:number,month:number)=>{
    const period=year+"-"+month;
    if(calendarPeriod===period)return;
    const request=++scopeRequest.current;
    setLoadingBusiness(true);
    try {
      await queue.current;
      if(failed.current)throw Error("Conflito: há uma gravação não confirmada.");
      await repository.load(["projects","activities"]);
      const workspace=await repository.calendarWindow(year,month);
      if(request===scopeRequest.current){
        setInitial(current=>current?{...current,workspace}:current);
        setBusinessLoaded(true);setCalendarPeriod(period);
      }
    }catch(reason){if(request===scopeRequest.current){
        if(transientFirestoreRead(reason) && !pending.current)setVersion(value=>value+1);
        else setError(dataErrorMessage(reason));
      }}
    finally{if(request===scopeRequest.current)setLoadingBusiness(false);}
  },[repository,calendarPeriod]);
  const onRouteChange=useCallback((route:WorkspaceRoute)=>{
    if(route.view==="overview"){
      if(!overviewMetrics)void retryFirestoreRead(()=>repository.overviewMetrics()).then(setOverviewMetrics)
        .catch(reason=>{if(!transientFirestoreRead(reason))setError(dataErrorMessage(reason));});
      if(!calendarPeriod){const d=new Date();void loadCalendarPeriod(d.getFullYear(),d.getMonth());}
    }
    if(route.view==="projects" && !route.projectId && !repository.hasLoaded(["projects","tasks"])){
      if(!projectPage || projectPage.status!=="Todos")void fetchProjectPage("Todos",true);
      return;
    }
    if(route.view==="clients" && !route.clientId && !repository.hasLoaded(["clients"])){
      if(!clientPage)void fetchClientPage(true);
      return;
    }
    if(route.view==="finance" && !financePeriod){
      const d=new Date();void loadFinancePeriod(d.getFullYear(),d.getMonth());
      return;
    }
    if(route.view==="calendar" && !calendarPeriod){
      const d=new Date();void loadCalendarPeriod(d.getFullYear(),d.getMonth());
      return;
    }
    const required=domainsForRoute(route);
    if (!required.length || repository.hasLoaded(required)) return;
    void ensureDomains(required).catch(()=>undefined);
  },[repository,ensureDomains,overviewMetrics,projectPage,fetchProjectPage,clientPage,fetchClientPage,financePeriod,calendarPeriod,loadFinancePeriod,loadCalendarPeriod]);
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
      failed.current=true;setFailedWrite(true);setError(dataErrorMessage(reason));setStatus("Alterações não confirmadas");
    }).finally(()=>{pending.current--;if(!pending.current)setSaving(false);});
  },[]);
  const saveTheme=useCallback((theme:"light"|"dark")=>enqueue(()=>repository.saveTheme(theme)),[repository,enqueue]);
  const executeCommands=useCallback((commands:readonly WorkspaceCommand[])=>enqueue(async()=>{
    const parsed=financePeriod?.split("-")||[];
    const year=Number(parsed[0]),clientId=Number(parsed[2])||undefined;
    const touchesFinance=commands.some(c=>c.kind==="saveFinance"||c.kind==="deleteFinance");
    const months=touchesFinance && financePeriod && financeBars && Number.isInteger(year)
      ? repository.affectedFinanceMonths(commands,year) : undefined;
    const changed=await repository.applyCommands(commands);
    if(changed && months && financeBars?.key===year+"-"+(clientId||"")){
      const bars=await repository.financeYearBars(year,clientId,months);
      setFinanceBars({key:year+"-"+(clientId||""),bars});
    }
  }),[repository,enqueue,financePeriod,financeBars]);
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
      <h2>Não foi possível confirmar o acesso à nuvem</h2><p>{error}</p>
      {failedWrite
        ? <><p>Essa gravação não foi confirmada. Para evitar duplicações, ela não será repetida automaticamente. Ao recuperar os dados confirmados, alterações locais não salvas serão descartadas.</p>
            <button className="primary-button" disabled={saving} onClick={()=>setVersion(v=>v+1)}>Recarregar dados da nuvem</button></>
        : <p>Se sua sessão ou as permissões de acesso expiraram, entre novamente. Os dados confirmados no Firebase permanecem preservados.</p>}
      <button className="secondary-button" disabled={saving||busy} onClick={()=>void logout()}>Sair da conta</button>
    </section>}
    {!initial && !error && <main className="studio-loading" role="status">Sincronizando seu espaço…</main>}
    {loadingBusiness && !error && <main className="studio-loading" role="status">Carregando os dados do seu espaço…</main>}
    {initial && (overviewMetrics || routeFromLocation(window.location,{base:import.meta.env.BASE_URL,useHash:false}).view!=="overview") && <div inert={!!error || remoteChanges || loadingBusiness} aria-busy={saving}>
      <DashboardClient key={user.uid+"-"+version} firstName={profileContext?.profile.displayName || user.displayName || "Profissional"} profile={profileContext?.profile || null} onSaveProfile={profileContext?.saveProfile} email={user.email || ""} photoURL={user.photoURL || undefined}
        initialWorkspace={initial.workspace} initialTheme={initial.theme} onCommands={businessLoaded ? executeCommands : undefined} onLoadWorkspace={repository.hasLoaded(collections) ? undefined : ensureFullWorkspace} onRouteChange={onRouteChange}
        canValidateProjectLink={repository.hasLoaded(domainsForRoute({view:"projects",projectId:1}))}
        canValidateClientLink={repository.hasLoaded(domainsForRoute({view:"clients",clientId:1}))}
        projectPage={repository.hasLoaded(["projects","tasks"])?undefined:projectPage}
        onMoreProjects={()=>void fetchProjectPage(projectPage?.status||"Todos",false)}
        onProjectStatus={(status)=>{if(!repository.hasLoaded(["projects","tasks"]))void fetchProjectPage(status,true);}}
        onSearchProjects={searchAllProjects}
        clientPage={repository.hasLoaded(["clients"])?undefined:clientPage}
        onMoreClients={()=>void fetchClientPage(false)}
        usage={repository.diagnostics()}
        eventCount={repository.totalCount("events")}
        onSearchClients={searchAllClients}
        onFinancePeriodChange={(year,month,clientId)=>void loadFinancePeriod(year,month,clientId)}
        financeBars={financeBars}
        onCalendarMonthChange={(year,month)=>void loadCalendarPeriod(year,month)}
        onClientCreated={(client)=>setClientPage(current=>current?{
          ...current,total:current.total+1,recurring:current.recurring+(client.type==="Recorrente"?1:0),
        }:current)} onThemeChange={saveTheme}
        overviewMetrics={overviewMetrics ? {
          clientCount:repository.hasLoaded(["clients"])?undefined:overviewMetrics.clientCount,
          receivableAmount:repository.hasLoaded(["financeEntries"])?undefined:overviewMetrics.receivableAmount,
          projectCount:repository.hasLoaded(["projects"])?undefined:overviewMetrics.projectCount,
          projectStatuses:repository.hasLoaded(["projects"])?undefined:overviewMetrics.projectStatuses,
        } : undefined} cloudStatus={status} saving={saving} onLogout={()=>void logout()} />
    </div>}
  </>;
}
