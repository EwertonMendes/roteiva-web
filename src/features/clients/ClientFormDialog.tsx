import {AppInput} from "../ui/AppInput";
import {AppButton} from "../ui/AppButton";
import {useState,type FormEvent} from "react";
import {AppModal,AppModalHeader,AppModalBody,AppModalFooter} from "../ui/AppModal";
import {Building2,ChevronRight,ReceiptText} from "lucide-react";
import type {Client,ClientType} from "../../domain/workspace";
import {BrazilPhoneInput} from "../ui/BrazilPhoneInput";
import {MoneyInput} from "../ui/MoneyInput";

type Props={client:Client|null;onClose:()=>void;onSubmit:(event:FormEvent<HTMLFormElement>)=>void};
export function ClientFormDialog({client,onClose,onSubmit}:Props){
 const [type,setType]=useState<ClientType>(client?.type||"Recorrente");
 return <AppModal size="wide" className="cd-form-dialog" onCloseRequest={onClose}
  aria-labelledby="cd-form-title" aria-describedby="cd-form-description">
   <form className="rt-modal__layout cd-form" onSubmit={onSubmit}>
     <AppModalHeader title={client?"Atualize os dados do cliente":"Cadastre um novo cliente"}
       titleId="cd-form-title" descriptionId="cd-form-description"
       eyebrow={client?"EDITAR CLIENTE":"NOVO CLIENTE"}
       description="Defina o perfil para acompanhar recorrência e histórico de trabalhos."
       onClose={onClose} closeLabel="Fechar cadastro"/>
     <AppModalBody className="cd-form-fields">

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
     </AppModalBody>
     <AppModalFooter className="cd-form-actions"><AppButton type="button" variant="secondary" onClick={onClose}>Cancelar</AppButton>
       <AppButton type="submit" variant="primary">Salvar cliente <ChevronRight size={18}/></AppButton>
     </AppModalFooter>
   </form>
 </AppModal>;
}
