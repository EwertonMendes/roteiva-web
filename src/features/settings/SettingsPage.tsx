import {AppInput} from "../ui/AppInput";
import {AppButton} from "../ui/AppButton";
import { AppSelect } from "../ui/AppSelect";
import { useEffect, useState, type FormEvent } from "react";
import { AlertTriangle, Check, Info, LockKeyhole, Mail, Moon, Save, Settings2, ShieldCheck, Store, Sun, Tag, UserRound, Video } from "lucide-react";
import type { ProfileChanges, ProfessionalType, RoteivaProfile } from "../../data/firestore-workspace";
import { dataErrorMessage } from "../../data/firestore-workspace";
import { AccountDeletionAction } from "./AccountDeletionAction";
import { AccessSummary } from "../access/AccessGate";

const occupations:{value:ProfessionalType;label:string}[]=[
  {value:"freelancer",label:"Videomaker / freelancer"},
  {value:"studio",label:"Estúdio"},
  {value:"producer",label:"Produtora"},
  {value:"other",label:"Outro tipo de atuação"},
];

type SettingsProps={
  profile?: RoteivaProfile | null;
  email:string; photoURL?:string;
  theme:"light"|"dark"; toggleTheme:()=>void;
  onSaveProfile?:(changes:ProfileChanges)=>Promise<void>;
};

export function SettingsPage({profile,email,photoURL,theme,toggleTheme,onSaveProfile}:SettingsProps){
  const [name,setName]=useState(profile?.displayName||"");
  const [studio,setStudio]=useState(profile?.studioName||"");
  const [occupation,setOccupation]=useState<ProfessionalType>(profile?.professionalType||"freelancer");
  const [busy,setBusy]=useState(false);
  const [feedback,setFeedback]=useState<{kind:"success"|"error";message:string}|null>(null);
  useEffect(()=>{
    setName(profile?.displayName||"");setStudio(profile?.studioName||"");
    setOccupation(profile?.professionalType||"freelancer");
  },[profile]);
  const draft={displayName:name.trim(),studioName:studio.trim(),professionalType:occupation};
  const valid=draft.displayName.length>=2&&draft.displayName.length<=120&&draft.studioName.length<=120;
  const changed=!!profile && (
    draft.displayName!==profile.displayName ||
    draft.studioName!==profile.studioName ||
    draft.professionalType!==profile.professionalType
  );
  async function save(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(!onSaveProfile||!valid||!changed||busy)return;
    setBusy(true);setFeedback(null);
    try {
      await onSaveProfile(draft);
      setFeedback({kind:"success",message:"Perfil e estúdio atualizados com sucesso."});
    }catch(reason){
      setFeedback({kind:"error",message:dataErrorMessage(reason)});
    }finally{setBusy(false);}
  }
  const studioName=profile?.studioName.trim()||"Meu estúdio";
  return <div className="settings-layout">
    <section className="settings-identity" aria-label="Identidade do estúdio">
      <span className="settings-kicker"><Video size={17} aria-hidden="true"/> IDENTIDADE DO SEU TRABALHO</span>
      <h2>{studioName}</h2>
      <p>Um espaço organizado para tudo o que você cria.</p>
      <span className="settings-identity-tag"><span className="settings-status-dot" aria-hidden="true"/>{onSaveProfile?"SEU ESPAÇO PRIVADO":"MODO DEMONSTRAÇÃO"}</span>
    </section>

    <form className="settings-details" onSubmit={save}>
      <section className="settings-editor settings-profile" aria-labelledby="settings-profile-title">
        <header className="settings-section-head">
          <span className="settings-index"><UserRound size={17} aria-hidden="true"/> 01 / IDENTIFICAÇÃO</span>
          <h3 id="settings-profile-title">Perfil profissional</h3>
          <p>As informações que identificam você dentro do Roteiva.</p>
        </header>
        <div className="settings-profile-summary">
          {photoURL?<img src={photoURL} alt="" referrerPolicy="no-referrer"/>:<span className="settings-monogram" aria-hidden="true">{(profile?.displayName||"R").slice(0,1).toUpperCase()}</span>}
          <div className="settings-profile-info"><strong>{profile?.displayName||"Visitante"}</strong><span>{email}</span></div>
          <div className="settings-linked"><ShieldCheck size={18} aria-hidden="true"/> Google</div>
        </div>
        <div className="settings-form-grid">
          <label className="settings-field"><span><UserRound size={17} aria-hidden="true"/> Nome profissional</span>
            <AppInput aria-label="Nome profissional" autoComplete="name" maxLength={120} required minLength={2} value={name} onChange={e=>{setName(e.target.value);setFeedback(null);}} disabled={!onSaveProfile||busy}/>
          </label>
          <label className="settings-field settings-readonly"><span><Mail size={17} aria-hidden="true"/> E-mail de acesso <LockKeyhole size={15} aria-hidden="true"/></span>
            <AppInput aria-label="E-mail de acesso" readOnly value={email} title="Gerenciado pela sua conta Google"/>
            <small><ShieldCheck size={15} aria-hidden="true"/> Identidade verificada pelo Google.</small>
          </label>
        </div>
      </section>

      <section className="settings-editor settings-studio" aria-labelledby="settings-studio-title">
        <header className="settings-section-head">
          <span className="settings-index"><Store size={17} aria-hidden="true"/> 02 / MEU ESTÚDIO</span>
          <h3 id="settings-studio-title">Meu estúdio</h3>
          <p>Informações sobre o seu estúdio ou marca.</p>
        </header>
        <div className="settings-studio-controls">
          <label className="settings-field"><span><Store size={17} aria-hidden="true"/> Nome do estúdio ou marca</span>
            <AppInput aria-label="Nome do estúdio ou marca" maxLength={120} autoComplete="organization" value={studio} placeholder="Ex.: Estúdio Aurora" onChange={e=>{setStudio(e.target.value);setFeedback(null);}} disabled={!onSaveProfile||busy}/>
          </label>
          <label className="settings-field"><span><Tag size={17} aria-hidden="true"/> Tipo de atuação</span>
            <AppSelect aria-label="Tipo de atuação" value={occupation} onValueChange={value=>{setOccupation(value as ProfessionalType);setFeedback(null);}} disabled={!onSaveProfile||busy}>
              {occupations.map(item=><option key={item.value} value={item.value}>{item.label}</option>)}
            </AppSelect>
          </label>
          <AppButton type="submit" className="settings-save-button" disabled={!onSaveProfile||!changed||!valid||busy}>
            {busy?"Salvando…":"Salvar alterações"} <Save size={16} aria-hidden="true"/>
          </AppButton>
        </div>
        {!onSaveProfile&&<p className="settings-note"><Info size={16} aria-hidden="true"/> Entre na sua conta para personalizar seu perfil e estúdio.</p>}
        {profile?.legacy&&<p className="settings-note"><Info size={16} aria-hidden="true"/> Seu cadastro anterior continua preservado.</p>}
        {feedback&&<p className={`settings-feedback settings-feedback-${feedback.kind}`} role={feedback.kind==="error"?"alert":"status"}>
          {feedback.kind==="success"?<Check size={16} aria-hidden="true"/>:<Info size={16} aria-hidden="true"/>}
          {feedback.message}
          {feedback.kind==="error"&&feedback.message.startsWith("Conflito")&&<AppButton type="button" onClick={()=>window.location.reload()}>Atualizar perfil</AppButton>}
        </p>}
      </section>
    </form>

    <section className="settings-editor settings-preferences" aria-labelledby="settings-preferences-title">
      <header className="settings-section-head">
        <span className="settings-index"><Settings2 size={18} aria-hidden="true"/> 03 / PREFERÊNCIAS</span>
        <h3 id="settings-preferences-title">Aparência do Roteiva</h3>
        <p>Escolha o tema visual que você prefere.</p>
      </header>
      <div className="settings-theme-choices" role="group" aria-label="Tema da interface">
        <AppButton type="button" className={theme==="light"?"selected":""} aria-pressed={theme==="light"} onClick={()=>theme!=="light"&&toggleTheme()}><Sun size={20} aria-hidden="true"/> Claro</AppButton>
        <AppButton type="button" className={theme==="dark"?"selected":""} aria-pressed={theme==="dark"} onClick={()=>theme!=="dark"&&toggleTheme()}><Moon size={20} aria-hidden="true"/> Escuro</AppButton>
      </div>
    </section>

    {onSaveProfile&&<AccessSummary/>}

    {onSaveProfile&&<section className="settings-editor settings-danger-zone" aria-labelledby="settings-danger-title">
      <header className="settings-section-head">
        <span className="settings-index settings-danger-eyebrow"><AlertTriangle size={18} aria-hidden="true"/> 05 / ZONA DE PERIGO</span>
      </header>
      <AccountDeletionAction/>
    </section>}
  </div>;
}
