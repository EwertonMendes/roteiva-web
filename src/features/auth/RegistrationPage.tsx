import { useState, type FormEvent } from "react";
import { ArrowRight, Check, ChevronLeft, CircleHelp, UserRound } from "lucide-react";
import type { User } from "firebase/auth";
import { AuthLayout } from "./AuthLayout";

export type ProfessionalType = "freelancer" | "studio" | "producer" | "other";
export type RegistrationValues = {displayName:string;studioName:string;professionalType:ProfessionalType};
const types: {value:ProfessionalType;label:string;description:string}[]=[
  {value:"freelancer",label:"Freelancer",description:"Trabalho por conta própria"},
  {value:"studio",label:"Estúdio",description:"Tenho meu espaço de criação"},
  {value:"producer",label:"Produtora",description:"Atuo com uma equipe"},
  {value:"other",label:"Outro",description:"Meu trabalho é diferente"},
];

export function RegistrationPage({user,submitting,error,onSubmit,onExit}:{
  user:User;submitting:boolean;error:string;
  onSubmit:(values:RegistrationValues)=>Promise<void>;onExit:()=>void;
}) {
  const [displayName,setDisplayName]=useState(user.displayName||"");
  const [studioName,setStudioName]=useState("");
  const [professionalType,setProfessionalType]=useState<ProfessionalType>("freelancer");
  const [acknowledged,setAcknowledged]=useState(false);
  const valid=displayName.trim().length>=2&&displayName.trim().length<=120&&studioName.trim().length<=120&&acknowledged;
  function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();if(valid&&!submitting)void onSubmit({displayName:displayName.trim(),studioName:studioName.trim(),professionalType});}
  return <AuthLayout section="02 — SEU ESPAÇO" title="Vamos deixar tudo com a sua cara." description="Só o essencial para preparar um espaço que combina com o seu trabalho.">
    <div className="auth-account-note">
      {user.photoURL?<img src={user.photoURL} alt="" referrerPolicy="no-referrer"/>:<span className="auth-avatar-fallback"><UserRound size={20}/></span>}
      <div><strong>{user.email||"Conta Google"}</strong><span>Identidade confirmada pelo Google</span></div>
      <span className="auth-account-check" aria-label="Google conectado"><Check size={16}/></span>
    </div>
    <p className="auth-invitation">Comece com <strong>7 dias de acesso gratuito</strong> a todas as ferramentas. Não precisa de cartão e nenhuma cobrança será feita automaticamente.</p>
    <form className="register-form" onSubmit={submit} noValidate>
      <label className="auth-field" htmlFor="registration-name">
        <span>Como podemos chamar você? <b>*</b></span>
        <input id="registration-name" name="displayName" autoComplete="name" maxLength={120} minLength={2} required value={displayName} onChange={e=>setDisplayName(e.target.value)} placeholder="Seu nome profissional"/>
      </label>
      <label className="auth-field" htmlFor="registration-studio">
        <span>Nome do estúdio ou marca <em>opcional</em></span>
        <input id="registration-studio" name="studioName" autoComplete="organization" maxLength={120} value={studioName} onChange={e=>setStudioName(e.target.value)} placeholder="Ex.: Estúdio Aurora"/>
      </label>
      <fieldset className="auth-type-field">
        <legend>Como você trabalha?</legend>
        <div className="auth-type-grid">
          {types.map(type=><label key={type.value} className={professionalType===type.value?"auth-type-option selected":"auth-type-option"}>
            <input type="radio" name="professionalType" value={type.value} checked={professionalType===type.value} onChange={()=>setProfessionalType(type.value)}/>
            <span><strong>{type.label}</strong><small>{type.description}</small></span>
            <span className="auth-radio-mark" aria-hidden="true">{professionalType===type.value&&<Check size={12}/>}</span>
          </label>)}
        </div>
      </fieldset>
      <label className="auth-confirmation">
        <input type="checkbox" name="dataAcknowledgement" checked={acknowledged} onChange={e=>setAcknowledged(e.target.checked)} required/>
        <span>Concordo com o uso dos meus dados para criar minha conta e organizar meu espaço no Roteiva. <b>*</b></span>
      </label>
      <details className="auth-data-note"><summary><CircleHelp size={15}/> Como meus dados são usados?</summary><p>Seu nome, e-mail e foto do Google identificam sua conta. Os dados de clientes e projetos ficam no seu espaço privado. Para impedir testes gratuitos repetidos após a exclusão, preservamos um marcador criptográfico pseudonimizado da identidade Google/e-mail verificado, sem guardar o e-mail nesse marcador. A conexão com o Google Drive é opcional, e seus arquivos continuam na sua conta Google.</p></details>
      {error&&<p className="auth-error" role="alert">{error}</p>}
      <button className="auth-primary" type="submit" disabled={!valid||submitting}>{submitting?"Criando seu espaço…":"Criar meu espaço de trabalho"}<ArrowRight size={17}/></button>
      <button className="auth-link" type="button" disabled={submitting} onClick={onExit}><ChevronLeft size={16}/> Sair sem criar conta</button>
    </form>
  </AuthLayout>;
}
