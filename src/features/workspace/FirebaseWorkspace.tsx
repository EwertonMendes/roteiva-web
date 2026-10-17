import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DashboardClient from "../../dashboard-client";
import { firebaseServices } from "../../lib/firebase";
import { FirestoreWorkspace, dataErrorMessage } from "../../data/firestore-workspace";
import type { WorkspaceData } from "../../domain/workspace";
import { useAuth } from "../auth/AuthProvider";
import { useRegistrationProfile } from "../auth/RegistrationGate";

export function FirebaseWorkspace() {
  const {user,logout,busy,error:authError}=useAuth();
  const registrationProfile=useRegistrationProfile();
  const repository=useMemo(()=>new FirestoreWorkspace(firebaseServices().db,user!.uid),[user!.uid]);
  const [initial,setInitial]=useState<{workspace:WorkspaceData;theme:"light"|"dark"}>();
  const [error,setError]=useState("");
  const [saving,setSaving]=useState(false);
  const [status,setStatus]=useState("Dados na nuvem");
  const [version,setVersion]=useState(0);
  const queue=useRef(Promise.resolve());
  const pending=useRef(0);
  const failed=useRef(false);
  useEffect(()=>{
    let active=true;
    failed.current=false;
    setError(""); setInitial(undefined);
    (async()=>{
      const [workspace,theme]=await Promise.all([repository.load(),repository.loadTheme()]);
      if (active) setInitial({workspace,theme:theme || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark":"light")});
    })().catch(reason=>{if(active){failed.current=true;setError(dataErrorMessage(reason));}});
    return ()=>{active=false;};
  },[repository,user,version]);
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
  const save=useCallback((workspace:WorkspaceData)=>enqueue(()=>repository.save(workspace)),[repository,enqueue]);
  const saveTheme=useCallback((theme:"light"|"dark")=>enqueue(()=>repository.saveTheme(theme)),[repository,enqueue]);
  if (!user) return null;
  return <>
    {saving && <div className="cloud-operation" role="status">Salvando na nuvem…</div>}
    {authError && <p className="cloud-banner" role="alert">{authError}</p>}
    {error && <section className="cloud-recovery" role="alert">
      <h2>Precisamos recuperar a conexão com seus dados</h2><p>{error}</p>
      <p>A versão confirmada na nuvem será restaurada. Alterações não salvas nesta aba serão descartadas.</p>
      <button className="primary-button" disabled={saving} onClick={()=>setVersion(v=>v+1)}>Recarregar dados da nuvem</button>
      <button className="secondary-button" disabled={saving||busy} onClick={()=>void logout()}>Sair da conta</button>
    </section>}
    {!initial && !error && <main className="studio-loading" role="status">Carregando seu espaço na nuvem…</main>}
    {initial && <div inert={!!error} aria-busy={saving}>
      <DashboardClient key={user.uid+"-"+version} firstName={registrationProfile?.displayName || user.displayName || "Profissional"} email={user.email || ""} photoURL={user.photoURL || undefined}
        initialWorkspace={initial.workspace} initialTheme={initial.theme} onWorkspaceChange={save} onThemeChange={saveTheme}
        cloudStatus={status} saving={saving} onLogout={()=>void logout()} />
    </div>}
  </>;
}
