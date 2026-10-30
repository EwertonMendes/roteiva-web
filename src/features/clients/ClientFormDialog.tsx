import {AppInput} from "../ui/AppInput";
import {AppButton} from "../ui/AppButton";
import {useState,type FormEvent} from "react";
import {AppDialog} from "../ui/AppDialog";
import {Building2,ChevronRight,ReceiptText,X} from "lucide-react";
import type {Client,ClientType} from "../../domain/workspace";
import {BrazilPhoneInput} from "../ui/BrazilPhoneInput";
import {MoneyInput} from "../ui/MoneyInput";

type Props={client:Client|null;onClose:()=>void;onSubmit:(event:FormEvent<HTMLFormElement>)=>void};
export function ClientFormDialog({client,onClose,onSubmit}:Props){
 const [type,setType]=useState<ClientType>(client?.type||"Recorrente");
 return <AppDialog className="cd-form-dialog" data-native-cursor onCloseRequest={onClose}
  aria-labelledby="cd-form-title" aria-describedby="cd-form-description">
   <form className="cd-form" onSubmit={onSubmit}>
     <header className="cd-form-header"><div>
       <span className="eyebrow">{client?"EDITAR CLIENTE":"NOVO CLIENTE"}</span>
       <h2 id="cd-form-title">{client?"Atualize os dados do cliente":"Cadastre um novo cliente"}</h2>
       <p id="cd-form-description">Defina o perfil para acompanhar recorrência e histórico de trabalhos.</p>
      </div><AppButton className="cd-form-close" type="button" aria-label="Fechar cadastro" onClick={onClose}><X size={22}/></AppButton>
     </header>
     <div className="cd-form-fields">
      <label>Nome do cliente<AppInput name="name" maxLength={200} required autoFocus defaultValue={client?.name} placeholder="Ex.: Estúdio Aurora"/></label>
      <div className="cd-form-grid"><label>Contato principal<AppInput name="contact" maxLength={500} defaultValue={client?.contact} placeholder="Nome do contato"/></label>
        <label>Telefone<BrazilPhoneInput name="phone" defaultValue={client?.phone} placeholder="(11) 99999-9999" /></label></div>
      <label>E-mail<AppInput name="email" type="email" autoComplete="email" maxLength={254} defaultValue={client?.email} placeholder="contato@empresa.com"/></label>
      <fieldset className="cd-form-types"><legend>Tipo de relacionamento</legend>
       <label><AppInput type="radio" name="type" value="Recorrente" checked={type==="Recorrente"} onChange={()=>setType("Recorrente")}/>
        <span><Building2 size={24}/><strong>Recorrente</strong><small>Cliente com trabalhos contínuos</small></span></label>
       <label><AppInput type="radio" name="type" value="Avulso" checked={type==="Avulso"} onChange={()=>setType("Avulso")}/>
        <span><ReceiptText size={24}/><strong>Avulso</strong><small>Um trabalho ou projeto pontual</small></span></label>
      </fieldset>
      {type==="Recorrente"&&<div className="cd-form-recurring">
        <label>Pacote mensal (opcional)<AppInput name="packageTitle" maxLength={500} defaultValue={client?.packageTitle} placeholder="Ex.: Conteúdo para redes sociais"/></label>
        <div className="cd-form-grid"><label>Entregas por mês<AppInput name="monthlyDeliverables" type="number" min="0" max="100" step="1" defaultValue={client?.monthlyDeliverables||""} placeholder="0"/></label>
          <label>Valor mensal combinado<MoneyInput name="monthlyFee" defaultValue={client?.monthlyFee}/></label></div>
       </div>}
     </div>
     <footer className="cd-form-actions"><AppButton type="button" className="secondary-button" onClick={onClose}>Cancelar</AppButton>
       <AppButton type="submit" className="primary-button">Salvar cliente <ChevronRight size={18}/></AppButton>
     </footer>
   </form>
 </AppDialog>;
}
