"use client";
import { useState, type FormEvent, type ReactNode } from "react";
import { ArrowLeft, CalendarDays, Plus, Download, Upload, Pencil, Trash2 } from "lucide-react";
import { newId } from "./domain/workspace";
import { eventRange } from "./studio-calendar";
import { sumMoney, toISO } from "./studio-finance";
import type { Project, Client, FinanceEntry, CalendarEvent, LibraryAsset, View, Status } from "./dashboard-client";

export const money = (v: number) => new Intl.NumberFormat("pt-BR", {style: "currency", currency: "BRL"}).format(v);
export const isoDate = toISO;
const today = () => new Date().toLocaleDateString("en-CA");
const sum = sumMoney;
export const projectTemplates: Record<string, string[]> = {
  "Livre": [],
  "Institucional": ["Aprovar briefing", "Preparar roteiro", "Planejar gravação", "Captar imagens e áudio", "Montar primeiro corte", "Revisar com o cliente", "Entregar arquivos finais"],
  "Conteúdo mensal": ["Definir pauta do mês", "Aprovar roteiros", "Gravar conteúdos", "Editar vídeos e cortes", "Enviar para aprovação", "Entregar pacote mensal"],
  "Evento": ["Confirmar programação e local", "Conferir equipamentos", "Captar evento", "Fazer backup", "Editar highlights", "Aprovar e entregar"],
  "Casamento": ["Reunião com o casal", "Confirmar cronograma", "Preparar equipamentos", "Captar cerimônia e festa", "Fazer backup", "Editar teaser", "Editar filme completo", "Aprovar e entregar"],
};
function Empty({children}: {children: ReactNode}) { return <p className="studio-empty">{children}</p>; }
function Back({onClick}: {onClick: () => void}) { return <button className="secondary-button" onClick={onClick}><ArrowLeft size={16}/> Voltar</button>; }
export function WorkspaceTools({workspace, status, onNotify,loadWorkspace}: {workspace: object; status: string; onNotify: (s: string) => void;loadWorkspace?:()=>Promise<object>}) {
  const [downloading,setDownloading]=useState(false);
  async function download() {
    setDownloading(true);
    try {
    const source=loadWorkspace ? await loadWorkspace() : workspace;
    const url = URL.createObjectURL(new Blob([JSON.stringify(source, null, 2)], {type: "application/json"}));
    const a = document.createElement("a");
    a.href = url;
    a.download = `Roteiva-backup-${today()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    onNotify("Cópia exportada");
    }catch{onNotify("Não foi possível carregar os registros para exportação");}
    finally{setDownloading(false);}
  }
  return <div className="workspace-tools"><span role="status">{status}</span><button className="secondary-button" title="Exporta os cadastros e lançamentos carregados; arquivos de mídia não estão incluídos." onClick={()=>void download()} disabled={downloading}><Download size={15}/> {downloading?"Preparando cópia…":"Exportar cópia"}</button></div>;
}
export function TodayStudio({projects, clients, entries, events, activities, onView, overviewMetrics}: {projects: Project[]; clients:Client[]; entries: FinanceEntry[]; events: CalendarEvent[]; activities: {text: string; when: string}[]; onView: (v: View) => void; overviewMetrics?:{clientCount?:number;receivableAmount?:number;projectCount?:number;projectStatuses?:Record<Status,number>}}) {
  const active = overviewMetrics?.projectStatuses && overviewMetrics.projectCount!==undefined ? overviewMetrics.projectCount-overviewMetrics.projectStatuses.Aprovado :
    projects.filter(p=>p.status!=="Aprovado").length;
  const approved = overviewMetrics?.projectStatuses?.Aprovado ?? projects.filter(p=>p.status==="Aprovado").length;
  const pending = overviewMetrics?.projectStatuses ? overviewMetrics.projectStatuses["Em aprovação"]+overviewMetrics.projectStatuses.Ajustes :
    projects.filter(p=>p.status==="Em aprovação"||p.status==="Ajustes").length;
  const projectCount=overviewMetrics?.projectCount ?? projects.length;
  const receivable = entries.filter(e=>e.kind!=="expense"&&e.status==="A receber");
  const phases = [{label:"Produção",status:"Em produção",color:"var(--chart-primary)"},{label:"Aprovação",status:"Em aprovação",color:"#929292"},{label:"Ajustes",status:"Ajustes",color:"#b6b6b6"},{label:"Concluídos",status:"Aprovado",color:"#d4d4d4"}].map(p=>({...p,count:overviewMetrics?.projectStatuses?.[p.status as Status] ?? projects.filter(item=>item.status===p.status).length}));
  const clock=new Date().toTimeString().slice(0,5);
  const next = [...events].filter(e=>e.date>today() || (e.date===today() && (e.endTime || e.time)>=clock)).sort((a,b)=>`${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`))[0];
  return <section className="panel flow-overview" aria-label="Panorama geral do estúdio">
    <header className="flow-overview-head"><div><span className="eyebrow">PANORAMA GERAL</span><h2>O ritmo do seu estúdio</h2></div><span className="flow-total">{projectCount} {projectCount===1?"projeto":"projetos"} no total</span></header>
    <div className="flow-numbers">
      <button onClick={()=>onView("projects")}><span>Projetos ativos</span><strong>{active}</strong><small>Em produção e revisão</small></button>
      <button onClick={()=>onView("reviews")}><span>Em revisão</span><strong>{pending}</strong><small>Aprovações e ajustes</small></button>
      <button onClick={()=>onView("clients")}><span>Clientes</span><strong>{overviewMetrics?.clientCount ?? clients.length}</strong><small>Na sua carteira</small></button>
      <button onClick={()=>onView("finance")}><span>A receber</span><strong className="flow-money">{money(overviewMetrics?.receivableAmount ?? sum(receivable))}</strong><small>Todos os lançamentos pendentes</small></button>
    </div>
    <div className="flow-progress"><div className="flow-progress-title"><span>Fluxo de produção</span><b>{projectCount ? `${approved} de ${projectCount} concluídos` : "Nenhum projeto ainda"}</b></div><div className={`flow-track ${projectCount?"":"is-empty"}`} role="img" aria-label={phases.map(p=>`${p.label}: ${p.count}`).join(", ")}>{phases.filter(p=>p.count>0).map(p=><i key={p.status} style={{width:`${p.count/Math.max(1,projectCount)*100}%`,background:p.color}}/>)}</div><div className="flow-legend">{phases.map(p=><span key={p.status}><i style={{background:p.color}}/>{p.label}<b>{p.count}</b></span>)}</div></div>
    <footer className="flow-next"><CalendarDays size={17}/><div><span>Próximo compromisso</span><p>{next ? <><b>{next.title}</b> · {next.date.split("-").reverse().join("/")} · {eventRange(next)}</> : "Sua agenda está livre. Adicione a próxima produção."}</p></div><button className="secondary-button" onClick={()=>onView("calendar")}>Ver agenda</button></footer>
    <details className="studio-activity"><summary>Atividade recente <span>{activities.length}</span></summary>{activities.length ? activities.slice(0,5).map((a,i)=><p key={i}><time>{new Date(a.when).toLocaleString("pt-BR")}</time>{a.text}</p>):<Empty>As próximas movimentações aparecerão aqui.</Empty>}</details>
  </section>;
}
export function ClientDetail({client, projects, entries, onBack, onEdit, onProject, onSave}: {onSave: (client:Client) => void; client: Client; projects: Project[]; entries: FinanceEntry[]; onBack: () => void; onEdit: (c: Client) => void; onProject: (id:number) => void}) {
  const linked = projects.filter(p => p.clientId === client.id || (!p.clientId && p.client === client.name));
  const finances = entries.filter(e => e.clientId === client.id && e.kind !== "expense");
  const [month,setMonth] = useState(today().slice(0,7));
  const deliveries = (client.deliveries || []).filter(d => d.month === month);
  const completed = deliveries.filter(d => d.done).length;
  function prepareDeliveries() {
    const count = Math.min(100, Math.floor(client.monthlyDeliverables || 0));
    const existing = client.deliveries || [];
    const needed = Math.max(0, count - deliveries.length);
    onSave({...client,deliveries:[...existing,...Array.from({length:needed},(_,i)=>({id:newId()+i,title:`Entrega ${deliveries.length+i+1}`,month,done:false}))]});
  }
  return <div className="studio-detail"><div className="studio-toolbar"><Back onClick={onBack}/><button className="primary-button" onClick={() => onEdit(client)}>Editar cliente</button></div><section className="panel studio-section"><span className="eyebrow">FICHA DO CLIENTE · {client.type}</span><h2>{client.name}</h2><p>{client.contact}</p><div className="contact-links">{client.phone && <a href={`tel:${client.phone.replace(/[^+\d]/g,"")}`}>{client.phone}</a>}{client.email && <a href={`mailto:${client.email}`}>{client.email}</a>}</div><div className="studio-stats"><div><small>Projetos</small><b>{linked.length}</b></div><div><small>Receitas registradas</small><b>{money(sum(finances))}</b></div><div><small>A receber</small><b>{money(sum(finances.filter(e => e.status === "A receber")))}</b></div></div></section>
  {client.type === "Recorrente" && <section className="panel studio-section"><span className="eyebrow">PACOTE RECORRENTE</span><h2>{client.packageTitle || "Defina seu pacote mensal"}</h2><p>{money(client.monthlyFee || 0)} / mês · {client.monthlyDeliverables || 0} entregas previstas</p><progress value={completed} max={Math.max(client.monthlyDeliverables || 1, completed)}/><p>{completed} de {client.monthlyDeliverables || 0} entregas concluídas. O valor combinado não gera uma receita automaticamente.</p><label>Mês do pacote<input aria-label="Mês do pacote" type="month" value={month} onChange={e=>setMonth(e.target.value)}/></label>{deliveries.map(d=><label className="task-row" key={d.id}><input type="checkbox" checked={d.done} onChange={()=>onSave({...client,deliveries:(client.deliveries || []).map(item=>item.id===d.id?{...item,done:!item.done}:item)})}/><span>{d.title}</span></label>)}{deliveries.length<(client.monthlyDeliverables||0)&&<button className="secondary-button" onClick={prepareDeliveries}>Preparar entregas deste mês</button>}</section>}
  <section className="panel studio-section"><h2>Projetos do cliente</h2>{linked.length ? linked.map(p => <button className="studio-row" key={p.id} onClick={() => onProject(p.id)}><b>{p.name}</b><span>{p.status}</span><span>{p.due}</span></button>) : <Empty>Nenhum projeto vinculado ainda.</Empty>}</section><section className="panel studio-section"><h2>Histórico financeiro</h2>{finances.map(e => <div className="studio-row" key={e.id}><b>{e.project}</b><span>{e.date} · {e.status}</span><strong>{money(e.amount)}</strong></div>)}{!finances.length && <Empty>Nenhuma receita vinculada.</Empty>}</section></div>;
}
export function ProjectDetail({project, clients, entries, assets, events, onSave, onBack, onRevenue, onUpload, onEvent, uploading}: {project: Project; clients:Client[]; entries: FinanceEntry[]; assets:LibraryAsset[]; events:CalendarEvent[]; onSave:(p:Project)=>void; onBack:()=>void; onRevenue:(p:Project)=>void; onUpload:(files:FileList|null,id?:number)=>void; onEvent:(p:Project)=>void; uploading:boolean}) {
  const [task, setTask] = useState("");
  const linked = entries.filter(e => e.projectId === project.id);
  const costs = sum(linked.filter(e => e.kind === "expense")); const income = sum(linked.filter(e => e.kind !== "expense"));
  function save(event:FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); const dueDate = String(form.get("dueDate") || ""); const clientId = Number(form.get("clientId")) || undefined; onSave({...project, name: String(form.get("name")).trim(), description: String(form.get("description") || ""), status: String(form.get("status")) as Status, clientId, client: clients.find(c=>c.id===clientId)?.name || "Sem cliente vinculado", dueDate, due: dueDate ? new Date(`${dueDate}T12:00:00`).toLocaleDateString("pt-BR",{day:"2-digit",month:"short"}) : "Sem prazo"}); }
  function tasks(updated: NonNullable<Project["tasks"]>) { onSave({...project,tasks:updated,progress:updated.length ? Math.round(updated.filter(t=>t.done).length/updated.length*100):0}); }
  return <div className="studio-detail"><div className="studio-toolbar"><Back onClick={onBack}/><span className="eyebrow">CENTRAL DO PROJETO</span></div><section className="panel studio-section"><h2>{project.name}</h2><form className="studio-form" onSubmit={save}><div className="form-grid"><label>Nome do projeto<input name="name" required defaultValue={project.name}/></label><label>Etapa<select name="status" defaultValue={project.status}>{["Em produção","Em aprovação","Ajustes","Aprovado"].map(s=><option key={s}>{s}</option>)}</select></label></div><div className="form-grid"><label>Cliente<select name="clientId" defaultValue={project.clientId || ""}><option value="">Sem cliente</option>{clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>Prazo<input type="date" name="dueDate" defaultValue={project.dueDate}/></label></div><label>Briefing<textarea name="description" rows={4} defaultValue={project.description} placeholder="Objetivo, referências, formatos e orientações…"/></label><button className="primary-button">Salvar projeto</button></form></section>
  <div className="studio-columns"><section className="panel studio-section"><span className="eyebrow">PRODUÇÃO · {project.progress}%</span><h2>Checklist</h2>{(project.tasks || []).map(t => <label className="task-row" key={t.id}><input type="checkbox" checked={t.done} onChange={()=>tasks(project.tasks!.map(item=>item.id===t.id?{...item,done:!item.done}:item))}/><span>{t.title}</span><button type="button" aria-label={`Remover tarefa ${t.title}`} onClick={()=>tasks(project.tasks!.filter(item=>item.id!==t.id))}>×</button></label>)}<form className="inline-form" onSubmit={e=>{e.preventDefault(); const title=String(new FormData(e.currentTarget).get("taskTitle") || "").trim(); if(title) {tasks([...(project.tasks||[]),{id:newId(),title,done:false}]);setTask("");}}}><input name="taskTitle" aria-label="Nova tarefa" placeholder="Adicionar uma tarefa" value={task} onChange={e=>setTask(e.target.value)}/><button className="secondary-button" type="submit" aria-label="Adicionar tarefa"><Plus size={16}/></button></form></section>
  <section className="panel studio-section"><span className="eyebrow">RESULTADO DO TRABALHO</span><h2>Financeiro do projeto</h2><div className="studio-stats"><div><small>Receitas</small><b>{money(income)}</b></div><div><small>Custos</small><b>{money(costs)}</b></div><div><small>Resultado previsto</small><b>{money(income-costs)}</b></div></div><p>Considera os lançamentos vinculados, incluindo os valores a receber ou pagar.</p><button className="secondary-button" onClick={()=>onRevenue(project)}><Plus size={15}/> Receita ou custo</button></section></div>
  <section className="panel studio-section"><div className="studio-toolbar"><h2>Materiais e versões</h2><label className="primary-button">{uploading ? "Enviando…":"Adicionar material"}<Upload size={15}/><input type="file" multiple hidden disabled={uploading} onChange={e=>{onUpload(e.target.files,project.id);e.target.value="";}}/></label></div>{assets.filter(a=>a.projectId===project.id).map(a=><div className="studio-row" key={a.id}><b>{a.name}</b><span>{a.kind} · {a.size}</span>{a.url && <a href={a.url} target="_blank" rel="noreferrer">Abrir</a>}</div>)}{!assets.some(a=>a.projectId===project.id)&&<Empty>Envie vídeos, referências, fotos e documentos deste trabalho. Cada envio mantém seu próprio arquivo.</Empty>}</section>
  <section className="panel studio-section"><div className="studio-toolbar"><h2>Agenda do projeto</h2><button className="secondary-button" onClick={()=>onEvent(project)}><CalendarDays size={15}/> Agendar</button></div>{events.filter(e=>e.projectId===project.id).map(e=><div className="studio-row" key={e.id}><b>{e.title}</b><span>{e.date.split("-").reverse().join("/")} · {eventRange(e)}</span></div>)}{!events.some(e=>e.projectId===project.id)&&<Empty>Nenhum compromisso vinculado.</Empty>}</section></div>;
}

export function StudioReviews() {
  return <div className="studio-detail"><section className="panel studio-section">
    <span className="eyebrow">APROVAÇÕES · DEMONSTRAÇÃO</span>
    <h2>Revisão de vídeos ainda não disponível</h2>
    <p>Os arquivos serão armazenados no Google Drive de cada profissional. Envio, convites, comentários e aprovações serão habilitados quando a integração segura estiver pronta.</p>
  </section></div>;
}
export function FinancePanel({entries,clients,onAdd,onEdit,onDelete}: {entries:FinanceEntry[];clients:Client[];onAdd:()=>void;onEdit:(e:FinanceEntry)=>void;onDelete:(e:FinanceEntry)=>void}) {
  const now=new Date();const [year,setYear]=useState(now.getFullYear());const [month,setMonth]=useState(now.getMonth());const [client,setClient]=useState("");const [status,setStatus]=useState("");
  const labels=["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
  const years=Array.from(new Set([now.getFullYear(),now.getFullYear()-1,now.getFullYear()+1,...entries.map(e=>Number(isoDate(e.date).slice(0,4)))] )).filter(Number.isFinite).sort((a,b)=>b-a);
  const base=entries.filter(e=>!client||String(e.clientId)===client);
  const yearly=base.filter(e=>Number(isoDate(e.date).slice(0,4))===year);
  const prefix=`${year}-${String(month+1).padStart(2,"0")}`;
  const monthly=base.filter(e=>isoDate(e.date).startsWith(prefix));const incomes=monthly.filter(e=>e.kind!=="expense");const costs=monthly.filter(e=>e.kind==="expense");
  const visible=monthly.filter(e=>!status||e.status===status).sort((a,b)=>isoDate(b.date).localeCompare(isoDate(a.date)));
  const total=sum(incomes);const received=sum(incomes.filter(e=>e.status==="Recebido"));const pending=sum(incomes.filter(e=>e.status!=="Recebido"));const recurring=sum(incomes.filter(e=>clients.some(c=>c.id===e.clientId&&c.type==="Recorrente")));const percent=total?Math.round(recurring/total*100):0;
  const bars=labels.map((_,i)=>sum(yearly.filter(e=>e.kind!=="expense"&&Number(isoDate(e.date).slice(5,7))===i+1)));
  const max=Math.max(...bars,100);const step=10**Math.floor(Math.log10(max));const ceiling=Math.ceil(max/step)*step;
  const overdue=monthly.filter(e=>e.status==="A receber"&&isoDate(e.date)<today());
  function csv(){const rows=[["Trabalho","Cliente","Data","Tipo","Situação","Valor"],...visible.map(e=>[e.project,e.client,e.date,e.kind==="expense"?"Despesa":"Receita",e.status,e.amount.toFixed(2).replace(".",",")])];const text="\ufeff"+rows.map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(";")).join("\r\n");const url=URL.createObjectURL(new Blob([text],{type:"text/csv;charset=utf-8"}));const a=document.createElement("a");a.href=url;a.download=`Roteiva-${prefix}.csv`;a.click();URL.revokeObjectURL(url);}
  return <div className="finance-layout"><section className="panel finance-filters"><label>Mês<select value={month} onChange={e=>setMonth(Number(e.target.value))}>{labels.map((l,i)=><option key={l} value={i}>{l}</option>)}</select></label><label>Ano<select value={year} onChange={e=>setYear(Number(e.target.value))}>{years.map(y=><option key={y}>{y}</option>)}</select></label><label>Cliente<select value={client} onChange={e=>setClient(e.target.value)}><option value="">Todos os clientes</option>{[...clients].sort((a,b)=>a.name.localeCompare(b.name,"pt-BR")).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>Situação<select value={status} onChange={e=>setStatus(e.target.value)}><option value="">Todas</option><option>Recebido</option><option>A receber</option></select></label><button className="secondary-button" onClick={csv}><Download size={15}/> Exportar CSV</button></section>
  <div className="finance-metrics"><article className="featured"><small>RECEITA PREVISTA · {labels[month].toUpperCase()} / {year}</small><strong>{money(total)}</strong><p>{incomes.length} {incomes.length===1?"lançamento":"lançamentos"} no período</p></article><article><small>JÁ RECEBIDO</small><strong>{money(received)}</strong><p>{money(pending)} a receber</p></article><article><small>CUSTOS DO MÊS</small><strong>{money(sum(costs))}</strong><p>{costs.length} {costs.length===1?"custo":"custos"} de produção</p></article><article><small>RESULTADO PREVISTO</small><strong>{money(total-sum(costs))}</strong><p>Entradas menos custos registrados</p></article></div>
  {overdue.length>0&&<div className="studio-alert">{overdue.length} lançamentos pendentes com vencimento passado neste mês.</div>}
  <div className="finance-main-grid"><section className="panel revenue-chart-panel"><div className="panel-head"><div><span>FATURAMENTO ANUAL · {year}</span><h2>Receita por mês</h2></div><strong>{money(sum(yearly.filter(e=>e.kind!=="expense")))}</strong></div><div className="revenue-chart"><div className="chart-y-axis">{[1,.75,.5,.25,0].map(f=><span key={f}>{new Intl.NumberFormat("pt-BR",{notation:"compact",maximumFractionDigits:1}).format(ceiling*f)}</span>)}</div><div className="chart-plot"><div className="chart-lines"><i/><i/><i/><i/><i/></div><div className="bars">{bars.map((v,i)=><button aria-label={`${labels[i]}: ${money(v)}`} title={`${labels[i]}: ${money(v)}`} className={`bar-column ${i===month?"current":""}`} key={i} onClick={()=>setMonth(i)}><span className="bar-value">{money(v)}</span><i style={{height:`${v/ceiling*100}%`}}><em/></i><small>{labels[i]}</small></button>)}</div></div></div><div className="chart-insight"><p>Clique em um mês no gráfico para consultar seus lançamentos.</p></div></section><aside className="panel finance-side"><div className="panel-head"><div><span>ORIGEM DAS RECEITAS</span><h2>Perfil do mês</h2></div></div><div className="donut-wrap"><div className="donut" style={{background:`conic-gradient(var(--chart-primary) 0 ${percent}%, var(--chart-secondary) ${percent}% 100%)`}}><span><b>{percent}%</b><small>recorrente</small></span></div></div><div className="revenue-sources"><div><span>Clientes recorrentes</span><b>{money(recurring)}</b></div><div><span>Avulsos ou sem vínculo</span><b>{money(total-recurring)}</b></div></div></aside></div>
  <section className="panel finance-table-panel"><div className="panel-head"><div><span>{labels[month].toUpperCase()} / {year}</span><h2>Trabalhos do mês</h2></div><button onClick={onAdd}>Adicionar lançamento <Plus size={15}/></button></div><div className="finance-table-head"><span>Trabalho</span><span>Cliente</span><span>Data</span><span>Situação</span><span>Valor</span><span>Ações</span></div><div className="finance-table">{visible.map(e=><article key={e.id}><div><b>{e.project}</b><small>{e.kind==="expense"?"Despesa":"Receita"}</small></div><span>{e.client}</span><span>{e.date}</span><span><i className={`payment-status ${e.status==="Recebido"?"paid":"pending"}`}>{e.kind==="expense"?(e.status==="Recebido"?"Pago":"A pagar"):e.status}</i></span><strong className={e.kind==="expense"?"expense-amount":""}>{e.kind==="expense"?"−":""}{money(e.amount)}</strong><span className="revenue-actions"><button aria-label={`Editar receita ${e.project}`} title="Editar lançamento" onClick={()=>onEdit(e)}><Pencil size={17}/></button><button className="delete-revenue-button" aria-label={`Excluir receita ${e.project}`} title="Excluir lançamento" onClick={()=>onDelete(e)}><Trash2 size={17}/></button></span></article>)}{!visible.length&&<Empty>Nenhum lançamento com os filtros selecionados.</Empty>}</div></section></div>;
}
