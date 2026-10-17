import { useEffect, useState, type FormEvent } from "react";
import { ArrowUpRight, Check, Cloud, Download, LockKeyhole, Moon, ShieldCheck, Sun, UserRound, Video, Info } from "lucide-react";
import type { ProfileChanges, ProfessionalType, RoteivaProfile } from "../../data/firestore-workspace";
import { dataErrorMessage } from "../../data/firestore-workspace";
import { WorkspaceTools } from "../../studio-features";
import { CACHE_CONSENT_KEY, persistentCacheEnabled, purgePrivateCache } from "../../lib/firebase";

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
  workspace:object; onLoadWorkspace?:()=>Promise<object>; cloudStatus:string; onNotify:(message:string)=>void;
  onSaveProfile?:(changes:ProfileChanges)=>Promise<void>;
};

export function SettingsPage({profile,email,photoURL,theme,toggleTheme,workspace,onLoadWorkspace,cloudStatus,onNotify,onSaveProfile}:SettingsProps){
  const [name,setName]=useState(profile?.displayName||"");
  const [studio,setStudio]=useState(profile?.studioName||"");
  const [occupation,setOccupation]=useState<ProfessionalType>(profile?.professionalType||"freelancer");
  const [busy,setBusy]=useState(false);
  const [localCache,setLocalCache]=useState(persistentCacheEnabled);
  const [cacheBusy,setCacheBusy]=useState(false);
  const [cacheError,setCacheError]=useState("");
  async function changePrivateCache(enable:boolean) {
    if (!onSaveProfile || cacheBusy) return;
    setCacheBusy(true);setCacheError("");
    try {
      if (!enable) await purgePrivateCache();
      localStorage.setItem(CACHE_CONSENT_KEY, enable ? "enabled" : "disabled");
      setLocalCache(enable);
      window.location.reload();
    } catch {
      setCacheError("Não foi possível limpar o cache privado. Feche outras abas do Roteiva e tente novamente.");
      setCacheBusy(false);
    }
  }
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
        <div className="settings-identity-tag"><span className="settings-status-dot"/>{onSaveProfile?"ESPAÇO PRIVADO · FIREBASE DEV":"MODO DEMONSTRAÇÃO"}</div>
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
        <label className="settings-field"><span>Nome profissional</span>
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
        <label className="settings-field"><span>Nome do estúdio ou marca <em>opcional</em></span>
          <input aria-label="Nome do estúdio ou marca" maxLength={120} autoComplete="organization" value={studio} placeholder="Ex.: Estúdio Aurora" onChange={e=>{setStudio(e.target.value);setFeedback(null);}} disabled={!onSaveProfile||busy}/>
        </label>
        <label className="settings-field"><span>Tipo de atuação</span>
          <select aria-label="Tipo de atuação" value={occupation} onChange={e=>{setOccupation(e.target.value as ProfessionalType);setFeedback(null);}} disabled={!onSaveProfile||busy}>
            {occupations.map(item=><option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
      </div>
      {!onSaveProfile&&<p className="settings-note"><Info size={15}/> O cadastro fica disponível somente no Roteiva DEV autenticado. Esta é a demonstração sem conta.</p>}
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

    <section className="settings-editor settings-privacy" aria-labelledby="settings-privacy-title">
      <div className="settings-section-head">
        <div><span className="settings-index">04 / CONTROLE</span><h3 id="settings-privacy-title">Dados e privacidade</h3><p>Você mantém o controle sobre as informações do seu espaço.</p></div>
        <LockKeyhole size={20} strokeWidth={1.5}/>
      </div>
      <div className="settings-privacy-row">
        <div><strong><Download size={16}/> Exportar dados do espaço</strong><p>Baixe uma cópia JSON dos registros carregados. A exportação não inclui arquivos de mídia, credenciais nem dados de autenticação.</p></div>
        <WorkspaceTools workspace={workspace} loadWorkspace={onLoadWorkspace} status={cloudStatus} onNotify={onNotify}/>
      </div>
      <p className="settings-note"><Info size={15}/> Exclusão de conta e dados ainda não está disponível. Esse procedimento precisa ser implementado com segurança antes da abertura pública.</p>
    </section>
    <footer className="settings-footer"><Cloud size={14}/>{onSaveProfile?"ROTEIVA DEV · PERFIL PRIVADO":"ROTEIVA DEMO · SOMENTE NESTE NAVEGADOR"}</footer>
  </div>;
}
