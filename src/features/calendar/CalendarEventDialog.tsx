import {useEffect,useMemo,useRef,useState,type FormEvent} from "react";
import {CalendarDays,Check,Clock3,Folder,Info,Trash2,UserRound,Video,X} from "lucide-react";
import {AppButton} from "../ui/AppButton";
import {AppInput} from "../ui/AppInput";
import {AppSelect} from "../ui/AppSelect";
import type {CalendarEvent,Client,Project} from "../../domain/workspace";
import {eventDuration,eventRange,overlaps,timeMinutes,validTimeRange} from "../../studio-calendar";
import {isValidCivilDate,todayKey} from "./calendar-dates";
import {CalendarDateField,CalendarTimeField} from "./CalendarDateTimeField";

export type CalendarDraft={
  title:string;type:CalendarEvent["type"];date:string;time:string;endTime:string;
  client:string;projectId?:number;
};
type Props={
  editing:CalendarEvent|null;date:string;projects:Project[];clients:Client[];
  events:CalendarEvent[];preferredProjectId?:number|null;
  onSave:(draft:CalendarDraft)=>void;onCancel:()=>void;onDelete?:(entry:CalendarEvent)=>void;
};
const typeOptions:CalendarEvent["type"][]=["Produção","Entrega","Reunião","Aprovação","Revisão"];

export function CalendarEventDialog({editing,date,projects,clients,events,preferredProjectId,onSave,onCancel,onDelete}:Props){
  const dialog=useRef<HTMLDialogElement>(null);
  const input=useRef<HTMLInputElement>(null);
  const initialProjectId=editing?.projectId||preferredProjectId||0;
  const initialProject=projects.find(p=>p.id===initialProjectId);
  const [title,setTitle]=useState(editing?.title||"");
  const [type,setType]=useState<CalendarEvent["type"]>(editing?.type||"Produção");
  const [eventDate,setEventDate]=useState(editing?.date||date||todayKey());
  const [time,setTime]=useState(editing?.time||"09:00");
  const [endTime,setEndTime]=useState(editing?.endTime||"");
  const [client,setClient]=useState(editing?.client==="Interno"?"":editing?.client||initialProject?.client||"");
  const [projectId,setProjectId]=useState(initialProjectId?String(initialProjectId):"");
  const [error,setError]=useState("");
  const [validationAttempted,setValidationAttempted]=useState(false);
  const locked=!!editing?.autoDeadline;
  useEffect(()=>{
    const node=dialog.current;
    node?.showModal();
    input.current?.focus();
    return ()=>{if(node?.open)node.close();};
  },[]);
  const sortedClients=useMemo(()=>[...clients].sort((a,b)=>a.name.localeCompare(b.name,"pt-BR")),[clients]);
  const clientMatches=sortedClients.some(c=>c.name===client);
  const matchingClient=sortedClients.find(c=>c.name===client);
  const filteredProjects=useMemo(()=>{
    return [...projects].filter(p=>!client||p.clientId===matchingClient?.id||p.client===client||String(p.id)===projectId)
      .sort((a,b)=>a.name.localeCompare(b.name,"pt-BR"));
  },[projects,client,matchingClient?.id,projectId]);
  const conflict=useMemo(()=>{
    if(!endTime||!validTimeRange(time,endTime)||!isValidCivilDate(eventDate))return [];
    return events.filter(e=>overlaps({id:editing?.id||-1,date:eventDate,time,endTime},e));
  },[editing?.id,eventDate,time,endTime,events]);
  function save(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    setValidationAttempted(true);
    const cleanTitle=title.trim();
    if(!cleanTitle){setError("Informe o título do compromisso.");return;}
    if(!isValidCivilDate(eventDate)){setError("Selecione uma data válida.");return;}
    if(!Number.isFinite(timeMinutes(time))){setError("Informe um horário de início válido.");return;}
    if(endTime&&!validTimeRange(time,endTime)){setError("O término precisa ser depois do início, no mesmo dia.");return;}
    const chosenProject=projects.find(p=>String(p.id)===projectId);
    if(projectId&&!chosenProject){setError("O projeto selecionado não está disponível.");return;}
    if(locked&&(type!=="Entrega"||Number(projectId)!==editing?.projectId)){
      setError("O prazo automático mantém o tipo e o projeto originais.");return;
    }
    onSave({title:cleanTitle,type,date:eventDate,time,endTime,client:client||"Interno",projectId:Number(projectId)||undefined});
  }
  function selectClient(value:string){
    setClient(value);
    const linked=projects.find(p=>String(p.id)===projectId);
    const nextClient=sortedClients.find(c=>c.name===value);
    if(linked&&value&&linked.client!==value&&linked.clientId!==nextClient?.id)setProjectId("");
  }
  function selectProject(value:string){
    setProjectId(value);
    const linked=projects.find(p=>String(p.id)===value);
    if(linked&&linked.client&&linked.client!=="Interno")setClient(linked.client);
  }
  return <dialog ref={dialog} className="roteiva-calendar-dialog roteiva-calendar-form" aria-labelledby="calendar-event-title"
    onClose={onCancel} onMouseDown={event=>{if(event.target===event.currentTarget)event.currentTarget.close();}}>
    <form onSubmit={save} noValidate>
      <div className="calendar-dialog-head calendar-form-title">
        <CalendarDays size={26} aria-hidden="true"/>
        <div><h2 id="calendar-event-title">{editing?"Editar compromisso":"Novo compromisso"}</h2>
          <p>Organize sua agenda e reserve o tempo de cada trabalho.</p></div>
        <AppButton className="calendar-dialog-close" aria-label="Fechar cadastro" type="button" onClick={onCancel}><X size={21}/></AppButton>
      </div>
      <div className="calendar-form-section calendar-form-basic">
        <label className="calendar-basic-field">Título do compromisso
          <AppInput id="calendar-title" ref={input} maxLength={200} value={title} onChange={event=>{setTitle(event.target.value);setError("");}}
            placeholder="Ex.: Gravação externa — campanha verão" required/>
        </label>
        <label className="calendar-basic-field">Tipo de compromisso
          <div className="calendar-field-with-icon"><Video size={19} aria-hidden="true"/>
            <AppSelect id="calendar-type" aria-label="Tipo de compromisso" value={type} onValueChange={value=>setType(value as CalendarEvent["type"])} disabled={locked}>
              {typeOptions.map(option=><option key={option} value={option}>{option}</option>)}
            </AppSelect>
          </div>
        </label>
      </div>
      <div className="calendar-form-section">
        <h3><CalendarDays size={19} aria-hidden="true"/>Data e horário</h3>
        <div className="calendar-date-fields">
          <div className="calendar-datetime-field">
            <span className="calendar-field-caption">Data</span>
            <CalendarDateField value={eventDate} showValidation={validationAttempted} onChange={value=>{setEventDate(value);setError("");}}/>
          </div>
          <div className="calendar-datetime-field">
            <span className="calendar-field-caption">Início</span>
            <CalendarTimeField label="Início do compromisso" value={time} showValidation={validationAttempted} onChange={value=>{setTime(value);setError("");}}/>
          </div>
          <div className="calendar-datetime-field">
            <span className="calendar-field-caption">Término <em>(opcional)</em></span>
            <CalendarTimeField label="Término do compromisso" optional value={endTime} showValidation={validationAttempted}
              rangeError={endTime&&Number.isFinite(timeMinutes(time))&&Number.isFinite(timeMinutes(endTime))&&!validTimeRange(time,endTime)?"O término precisa ser após o início.":""}
              onChange={value=>{setEndTime(value);setError("");}}/>
          </div>
        </div>
        {!endTime&&<p className="calendar-form-hint"><Info size={16}/>Sem término definido, apenas o início será registrado.</p>}
        {endTime&&validTimeRange(time,endTime)&&<div className={"event-availability"+(conflict.length?" has-overlap":"")} role="status">
          <Clock3 size={16}/><div><b>{eventDuration({time,endTime})} de duração{conflict.length?" · atenção ao horário":" · horário disponível"}</b>
          <span>{conflict.length?"Coincide com: "+conflict.map(e=>e.title+" ("+eventRange(e)+")").join("; ")+". Compromissos simultâneos são permitidos.":"Nenhum outro compromisso com duração definida neste intervalo."}</span></div>
        </div>}
      </div>
      <div className="calendar-form-section">
        <h3><Folder size={19} aria-hidden="true"/>Vincular ao trabalho <span>(opcional)</span></h3>
        <div className="calendar-link-fields">
          <label>Cliente<div className="calendar-field-with-icon"><UserRound size={18} aria-hidden="true"/>
            <AppSelect aria-label="Cliente do compromisso" value={client} onValueChange={selectClient} placeholder="Selecionar cliente">
              <option value="">Sem cliente</option>
              {sortedClients.map(item=><option value={item.name} key={item.id}>{item.name}</option>)}
              {client&&!clientMatches&&<option value={client}>Cliente existente: {client}</option>}
            </AppSelect>
          </div></label>
          <label>Projeto<div className="calendar-field-with-icon"><Folder size={18} aria-hidden="true"/>
            <AppSelect aria-label="Projeto do compromisso" value={projectId} onValueChange={selectProject} disabled={locked}>
              <option value="">Sem projeto</option>
              {filteredProjects.map(item=><option value={String(item.id)} key={item.id}>{item.name}</option>)}
            </AppSelect>
          </div></label>
        </div>
        <p className="calendar-form-hint"><Info size={16}/>{locked
          ?"Este prazo foi criado pelo projeto. A data será sincronizada ao salvar; para remover o prazo, edite o projeto."
          :"Associe este compromisso a um cliente ou projeto cadastrado."}</p>
      </div>
      {error&&<p className="event-form-error calendar-save-error" role="alert">{error}</p>}
      <div className="calendar-form-actions">
        {editing&&!locked&&onDelete&&<AppButton className="calendar-delete-action" type="button" onClick={()=>onDelete(editing)}><Trash2 size={17}/> Excluir</AppButton>}
        <div className="calendar-form-action-right">
          <AppButton className="secondary-button" type="button" onClick={onCancel}>Cancelar</AppButton>
          <AppButton className="primary-button" type="submit"><Check size={20}/> Salvar compromisso</AppButton>
        </div>
      </div>
    </form>
  </dialog>;
}
