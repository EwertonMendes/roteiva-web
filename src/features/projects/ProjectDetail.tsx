import { AppSelect } from "../ui/AppSelect";
import {useState, type FormEvent} from 'react';
import {ArrowLeft, ArrowUpRight, ArrowDownRight, CalendarDays, Check, ExternalLink, FolderOpen, Link2, Pencil, Plus, Trash2} from 'lucide-react';
import type {Project, Client, FinanceEntry, CalendarEvent, LibraryAsset, Status} from '../../domain/workspace';
import {newId} from '../../domain/workspace';
import {eventRange} from '../../studio-calendar';
import {sumMoney} from '../../studio-finance';
import {isDemo} from '../../lib/firebase';
import {ProjectMaterials} from './ProjectMaterials';
import './project-detail.css';

type Props = {
  project:Project; clients:Client[]; entries:FinanceEntry[]; assets:LibraryAsset[]; events:CalendarEvent[];
  onSave:(project:Project)=>void; onBack:()=>void; onRevenue:(project:Project)=>void;
  onEditRevenue:(entry:FinanceEntry)=>void; onMaterials:()=>void;
  onEvent:(project:Project)=>void; onEditEvent:(event:CalendarEvent)=>void; onReview?:()=>void;
};
const currency=(value:number)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(value);
const statuses:Status[]=['Em produção','Em aprovação','Ajustes','Aprovado'];

export function ProjectDetail({project,clients,entries,assets,events,onSave,onBack,onRevenue,onEditRevenue,onMaterials,onEvent,onEditEvent,onReview}:Props){
  const [task,setTask]=useState('');
  const [status,setStatus]=useState(project.status);
  const tasks=project.tasks||[];
  const completed=tasks.filter(task=>task.done).length;
  const progress=tasks.length?Math.round(completed/tasks.length*100):0;
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
    const clientId=Number(form.get('clientId'))||undefined;
    const dueDate=String(form.get('dueDate')||'');
    onSave({...project,name,status,clientId,client:clients.find(client=>client.id===clientId)?.name||'Sem cliente vinculado',description:String(form.get('description')||''),dueDate,due:dueDate?new Date(dueDate+'T12:00:00').toLocaleDateString('pt-BR',{day:'2-digit',month:'short'}):'Sem prazo'});
  }
  function updateTasks(updated:NonNullable<Project['tasks']>){
    onSave({...project,tasks:updated,progress:updated.length?Math.round(updated.filter(task=>task.done).length/updated.length*100):0});
  }
  function addTask(event:FormEvent){event.preventDefault();if(!task.trim())return;updateTasks([...tasks,{id:newId(),title:task.trim(),done:false}]);setTask('');}
  return <div className="studio-detail project-detail">
    <div className="pd-navigation"><button className="secondary-button" onClick={onBack}><ArrowLeft size={18} aria-hidden="true"/>Voltar</button>{onReview&&!!project.clientId&&<button className="secondary-button" onClick={onReview}>Enviar para aprovação<ArrowUpRight size={17} aria-hidden="true"/></button>}</div>
    <section className="panel studio-section pd-overview" aria-labelledby="pd-name">
      <h2 id="pd-name">{project.name}</h2>
      <form className="studio-form" onSubmit={save}>
        <div className="form-grid"><label>Nome do projeto<input name="name" required maxLength={200} defaultValue={project.name} onInput={event=>event.currentTarget.setCustomValidity('')}/></label>
          <label>Etapa<div className="pd-stage" data-stage={status}><i aria-hidden="true"/><AppSelect aria-label="Etapa" name="status" value={status} onValueChange={value=>setStatus(value as Status)}>{statuses.map(status=><option key={status}>{status}</option>)}</AppSelect></div></label></div>
        <div className="form-grid"><label>Cliente<AppSelect aria-label="Cliente" name="clientId" defaultValue={project.clientId||''}><option value="">Sem cliente</option>{clients.map(client=><option key={client.id} value={client.id}>{client.name}</option>)}</AppSelect></label><label>Prazo<input type="date" name="dueDate" defaultValue={project.dueDate}/></label></div>
        <label>Briefing<textarea name="description" rows={4} maxLength={10000} defaultValue={project.description} placeholder="Objetivo, referências, formatos e orientações…"/></label>
        <button className="primary-button" type="submit">Salvar projeto</button>
      </form>
    </section>
    <div className="pd-columns">
      <section className="panel studio-section pd-checklist" aria-labelledby="pd-checklist-title">
        <div className="pd-section-head"><h2 id="pd-checklist-title">Checklist</h2><div className="pd-progress"><span aria-live="polite">{completed} de {tasks.length} concluídas</span><div><progress aria-label="Progresso do checklist" max={100} value={progress}/><span>{progress}%</span></div></div></div>
        <div className="pd-tasks">{tasks.map(task=><div className="pd-task" key={task.id} data-done={task.done}><label><input type="checkbox" checked={task.done} onChange={()=>updateTasks(tasks.map(item=>item.id===task.id?{...item,done:!item.done}:item))}/><span className="pd-check" aria-hidden="true">{task.done&&<Check size={17}/>}</span><span>{task.title}</span></label><button className="pd-remove" type="button" aria-label={`Remover tarefa ${task.title}`} onClick={()=>updateTasks(tasks.filter(item=>item.id!==task.id))}><Trash2 size={16} aria-hidden="true"/></button></div>)}</div>
        {!tasks.length&&<p className="pd-empty">Comece adicionando a primeira tarefa deste projeto.</p>}
        <form className="pd-add-task" onSubmit={addTask}><input name="taskTitle" aria-label="Nova tarefa" maxLength={200} placeholder="Adicionar uma tarefa" value={task} onChange={event=>setTask(event.target.value)}/><button className="secondary-button" type="submit" disabled={!task.trim()} aria-label="Adicionar tarefa"><Plus size={22} aria-hidden="true"/></button></form>
      </section>
      <section className="panel studio-section pd-finance" aria-labelledby="pd-finance-title">
        <h2 id="pd-finance-title">Financeiro do projeto</h2>
        <dl className="pd-totals"><div><dt>Receita total</dt><dd>{currency(income)}</dd></div><div><dt>Custos</dt><dd>{currency(costs)}</dd></div><div><dt>Resultado previsto</dt><dd className={income-costs<0?'pd-negative':'pd-positive'}>{currency(income-costs)}</dd></div></dl>
        <p className="pd-finance-note">Inclui valores a receber e a pagar.</p>
        <div className="pd-section-head pd-ledger-head"><h3>Lançamentos</h3><button className="secondary-button" onClick={()=>onRevenue(project)}><Plus size={18} aria-hidden="true"/>Receita ou custo</button></div>
        {linked.map(entry=><article className="pd-entry" key={entry.id}><span className={`pd-entry-icon ${entry.kind==='expense'?'pd-expense':'pd-income'}`} aria-hidden="true">{entry.kind==='expense'?<ArrowDownRight size={25}/>:<ArrowUpRight size={25}/>}</span><div className="pd-entry-copy"><b>{entry.project}</b><span>{entry.kind==='expense'?'Custo':'Receita'} · {entry.kind==='expense'?(entry.status==='Recebido'?'Pago':'A pagar'):entry.status}</span></div><strong>{currency(entry.amount)}</strong><button className="secondary-button" aria-label={`Editar lançamento ${entry.project}`} onClick={()=>onEditRevenue(entry)}><Pencil size={16} aria-hidden="true"/><span>Editar</span></button></article>)}
        {!linked.length&&<p className="pd-empty">Nenhum lançamento vinculado. Registre uma receita ou custo para acompanhar o resultado.</p>}
      </section>
    </div>
    <section className="panel studio-section pd-materials" aria-labelledby="pd-materials-title"><div className="pd-section-head"><div><h2 id="pd-materials-title">Materiais e versões</h2><p>Organize os materiais do projeto na Biblioteca com o Google Drive.</p></div><button className="primary-button" onClick={onMaterials}><Link2 size={19} aria-hidden="true"/>Adicionar material</button></div>
      {materials.map(asset=><article className="pd-material" key={asset.id}><span className="pd-material-icon" aria-hidden="true"><Link2 size={25}/></span><div><b>{asset.name}</b><p>{asset.kind} · {asset.size}</p>{asset.url&&/^https:\/\//i.test(asset.url)&&<a href={asset.url} target="_blank" rel="noreferrer">Abrir link<ExternalLink size={15} aria-hidden="true"/></a>}</div></article>)}
      {!isDemo&&<ProjectMaterials projectId={project.id} onManage={onMaterials}/>}
      {isDemo&&!materials.length&&<div className="pd-material-empty"><FolderOpen size={23} aria-hidden="true"/><p>Acesse as pastas vinculadas e envie arquivos na Biblioteca deste projeto.</p><button className="secondary-button" onClick={onMaterials}>Abrir Biblioteca<ArrowUpRight size={17} aria-hidden="true"/></button></div>}
    </section>
    <section className="panel studio-section pd-agenda" aria-labelledby="pd-agenda-title"><div className="pd-section-head"><h2 id="pd-agenda-title">Agenda do projeto</h2><button className="secondary-button" onClick={()=>onEvent(project)}><CalendarDays size={18} aria-hidden="true"/>Agendar</button></div>
      {agenda.map(event=><div className="pd-event" key={event.id}><b>{event.title}</b><span>{event.date.split('-').reverse().join('/')} · {eventRange(event)}</span><button className="pd-remove" aria-label={`Editar compromisso ${event.title}`} onClick={()=>onEditEvent(event)}><Pencil size={17} aria-hidden="true"/></button></div>)}
      {!agenda.length&&<p className="pd-empty">Nenhum compromisso vinculado.</p>}
    </section>
  </div>;
}
