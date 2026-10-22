import { AppSelect } from "../ui/AppSelect";
import { useEffect, useState, type FormEvent } from "react";
import { ArrowUpRight, Check, Cloud, LockKeyhole, Moon, ShieldCheck, Sun, UserRound, Video, Info, Building2, BriefcaseBusiness, AlertTriangle } from "lucide-react";
import type { ProfileChanges, ProfessionalType, RoteivaProfile } from "../../data/firestore-workspace";
import { dataErrorMessage } from "../../data/firestore-workspace";
import { IconLabel } from "../ui/IconLabel";
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
      setFeedback({kind:"success",message:"Perfil e estúdio salvos na nuvem."});
    }catch(reason){
      setFeedback({kind:"error",message:dataErrorMessage(reason)});
    }finally{setBusy(false);}
  }
  const studioName=profile?.studioName.trim()||"Meu estúdio";
  return <div className="settings-layout">
    <section className="settings-identity" aria-label="Identidade do estúdio">
      <div className="settings-identity-copy">
        <span className="settings-kicker"><Video size={14}/> IDENTIDADE DO SEU TRABALHO</span>
        <h2>{studioName}</h2>
        <p>Um espaço organizado para tudo o que você cria.</p>
        <div className="settings-identity-tag"><span className="settings-status-dot"/>{onSaveProfile?"SEU ESPAÇO PRIVADO":"MODO DEMONSTRAÇÃO"}</div>
      </div>
      <div className="settings-orbit" aria-hidden="true"><span/><span/><span/></div>
    </section>

    <form className="settings-editor" onSubmit={save}>
      <div className="settings-section-head">
        <div><span className="settings-index">01 / IDENTIFICAÇÃO</span><h3>Perfil profissional</h3><p>As informações que identificam você dentro do Roteiva.</p></div>
        <UserRound size={20} strokeWidth={1.5}/>
      </div>
      <div className="settings-profile-summary">
        {photoURL?<img src={photoURL} alt="" referrerPolicy="no-referrer"/>:<div className="settings-monogram" aria-hidden="true">{(profile?.displayName||"R").slice(0,1).toUpperCase()}</div>}
        <div><strong>{profile?.displayName||"Visitante"}</strong><span>{email}</span></div>
        <div className="settings-linked"><ShieldCheck size={15}/> Google</div>
      </div>
      <div className="settings-form-grid">
        <label className="settings-field"><span><IconLabel icon={UserRound}>Nome profissional</IconLabel></span>
          <input aria-label="Nome profissional" autoComplete="name" maxLength={120} required minLength={2} value={name} onChange={e=>{setName(e.target.value);setFeedback(null);}} disabled={!onSaveProfile||busy}/>
        </label>
        <label className="settings-field settings-readonly"><span>E-mail de acesso <LockKeyhole size={13}/></span>
          <input aria-label="E-mail de acesso" readOnly value={email} title="Gerenciado pela sua conta Google"/>
          <small>Identidade verificada pelo Google; não é editada no Roteiva.</small>
        </label>
      </div>
      <div className="settings-section-rule"/>
      <div className="settings-section-head">
        <div><span className="settings-index">02 / SEU NEGÓCIO</span><h3>Meu estúdio</h3><p>Personalize como seu espaço é identificado no painel.</p></div>
        <Video size={20} strokeWidth={1.5}/>
      </div>
      <div className="settings-form-grid">
        <label className="settings-field"><span><IconLabel icon={Building2}>Nome do estúdio ou marca</IconLabel> <em>opcional</em></span>
          <input aria-label="Nome do estúdio ou marca" maxLength={120} autoComplete="organization" value={studio} placeholder="Ex.: Estúdio Aurora" onChange={e=>{setStudio(e.target.value);setFeedback(null);}} disabled={!onSaveProfile||busy}/>
        </label>
        <label className="settings-field"><span><IconLabel icon={BriefcaseBusiness}>Tipo de atuação</IconLabel></span>
          <AppSelect aria-label="Tipo de atuação" value={occupation} onValueChange={value=>{setOccupation(value as ProfessionalType);setFeedback(null);}} disabled={!onSaveProfile||busy}>
            {occupations.map(item=><option key={item.value} value={item.value}>{item.label}</option>)}
          </AppSelect>
        </label>
      </div>
      {!onSaveProfile&&<p className="settings-note"><Info size={15}/> Na demonstração, suas alterações ficam apenas neste navegador. Entre na sua conta para personalizar seu perfil.</p>}
      {feedback&&<p className={`settings-feedback settings-feedback-${feedback.kind}`} role={feedback.kind==="error"?"alert":"status"}>{feedback.kind==="success"?<Check size={16}/>:<Info size={16}/>} {feedback.message}{feedback.kind==="error"&&feedback.message.startsWith("Conflito")&&<button type="button" onClick={()=>window.location.reload()}>Atualizar perfil</button>}</p>}
      <div className="settings-actions">
        <span>{profile?.legacy?"Seu cadastro antigo continua preservado.":"Os dados são exclusivos da sua conta."}</span>
        <button type="submit" className="primary-button" disabled={!onSaveProfile||!changed||!valid||busy}>{busy?"Salvando…":"Salvar alterações"} <ArrowUpRight size={16}/></button>
      </div>
    </form>

    <section className="settings-editor settings-preferences" aria-labelledby="settings-preferences-title">
      <div className="settings-section-head">
        <div><span className="settings-index">03 / EXPERIÊNCIA</span><h3 id="settings-preferences-title">Preferências</h3><p>Deixe o ambiente de trabalho confortável para você.</p></div>
        <Sun size={20} strokeWidth={1.5}/>
      </div>
      <div className="settings-pref-row">
        <div><strong>Aparência do Roteiva</strong><p>Seu tema {onSaveProfile?"é sincronizado com sua conta.":"fica salvo neste navegador."}</p></div>
        <div className="settings-theme-choices" role="group" aria-label="Tema da interface">
          <button type="button" className={theme==="light"?"selected":""} aria-pressed={theme==="light"} onClick={()=>theme!=="light"&&toggleTheme()}><Sun size={16}/> Claro</button>
          <button type="button" className={theme==="dark"?"selected":""} aria-pressed={theme==="dark"} onClick={()=>theme!=="dark"&&toggleTheme()}><Moon size={16}/> Escuro</button>
        </div>
      </div>
    </section>

    {onSaveProfile&&<AccessSummary/>}

    {onSaveProfile&&<section className="settings-editor settings-danger-zone" aria-labelledby="settings-danger-title">
      <div className="settings-section-head">
        <div><span className="settings-danger-eyebrow"><AlertTriangle size={14}/> AÇÕES IRREVERSÍVEIS</span>
          <h3 id="settings-danger-title">Zona de perigo</h3>
          <p>Alterações nesta área podem resultar na perda permanente dos seus dados.</p>
        </div>
        <AlertTriangle size={21} strokeWidth={1.65} aria-hidden="true"/>
      </div>
      <AccountDeletionAction/>
    </section>}
    <footer className="settings-footer"><Cloud size={14}/>{onSaveProfile?"ROTEIVA · SEU ESPAÇO PRIVADO":"ROTEIVA DEMO · SOMENTE NESTE NAVEGADOR"}</footer>
  </div>;
}
