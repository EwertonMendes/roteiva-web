import {AppButton} from "../ui/AppButton";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { FirestoreWorkspace, dataErrorMessage, type RoteivaProfile, type ProfileChanges } from "../../data/firestore-workspace";
import { firebaseServices } from "../../lib/firebase";
import { retryFirestoreRead } from "../../data/firestore-recovery";
import {loadRegistrationProfile} from '../../data/registration-profile.ts';
import { useAuth } from "./AuthProvider";
import { AuthLayout } from "./AuthLayout";
import { RegistrationPage, type RegistrationValues } from "./RegistrationPage";
import { AccountDeletionPending } from './AccountDeletionPending';
import { fetchAccountDeletionStatus } from '../settings/AccountDeletionAction';

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
    // A missing profile can coexist with a durable deletion job in D1.
    // Verify BOTH read-only dependencies before allowing a new registration.
    // Transient failures in either dependency are retried; writes never are.
    retryFirestoreRead(async()=>{
      const result=await loadRegistrationProfile(firebaseServices().db,user!.uid,repository);
      if(result?.deletionState==='deleting')return {result,deleting:true};
      if(result)return {result,deleting:false};
      const deletion=await fetchAccountDeletionStatus();
      return {result,deleting:deletion.operation!==null};
    },{attempts:4,delaysMs:[300,900,2000],isCurrent:()=>active})
      .then(({result,deleting})=>{
        if(active){setProfile(result);setStatus(deleting?'deleting':result?'registered':'missing');}
      })
      .catch(reason=>{
        if(!active)return;
        const code=(reason as {code?:unknown}|null)?.code;
        console.warn('[Roteiva] Primeiro acesso não confirmado',{step:'registration-read',
          code:typeof code==='string'?code.slice(0,64):'unknown'});
        setError(dataErrorMessage(reason));setStatus("error");
      });
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
      const saved=await retryFirestoreRead(
        ()=>loadRegistrationProfile(firebaseServices().db,user.uid,repository),
        {attempts:3,delaysMs:[300,900]}
      );
      if (!saved) throw new Error("Conflito: o perfil não foi encontrado depois do cadastro.");
      setProfile(saved);
      setStatus("registered");
    } catch (reason) {
      // Transaction commit may succeed before its response reaches the client.
      // Verify the authoritative profile by READ, never replay an uncertain write.
      try{
        const confirmed=await retryFirestoreRead(
          ()=>loadRegistrationProfile(firebaseServices().db,user.uid,repository),
          {attempts:2,delaysMs:[400]}
        );
        if(confirmed?.deletionState==='deleting'){setStatus('deleting');return;}
        if(confirmed && confirmed.displayName===values.displayName.trim() &&
          confirmed.studioName===values.studioName.trim() &&
          confirmed.professionalType===values.professionalType){
          setProfile(confirmed);setStatus('registered');return;
        }
      }catch{/* Failed verification must never authorize a registration. */}
      const code=(reason as {code?:unknown}|null)?.code;
      console.warn('[Roteiva] Cadastro não confirmado',{step:'registration-write',
        code:typeof code==='string'?code.slice(0,64):'unknown'});
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
    <div className="auth-row-actions"><AppButton className="auth-primary" onClick={()=>setAttempt(n=>n+1)}>Tentar novamente <ArrowRight size={16}/></AppButton><AppButton className="auth-link" onClick={()=>void logout()} disabled={busy}>Trocar conta</AppButton></div>
  </AuthLayout>;
  if(showForm)return <RegistrationPage user={user} submitting={creating} error={error} onSubmit={register} onExit={()=>void logout()}/>;
  return <AuthLayout section="02 — PRIMEIRO ACESSO" title="Ainda não encontramos seu espaço." description="Sua identidade Google foi confirmada, mas você ainda não concluiu o cadastro no Roteiva.">
    <div className="auth-account-note">
      {user.photoURL?<img src={user.photoURL} alt="" referrerPolicy="no-referrer"/>:<span className="auth-avatar-fallback">{user.displayName?.slice(0,1)||"R"}</span>}
      <div><strong>{user.displayName||"Conta Google"}</strong><span>{user.email}</span></div>
    </div>
    <p className="auth-invitation">Se quiser começar, vamos cadastrar seu perfil e preparar um espaço privado.</p>
    <AppButton className="auth-primary" type="button" onClick={()=>setShowForm(true)}>Criar meu espaço <ArrowRight size={17}/></AppButton>
    <AppButton className="auth-link" type="button" onClick={()=>void logout()} disabled={busy}>Voltar e usar outra conta</AppButton>
  </AuthLayout>;
}
