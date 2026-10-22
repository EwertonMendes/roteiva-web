"use client";
import { AppSelect } from "./features/ui/AppSelect";

import { useState, type FormEvent, type ReactNode } from "react";
import {
  ArrowLeft, CalendarDays, Plus, Download, Upload, Pencil, Trash2,
  CalendarRange, UsersRound, ListFilter, TrendingUp, CircleCheck, Receipt,
  Scale, TriangleAlert, ChartColumnIncreasing, ChartPie, ListChecks,
  Phone, Mail, FolderKanban,
} from "lucide-react";
import { IconLabel } from "./features/ui/IconLabel";
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
export function ClientDetail({client, projects, entries, onBack, onEdit, onProject, onSave, onReview}: {onReview?:()=>void;onSave: (client:Client) => void; client: Client; projects: Project[]; entries: FinanceEntry[]; onBack: () => void; onEdit: (c: Client) => void; onProject: (id:number) => void}) {
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
  return <div className="studio-detail"><div className="studio-toolbar"><Back onClick={onBack}/>{onReview&&<button className="secondary-button" onClick={onReview}>Enviar para aprovação</button>}<button className="primary-button" onClick={() => onEdit(client)}>Editar cliente</button></div><section className="panel studio-section"><span className="eyebrow">FICHA DO CLIENTE · {client.type}</span><h2>{client.name}</h2><p>{client.contact}</p><div className="contact-links">{client.phone && <a href={`tel:${client.phone.replace(/[^+\d]/g,"")}`}><IconLabel icon={Phone}>{client.phone}</IconLabel></a>}{client.email && <a href={`mailto:${client.email}`}><IconLabel icon={Mail}>{client.email}</IconLabel></a>}</div><div className="studio-stats"><div><small>Projetos</small><b>{linked.length}</b></div><div><small>Receitas registradas</small><b>{money(sum(finances))}</b></div><div><small>A receber</small><b>{money(sum(finances.filter(e => e.status === "A receber")))}</b></div></div></section>
  {client.type === "Recorrente" && <section className="panel studio-section"><span className="eyebrow">PACOTE RECORRENTE</span><h2>{client.packageTitle || "Defina seu pacote mensal"}</h2><p>{money(client.monthlyFee || 0)} / mês · {client.monthlyDeliverables || 0} entregas previstas</p><progress value={completed} max={Math.max(client.monthlyDeliverables || 1, completed)}/><p>{completed} de {client.monthlyDeliverables || 0} entregas concluídas. O valor combinado não gera uma receita automaticamente.</p><label>Mês do pacote<input aria-label="Mês do pacote" type="month" value={month} onChange={e=>setMonth(e.target.value)}/></label>{deliveries.map(d=><label className="task-row" key={d.id}><input type="checkbox" checked={d.done} onChange={()=>onSave({...client,deliveries:(client.deliveries || []).map(item=>item.id===d.id?{...item,done:!item.done}:item)})}/><span>{d.title}</span></label>)}{deliveries.length<(client.monthlyDeliverables||0)&&<button className="secondary-button" onClick={prepareDeliveries}>Preparar entregas deste mês</button>}</section>}
  <section className="panel studio-section"><h2><IconLabel icon={FolderKanban} size={20}>Projetos do cliente</IconLabel></h2>{linked.length ? linked.map(p => <button className="studio-row" key={p.id} onClick={() => onProject(p.id)}><b>{p.name}</b><span>{p.status}</span><span>{p.due}</span></button>) : <Empty>Nenhum projeto vinculado ainda.</Empty>}</section><section className="panel studio-section"><h2><IconLabel icon={Receipt} size={20}>Histórico financeiro</IconLabel></h2>{finances.map(e => <div className="studio-row" key={e.id}><b>{e.project}</b><span>{e.date} · {e.status}</span><strong>{money(e.amount)}</strong></div>)}{!finances.length && <Empty>Nenhuma receita vinculada.</Empty>}</section></div>;
}
export function StudioReviews() {
  return <div className="studio-detail"><section className="panel studio-section">
    <span className="eyebrow">APROVAÇÕES · DEMONSTRAÇÃO</span>
    <h2>Revisão de vídeos ainda não disponível</h2>
    <p>Os arquivos serão armazenados no Google Drive de cada profissional. Envio, convites, comentários e aprovações serão habilitados quando a integração segura estiver pronta.</p>
  </section></div>;
}
export function FinancePanel({entries,clients,onAdd,onEdit,onDelete,onPeriodChange,serverBars}: {entries:FinanceEntry[];clients:Client[];onAdd:()=>void;onEdit:(e:FinanceEntry)=>void;onDelete:(e:FinanceEntry)=>void;onPeriodChange?:(year:number,month:number,clientId?:number)=>void;serverBars?:{key:string;bars:number[]}}) {
  const now=new Date();const [year,setYear]=useState(now.getFullYear());const [month,setMonth]=useState(now.getMonth());const [client,setClient]=useState("");const [status,setStatus]=useState("");
  const labels=["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
  const years=Array.from(new Set([now.getFullYear()+1,...Array.from({length:16},(_,i)=>now.getFullYear()-i),...entries.map(e=>Number(isoDate(e.date).slice(0,4)))] )).filter(Number.isFinite).sort((a,b)=>b-a);
  const base=entries.filter(e=>!client||String(e.clientId)===client);
  const yearly=base.filter(e=>Number(isoDate(e.date).slice(0,4))===year);
  const prefix=`${year}-${String(month+1).padStart(2,"0")}`;
  const monthly=base.filter(e=>isoDate(e.date).startsWith(prefix));const incomes=monthly.filter(e=>e.kind!=="expense");const costs=monthly.filter(e=>e.kind==="expense");
  const visible=monthly.filter(e=>!status||e.status===status).sort((a,b)=>isoDate(b.date).localeCompare(isoDate(a.date)));
  const total=sum(incomes);const received=sum(incomes.filter(e=>e.status==="Recebido"));const pending=sum(incomes.filter(e=>e.status!=="Recebido"));const recurring=sum(incomes.filter(e=>clients.some(c=>c.id===e.clientId&&c.type==="Recorrente")));const percent=total?Math.round(recurring/total*100):0;
  const chartKey=year+"-"+(client||"");
  const bars=serverBars?.key===chartKey ? serverBars.bars :
    labels.map((_,i)=>sum(yearly.filter(e=>e.kind!=="expense"&&Number(isoDate(e.date).slice(5,7))===i+1)));
  const max=Math.max(...bars,100);const step=10**Math.floor(Math.log10(max));const ceiling=Math.ceil(max/step)*step;
  const overdue=monthly.filter(e=>e.status==="A receber"&&isoDate(e.date)<today());
  function csv(){const rows=[["Trabalho","Cliente","Data","Tipo","Situação","Valor"],...visible.map(e=>[e.project,e.client,e.date,e.kind==="expense"?"Despesa":"Receita",e.status,e.amount.toFixed(2).replace(".",",")])];const text="\ufeff"+rows.map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(";")).join("\r\n");const url=URL.createObjectURL(new Blob([text],{type:"text/csv;charset=utf-8"}));const a=document.createElement("a");a.href=url;a.download=`Roteiva-${prefix}.csv`;a.click();URL.revokeObjectURL(url);}
  return <div className="finance-layout"><section className="panel finance-filters"><label><IconLabel icon={CalendarDays}>Mês</IconLabel><AppSelect aria-label="Mês" value={month} onValueChange={value=>{const next=Number(value);setMonth(next);onPeriodChange?.(year,next,client?Number(client):undefined);}}>{labels.map((l,i)=><option key={l} value={i}>{l}</option>)}</AppSelect></label><label><IconLabel icon={CalendarRange}>Ano</IconLabel><AppSelect aria-label="Ano" value={year} onValueChange={value=>{const next=Number(value);setYear(next);onPeriodChange?.(next,month,client?Number(client):undefined);}}>{years.map(y=><option key={y}>{y}</option>)}</AppSelect></label><label><IconLabel icon={UsersRound}>Cliente</IconLabel><AppSelect aria-label="Cliente" value={client} onValueChange={value=>{const next=value;setClient(next);onPeriodChange?.(year,month,next?Number(next):undefined);}}><option value="">Todos os clientes</option>{[...clients].sort((a,b)=>a.name.localeCompare(b.name,"pt-BR")).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</AppSelect></label><label><IconLabel icon={ListFilter}>Situação</IconLabel><AppSelect aria-label="Situação" value={status} onValueChange={value=>setStatus(value)}><option value="">Todas</option><option>Recebido</option><option>A receber</option></AppSelect></label><button className="secondary-button" onClick={csv}><Download size={15}/> Exportar CSV</button></section>
  <div className="finance-metrics"><article className="featured"><small className="finance-metric-label"><span>RECEITA PREVISTA · {labels[month].toUpperCase()} / {year}</span><TrendingUp size={19} aria-hidden="true"/></small><strong>{money(total)}</strong><p>{incomes.length} {incomes.length===1?"lançamento":"lançamentos"} no período</p></article><article><small className="finance-metric-label"><span>JÁ RECEBIDO</span><CircleCheck size={19} aria-hidden="true"/></small><strong>{money(received)}</strong><p>{money(pending)} a receber</p></article><article><small className="finance-metric-label"><span>CUSTOS DO MÊS</span><Receipt size={19} aria-hidden="true"/></small><strong>{money(sum(costs))}</strong><p>{costs.length} {costs.length===1?"custo":"custos"} de produção</p></article><article><small className="finance-metric-label"><span>RESULTADO PREVISTO</span><Scale size={19} aria-hidden="true"/></small><strong>{money(total-sum(costs))}</strong><p>Entradas menos custos registrados</p></article></div>
  {overdue.length>0&&<div className="studio-alert"><TriangleAlert size={18} aria-hidden="true"/> {overdue.length} lançamentos pendentes com vencimento passado neste mês.</div>}
  <div className="finance-main-grid"><section className="panel revenue-chart-panel"><div className="panel-head"><div><span><IconLabel icon={ChartColumnIncreasing}>FATURAMENTO ANUAL · {year}</IconLabel></span><h2>Receita por mês</h2></div><strong>{money(bars.reduce((a,b)=>a+b,0))}</strong></div><div className="revenue-chart"><div className="chart-y-axis">{[1,.75,.5,.25,0].map(f=><span key={f}>{new Intl.NumberFormat("pt-BR",{notation:"compact",maximumFractionDigits:1}).format(ceiling*f)}</span>)}</div><div className="chart-plot"><div className="chart-lines"><i/><i/><i/><i/><i/></div><div className="bars">{bars.map((v,i)=><button aria-label={`${labels[i]}: ${money(v)}`} title={`${labels[i]}: ${money(v)}`} className={`bar-column ${i===month?"current":""}`} key={i} onClick={()=>{setMonth(i);onPeriodChange?.(year,i,client?Number(client):undefined);}}><span className="bar-value">{money(v)}</span><i style={{height:`${v/ceiling*100}%`}}><em/></i><small>{labels[i]}</small></button>)}</div></div></div><div className="chart-insight"><p>Clique em um mês no gráfico para consultar seus lançamentos.</p></div></section><aside className="panel finance-side"><div className="panel-head"><div><span><IconLabel icon={ChartPie}>ORIGEM DAS RECEITAS</IconLabel></span><h2>Perfil do mês</h2></div></div><div className="donut-wrap"><div className="donut" style={{background:`conic-gradient(var(--chart-primary) 0 ${percent}%, var(--chart-secondary) ${percent}% 100%)`}}><span><b>{percent}%</b><small>recorrente</small></span></div></div><div className="revenue-sources"><div><span>Clientes recorrentes</span><b>{money(recurring)}</b></div><div><span>Avulsos ou sem vínculo</span><b>{money(total-recurring)}</b></div></div></aside></div>
  <section className="panel finance-table-panel"><div className="panel-head"><div><span><IconLabel icon={ListChecks}>{labels[month].toUpperCase()} / {year}</IconLabel></span><h2>Trabalhos do mês</h2></div><button onClick={onAdd}>Adicionar lançamento <Plus size={15}/></button></div><div className="finance-table-head"><span>Trabalho</span><span>Cliente</span><span>Data</span><span>Situação</span><span>Valor</span><span>Ações</span></div><div className="finance-table">{visible.map(e=><article key={e.id}><div><b>{e.project}</b><small>{e.kind==="expense"?"Despesa":"Receita"}</small></div><span>{e.client}</span><span>{e.date}</span><span><i className={`payment-status ${e.status==="Recebido"?"paid":"pending"}`}>{e.kind==="expense"?(e.status==="Recebido"?"Pago":"A pagar"):e.status}</i></span><strong className={e.kind==="expense"?"expense-amount":""}>{e.kind==="expense"?"−":""}{money(e.amount)}</strong><span className="revenue-actions"><button aria-label={`Editar receita ${e.project}`} title="Editar lançamento" onClick={()=>onEdit(e)}><Pencil size={17}/></button><button className="delete-revenue-button" aria-label={`Excluir receita ${e.project}`} title="Excluir lançamento" onClick={()=>onDelete(e)}><Trash2 size={17}/></button></span></article>)}{!visible.length&&<Empty>Nenhum lançamento com os filtros selecionados.</Empty>}</div></section></div>;
}
