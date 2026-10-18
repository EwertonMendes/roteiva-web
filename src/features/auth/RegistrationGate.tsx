import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { FirestoreWorkspace, dataErrorMessage, type RoteivaProfile, type ProfileChanges } from "../../data/firestore-workspace";
import { firebaseServices } from "../../lib/firebase";
import { useAuth } from "./AuthProvider";
import { AuthLayout } from "./AuthLayout";
import { RegistrationPage, type RegistrationValues } from "./RegistrationPage";
import { AccountDeletionPending } from './AccountDeletionPending';

type Status = "checking" | "registered" | "missing" | "deleting" | "error";
type ProfileContext = {
  profile:RoteivaProfile;
  saveProfile:(changes:ProfileChanges)=>Promise<void>;
};
const RegistrationProfileContext=createContext<ProfileContext|null>(null);
export function useRegistrationProfile(){return useContext(RegistrationProfileContext);}

export function RegistrationGate({children}: {children: ReactNode}) {
  const {user,intent,logout,busy}=useAuth();
  const repository=useMemo(()=>new FirestoreWorkspace(firebaseServices().db,user!.uid),[user!.uid]);
  const [status,setStatus]=useState<Status>("checking");
  const [showForm,setShowForm]=useState(intent==="register");
  const [attempt,setAttempt]=useState(0);
  const [error,setError]=useState("");
  const [profile,setProfile]=useState<RoteivaProfile|null>(null);
  const [creating,setCreating]=useState(false);

  useEffect(()=>{
    let active=true;
    setStatus("checking");
    setError("");
    repository.loadProfile()
      .then(result=>{if(active){setProfile(result);setStatus(result?.deletionState==="deleting"?"deleting":result?"registered":"missing");}})
      .catch(reason=>{if(active){setError(dataErrorMessage(reason));setStatus("error");}});
    return ()=>{active=false;};
  },[repository,attempt]);

  async function register(values: RegistrationValues) {
    if(!user||creating)return;
    setCreating(true);setError("");
    try {
      await repository.registerProfile({
        ...values,email:user.email||"",photoURL:user.photoURL||"",
        acknowledgedDataUse:true,
      });
      const saved=await repository.loadProfile();
      if (!saved) throw new Error("Conflito: o perfil não foi encontrado depois do cadastro.");
      setProfile(saved);
      setStatus("registered");
    } catch (reason) {
      setError(dataErrorMessage(reason));
    } finally {
      setCreating(false);
    }
  }

  async function saveProfile(changes:ProfileChanges) {
    if(!profile) throw new Error("Conflito: perfil não carregado.");
    const updated=await repository.saveProfile(changes,profile.revision);
    setProfile(updated);
  }

  if(!user)return null;
  if(status==="checking")return <main className="studio-loading" role="status">Verificando seu cadastro…</main>;
  if(status==="registered" && profile)return <RegistrationProfileContext.Provider value={{profile,saveProfile}}>{children}</RegistrationProfileContext.Provider>;
  if(status==="deleting")return <AccountDeletionPending/>;
  if(status==="error")return <AuthLayout section="CONEXÃO" title="Não foi possível consultar seu cadastro." description="Não vamos criar uma nova conta enquanto não for possível confirmar o estado do seu espaço.">
    <p className="auth-error" role="alert">{error}</p>
    <div className="auth-row-actions"><button className="auth-primary" onClick={()=>setAttempt(n=>n+1)}>Tentar novamente <ArrowRight size={16}/></button><button className="auth-link" onClick={()=>void logout()} disabled={busy}>Trocar conta</button></div>
  </AuthLayout>;
  if(showForm)return <RegistrationPage user={user} submitting={creating} error={error} onSubmit={register} onExit={()=>void logout()}/>;
  return <AuthLayout section="02 — PRIMEIRO ACESSO" title="Ainda não encontramos seu espaço." description="Sua identidade Google foi confirmada, mas você ainda não concluiu o cadastro no Roteiva.">
    <div className="auth-account-note">
      {user.photoURL?<img src={user.photoURL} alt="" referrerPolicy="no-referrer"/>:<span className="auth-avatar-fallback">{user.displayName?.slice(0,1)||"R"}</span>}
      <div><strong>{user.displayName||"Conta Google"}</strong><span>{user.email}</span></div>
    </div>
    <p className="auth-invitation">Se quiser começar, vamos cadastrar seu perfil e preparar um espaço privado.</p>
    <button className="auth-primary" type="button" onClick={()=>setShowForm(true)}>Criar meu espaço <ArrowRight size={17}/></button>
    <button className="auth-link" type="button" onClick={()=>void logout()} disabled={busy}>Voltar e usar outra conta</button>
  </AuthLayout>;
}
