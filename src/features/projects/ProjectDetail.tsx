import {AppInput} from "../ui/AppInput";
import {AppTextarea} from "../ui/AppTextarea";
import {AppButton} from "../ui/AppButton";
import { AppSelect } from "../ui/AppSelect";
import {useState, type FormEvent} from 'react';
import {CalendarDateField} from '../calendar/CalendarDateTimeField';
import {isValidCivilDate} from '../calendar/calendar-dates';
import {dateInputError} from '../calendar/calendar-input';
import {ArrowLeft, ArrowUpRight, ArrowDownRight, CalendarDays, ExternalLink, FolderOpen, Link2, Pencil, Plus} from 'lucide-react';
import type {Project, Client, FinanceEntry, CalendarEvent, LibraryAsset, Status} from '../../domain/workspace';
import {eventRange} from '../../studio-calendar';
import {sumMoney} from '../../studio-finance';
import {isDemo} from '../../lib/firebase';
import {ProjectMaterials} from './ProjectMaterials';
import {ProjectDeletionAction} from './ProjectDeletionAction';
import {ProjectChecklist} from './ProjectChecklist';
import {PROJECT_STATUS_ICONS,PROJECT_STATUS_COLORS} from '../ui/project-status';
import './project-detail.css';

type Props = {
  project:Project; clients:Client[]; entries:FinanceEntry[]; assets:LibraryAsset[]; events:CalendarEvent[];
  onSave:(project:Project)=>void; onBack:()=>void; onRevenue:(project:Project)=>void;
  onEditRevenue:(entry:FinanceEntry)=>void; onMaterials:(folderId?:string)=>void;
  onEvent:(project:Project)=>void; onEditEvent:(event:CalendarEvent)=>void; onReview?:()=>void;
  onDeleted:()=>void; onDeleteDemo?:()=>void;
};
const currency=(value:number)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(value);
const statuses:Status[]=['Em produção','Em aprovação','Ajustes','Aprovado'];
function stageIcon(value:string){
 const status=value as Status;
 const Icon=PROJECT_STATUS_ICONS[status];
 return Icon?<Icon size={18} style={{color:PROJECT_STATUS_COLORS[status]}} aria-hidden="true"/>:null;
}

export function ProjectDetail({project,clients,entries,assets,events,onSave,onBack,onRevenue,onEditRevenue,onMaterials,onEvent,onEditEvent,onReview,onDeleted,onDeleteDemo}:Props){
  const [materialFolder,setMaterialFolder]=useState('root');
  const [status,setStatus]=useState(project.status);
  const [dueDate,setDueDate]=useState(project.dueDate&&isValidCivilDate(project.dueDate)?project.dueDate:'');
  const [dueDateDraft,setDueDateDraft]=useState(()=>{
    if(!project.dueDate||!isValidCivilDate(project.dueDate))return '';
    const [year,month,day]=project.dueDate.split('-');
    return day+'/'+month+'/'+year;
  });
  const [validationAttempted,setValidationAttempted]=useState(false);
  const [formError,setFormError]=useState('');

  const tasks=project.tasks||[];
  const linked=entries.filter(entry=>entry.projectId===project.id);
  const income=sumMoney(linked.filter(entry=>entry.kind!=='expense'));
  const costs=sumMoney(linked.filter(entry=>entry.kind==='expense'));
  const materials=assets.filter(asset=>asset.projectId===project.id);
  const agenda=events.filter(event=>event.projectId===project.id).sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));
  function save(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    const form=new FormData(event.currentTarget);
    const input=event.currentTarget.elements.namedItem('name') as HTMLInputElement;
    const name=input.value.trim();
    if(!name){input.setCustomValidity('Informe o nome do projeto.');input.reportValidity();return;}
    setValidationAttempted(true);
    const clientValue=String(form.get('clientId')||'');
    const clientId=clientValue?Number(clientValue):undefined;
    const description=String(form.get('description')||'');
    if(name.length>200||description.length>10000||!statuses.includes(status)||
      (clientValue&&(!Number.isSafeInteger(clientId)||!clients.some(client=>client.id===clientId)))){
      setFormError('Revise os dados do projeto antes de salvar.');
      return;
    }
    // A partial or impossible DD/MM/AAAA must never be silently saved as "Sem prazo".
    if(dueDateDraft&&(dateInputError(dueDateDraft)||!isValidCivilDate(dueDate)||
      Number(dueDate.slice(0,4))>2099)){
      setFormError('Corrija a data do prazo antes de salvar o projeto.');
      return;
    }
    setFormError('');
    onSave({...project,name,status,clientId,client:clients.find(client=>client.id===clientId)?.name||'Sem cliente vinculado',description,dueDate,due:dueDate?new Date(dueDate+'T12:00:00').toLocaleDateString('pt-BR',{day:'2-digit',month:'short'}):'Sem prazo'});
  }
  function updateTasks(updated:NonNullable<Project['tasks']>){
    onSave({...project,tasks:updated,progress:updated.length?Math.round(updated.filter(task=>task.done).length/updated.length*100):0});
  }
  return <div className="studio-detail project-detail">
    <div className="pd-navigation"><AppButton className="secondary-button" onClick={onBack}><ArrowLeft size={18} aria-hidden="true"/>Voltar</AppButton>{onReview&&!!project.clientId&&<AppButton className="secondary-button" onClick={onReview}>Enviar para aprovação<ArrowUpRight size={17} aria-hidden="true"/></AppButton>}</div>
    <section className="panel studio-section pd-overview" aria-labelledby="pd-name">
      <h2 id="pd-name">{project.name}</h2>
      <form className="studio-form" onSubmit={save}>
        <div className="form-grid"><label>Nome do projeto<AppInput name="name" required maxLength={200} defaultValue={project.name} onInput={event=>event.currentTarget.setCustomValidity('')}/></label>
          <label>Etapa<div className="pd-stage"><AppSelect aria-label="Etapa" name="status" value={status} renderLeading={stageIcon} onValueChange={value=>setStatus(value as Status)}>{statuses.map(status=><option key={status} value={status}>{status}</option>)}</AppSelect></div></label></div>
        <div className="form-grid"><label>Cliente<AppSelect aria-label="Cliente" name="clientId" defaultValue={project.clientId||''}><option value="">Sem cliente</option>{clients.map(client=><option key={client.id} value={client.id}>{client.name}</option>)}</AppSelect></label><div className="pd-date-field">
          <span className="pd-date-caption">Prazo</span>
          <CalendarDateField label="Prazo do projeto" value={dueDate} optional maxYear={2099}
            showValidation={validationAttempted}
            onDraftChange={draft=>{setDueDateDraft(draft);setFormError('');}}
            onChange={value=>{setDueDate(value);setFormError('');}}/>
        </div></div>
        <label>Briefing<AppTextarea name="description" rows={4} maxLength={10000} defaultValue={project.description} placeholder="Objetivo, referências, formatos e orientações…"/></label>
        {formError&&<p className="pd-form-error" role="alert">{formError}</p>}
        <AppButton className="primary-button" type="submit">Salvar projeto</AppButton>
      </form>
    </section>
    <div className="pd-columns">
      <ProjectChecklist tasks={tasks} onChange={updateTasks}/>
      <section className="panel studio-section pd-finance" aria-labelledby="pd-finance-title">
        <h2 id="pd-finance-title">Financeiro do projeto</h2>
        <dl className="pd-totals"><div><dt>Receita total</dt><dd>{currency(income)}</dd></div><div><dt>Custos</dt><dd>{currency(costs)}</dd></div><div><dt>Resultado previsto</dt><dd className={income-costs<0?'pd-negative':'pd-positive'}>{currency(income-costs)}</dd></div></dl>
        <p className="pd-finance-note">Inclui valores a receber e a pagar.</p>
        <div className="pd-section-head pd-ledger-head"><h3>Lançamentos</h3><AppButton className="secondary-button" onClick={()=>onRevenue(project)}><Plus size={18} aria-hidden="true"/>Receita ou custo</AppButton></div>
        {linked.map(entry=><article className="pd-entry" key={entry.id}><span className={`pd-entry-icon ${entry.kind==='expense'?'pd-expense':'pd-income'}`} aria-hidden="true">{entry.kind==='expense'?<ArrowDownRight size={25}/>:<ArrowUpRight size={25}/>}</span><div className="pd-entry-copy"><b>{entry.project}</b><span>{entry.kind==='expense'?'Custo':'Receita'} · {entry.kind==='expense'?(entry.status==='Recebido'?'Pago':'A pagar'):entry.status}</span></div><strong>{currency(entry.amount)}</strong><AppButton className="secondary-button" aria-label={`Editar lançamento ${entry.project}`} onClick={()=>onEditRevenue(entry)}><Pencil size={16} aria-hidden="true"/><span>Editar</span></AppButton></article>)}
        {!linked.length&&<p className="pd-empty">Nenhum lançamento vinculado. Registre uma receita ou custo para acompanhar o resultado.</p>}
      </section>
    </div>
    <section className="panel studio-section pd-materials" aria-labelledby="pd-materials-title"><div className="pd-section-head"><div><h2 id="pd-materials-title">Materiais e versões</h2><p>Organize os materiais do projeto na Biblioteca com o Google Drive.</p></div><AppButton className="primary-button" onClick={()=>onMaterials(materialFolder)}><Link2 size={19} aria-hidden="true"/>Adicionar material</AppButton></div>
      {materials.map(asset=><article className="pd-material" key={asset.id}><span className="pd-material-icon" aria-hidden="true"><Link2 size={25}/></span><div><b>{asset.name}</b><p>{asset.kind} · {asset.size}</p>{asset.url&&/^https:\/\//i.test(asset.url)&&<a href={asset.url} target="_blank" rel="noreferrer">Abrir link<ExternalLink size={15} aria-hidden="true"/></a>}</div></article>)}
      {!isDemo&&<ProjectMaterials projectId={project.id} onManage={onMaterials} onFolderChange={setMaterialFolder}/>}
      {isDemo&&!materials.length&&<div className="pd-material-empty"><FolderOpen size={23} aria-hidden="true"/><p>Acesse as pastas vinculadas e envie arquivos na Biblioteca deste projeto.</p><AppButton className="secondary-button" onClick={()=>onMaterials(materialFolder)}>Abrir Biblioteca<ArrowUpRight size={17} aria-hidden="true"/></AppButton></div>}
    </section>
    <section className="panel studio-section pd-agenda" aria-labelledby="pd-agenda-title"><div className="pd-section-head"><h2 id="pd-agenda-title">Agenda do projeto</h2><AppButton className="secondary-button" onClick={()=>onEvent(project)}><CalendarDays size={18} aria-hidden="true"/>Agendar</AppButton></div>
      {agenda.map(event=><div className="pd-event" key={event.id}><b>{event.title}</b><span>{event.date.split('-').reverse().join('/')} · {eventRange(event)}</span><AppButton className="pd-remove" aria-label={`Editar compromisso ${event.title}`} onClick={()=>onEditEvent(event)}><Pencil size={17} aria-hidden="true"/></AppButton></div>)}
      {!agenda.length&&<p className="pd-empty">Nenhum compromisso vinculado.</p>}
    </section>
    <ProjectDeletionAction project={project} onDeleted={onDeleted} onDeleteDemo={onDeleteDemo}/>
  </div>;
}
