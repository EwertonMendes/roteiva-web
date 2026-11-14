import {useState} from "react";
import {
  CalendarDays, CalendarRange, UsersRound, ListFilter, Download, TrendingUp,
  Eye, EyeOff, ReceiptText, Scale, TriangleAlert, ChartColumnIncreasing,
  ChartPie, FileText, Plus, Pencil, Trash2, Clock3, CircleCheck,
} from "lucide-react";
import {AppButton} from "../ui/AppButton";
import {AppSelect} from "../ui/AppSelect";
import {IconLabel} from "../ui/IconLabel";
import {CollectionState} from "../ui/CollectionState";
import {sumMoney,toISO} from "../../studio-finance";
import type {FinanceEntry,Client} from "../../domain/workspace";

const formatMoney=(value:number)=>new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(value);
const labels=["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
const today=()=>new Date().toLocaleDateString("en-CA");

type Props={
  entries:FinanceEntry[];
  clients:Client[];
  onAdd:()=>void;
  onEdit:(entry:FinanceEntry)=>void;
  onDelete:(entry:FinanceEntry)=>void;
  onPeriodChange?:(year:number,month:number,clientId?:number)=>void;
  serverBars?:{key:string;bars:number[]};
};

/** Presentation only. Entries and aggregated yearly bars are provided by the workspace layer. */
export function FinancePanel({entries,clients,onAdd,onEdit,onDelete,onPeriodChange,serverBars}:Props){
  const now=new Date();
  const [year,setYear]=useState(now.getFullYear());
  const [month,setMonth]=useState(now.getMonth());
  const [client,setClient]=useState("");
  const [status,setStatus]=useState("");
  const [receivedVisible,setReceivedVisible]=useState(true);
  const years=Array.from(new Set([
    now.getFullYear()+1,...Array.from({length:16},(_,i)=>now.getFullYear()-i),
    ...entries.map(e=>Number(toISO(e.date).slice(0,4))),
  ])).filter(Number.isFinite).sort((a,b)=>b-a);
  const base=entries.filter(e=>!client||String(e.clientId)===client);
  const yearly=base.filter(e=>Number(toISO(e.date).slice(0,4))===year);
  const prefix=year+"-"+String(month+1).padStart(2,"0");
  const monthly=base.filter(e=>toISO(e.date).startsWith(prefix));
  const incomes=monthly.filter(e=>e.kind!=="expense");
  const costs=monthly.filter(e=>e.kind==="expense");
  const visible=monthly.filter(e=>!status||e.status===status)
    .sort((a,b)=>toISO(b.date).localeCompare(toISO(a.date)));
  const total=sumMoney(incomes);
  const received=sumMoney(incomes.filter(e=>e.status==="Recebido"));
  const pending=sumMoney(incomes.filter(e=>e.status!=="Recebido"));
  const costTotal=sumMoney(costs);
  const recurring=sumMoney(incomes.filter(e=>clients.some(c=>c.id===e.clientId&&c.type==="Recorrente")));
  const percent=total?Math.round(recurring/total*100):0;
  const chartKey=year+"-"+(client||"");
  const bars=serverBars?.key===chartKey?serverBars.bars:
    labels.map((_,i)=>sumMoney(yearly.filter(e=>e.kind!=="expense"&&Number(toISO(e.date).slice(5,7))===i+1)));
  const max=Math.max(...bars,100);
  const step=10**Math.floor(Math.log10(max));
  // Reserve headroom for value labels positioned directly above each column.
  const ceiling=Math.ceil(max*1.2/step)*step;
  const overdue=monthly.filter(e=>e.status==="A receber"&&toISO(e.date)<today());
  const annual=bars.reduce((a,b)=>a+b,0);

  function selectMonth(next:number){setMonth(next);onPeriodChange?.(year,next,client?Number(client):undefined);}
  function csv(){
    const rows=[["Trabalho","Cliente","Data","Tipo","Situação","Valor"],
      ...visible.map(e=>[e.project,e.client,e.date,e.kind==="expense"?"Despesa":"Receita",e.status,e.amount.toFixed(2).replace(".",",")])];
    const text="\ufeff"+rows.map(row=>row.map(value=>'"'+String(value).replaceAll('"','""')+'"').join(";")).join("\r\n");
    const url=URL.createObjectURL(new Blob([text],{type:"text/csv;charset=utf-8"}));
    const link=document.createElement("a");link.href=url;link.download="Roteiva-"+prefix+".csv";link.click();URL.revokeObjectURL(url);
  }

  return <div className="finance-layout">
    <section className="panel finance-filters" aria-label="Filtros da gestão financeira">
      <label><IconLabel icon={CalendarDays}>Mês</IconLabel>
        <AppSelect aria-label="Mês" value={month} onValueChange={v=>selectMonth(Number(v))}>
          {labels.map((label,i)=><option key={label} value={i}>{label}</option>)}
        </AppSelect>
      </label>
      <label><IconLabel icon={CalendarRange}>Ano</IconLabel>
        <AppSelect aria-label="Ano" value={year} onValueChange={v=>{const next=Number(v);setYear(next);onPeriodChange?.(next,month,client?Number(client):undefined);}}>
          {years.map(y=><option key={y}>{y}</option>)}
        </AppSelect>
      </label>
      <label><IconLabel icon={UsersRound}>Cliente</IconLabel>
        <AppSelect aria-label="Cliente" value={client} onValueChange={v=>{setClient(v);onPeriodChange?.(year,month,v?Number(v):undefined);}}>
          <option value="">Todos os clientes</option>
          {[...clients].sort((a,b)=>a.name.localeCompare(b.name,"pt-BR")).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
        </AppSelect>
      </label>
      <label><IconLabel icon={ListFilter}>Situação</IconLabel>
        <AppSelect aria-label="Situação" value={status} onValueChange={setStatus}>
          <option value="">Todas</option><option>Recebido</option><option>A receber</option>
        </AppSelect>
      </label>
      <AppButton className="finance-csv-button" type="button" onClick={csv}><Download size={18} aria-hidden="true"/> Exportar CSV</AppButton>
    </section>

    <div className="finance-metrics" aria-label="Resumo financeiro do mês">
      <article className="featured">
        <small className="finance-metric-label"><span>RECEITA PREVISTA · {labels[month].toUpperCase()} / {year}</span><TrendingUp size={23} aria-hidden="true"/></small>
        <strong>{formatMoney(total)}</strong>
        <p>{incomes.length} {incomes.length===1?"lançamento":"lançamentos"} no período</p>
      </article>
      <article>
        <small className="finance-metric-label"><span>JÁ RECEBIDO</span><AppButton type="button" className="finance-received-visibility"
          aria-label={receivedVisible?"Ocultar valores recebidos":"Mostrar valores recebidos"}
          aria-pressed={!receivedVisible} title={receivedVisible?"Ocultar valores":"Mostrar valores"}
          onClick={()=>setReceivedVisible(value=>!value)}>
          {receivedVisible?<Eye size={23} aria-hidden="true"/>:<EyeOff size={23} aria-hidden="true"/>}
        </AppButton></small>
        <strong>{receivedVisible?formatMoney(received):"••••••"}</strong>
        <p>{receivedVisible?formatMoney(pending):"••••••"} a receber</p>
      </article>
      <article>
        <small className="finance-metric-label"><span>CUSTOS DO MÊS</span><ReceiptText size={23} aria-hidden="true"/></small>
        <strong>{formatMoney(costTotal)}</strong><p>{costs.length} {costs.length===1?"custo":"custos"} de produção</p>
      </article>
      <article className="finance-result">
        <small className="finance-metric-label"><span>RESULTADO PREVISTO</span><Scale size={23} aria-hidden="true"/></small>
        <strong className={total-costTotal<0?"negative":"positive"}>{formatMoney(total-costTotal)}</strong>
        <p>Entradas menos custos registrados</p>
      </article>
    </div>

    {overdue.length>0&&<div className="studio-alert" role="status">
      <TriangleAlert size={20} aria-hidden="true"/>
      <span>{overdue.length} {overdue.length===1?"lançamento pendente":"lançamentos pendentes"} com vencimento passado neste mês.</span>
    </div>}

    <div className="finance-main-grid">
      <section className="panel revenue-chart-panel" aria-label="Faturamento anual">
        <div className="panel-head">
          <div><span><IconLabel icon={ChartColumnIncreasing}>FATURAMENTO ANUAL · {year}</IconLabel></span><h2>Receita por mês</h2></div>
          <strong>{formatMoney(annual)}</strong>
        </div>
        <div className="finance-chart-scroll" tabIndex={0} role="region" aria-label="Gráfico de receita por mês; role para ver os demais meses no celular">
          <div className="revenue-chart">
            <div className="chart-y-axis">{[1,.75,.5,.25,0].map(f=><span key={f}>{new Intl.NumberFormat("pt-BR",{notation:"compact",maximumFractionDigits:1}).format(ceiling*f)}</span>)}</div>
            <div className="chart-plot"><div className="chart-lines"><i/><i/><i/><i/><i/></div>
              <div className="bars">{bars.map((value,i)=><AppButton type="button" key={i}
                className={"bar-column"+(i===month?" current":"")} aria-pressed={i===month}
                aria-label={labels[i]+": "+formatMoney(value)} title={labels[i]+": "+formatMoney(value)}
                onClick={()=>selectMonth(i)}>
                <i style={{height:Math.max(value/ceiling*100,0)+"%"}} aria-hidden="true">
                  <span className="bar-value">{formatMoney(value)}</span>
                </i>
                <small>{labels[i]}</small>
              </AppButton>)}</div>
            </div>
          </div>
        </div>
      </section>
      <aside className="panel finance-side">
        <div className="panel-head"><div><span><IconLabel icon={ChartPie}>ORIGEM DAS RECEITAS</IconLabel></span><h2>Perfil do mês</h2></div></div>
        <div className="donut-wrap">
          <div className="donut" role="img" aria-label={percent+"% da receita prevista vem de clientes recorrentes"}
            style={{background:percent===100?"var(--finance-green)":percent===0?"var(--finance-donut-track)":
              "conic-gradient(var(--finance-green) 0 "+percent+"%, var(--finance-donut-track) "+percent+"% 100%)"}}>
            <span><b>{percent}%</b><small>recorrente</small></span>
          </div>
        </div>
        <div className="revenue-sources">
          <div><span><i className="recurring-dot" aria-hidden="true"/>Clientes recorrentes</span><b>{formatMoney(recurring)}</b></div>
          <div><span><i className="oneoff-dot" aria-hidden="true"/>Avulsos ou sem vínculo</span><b>{formatMoney(total-recurring)}</b></div>
        </div>
      </aside>
    </div>

    <section className="panel finance-table-panel">
      <div className="panel-head">
        <div><span><IconLabel icon={FileText}>TRABALHOS DO MÊS</IconLabel></span></div>
        <AppButton type="button" onClick={onAdd} className="finance-add-entry"><Plus size={17} aria-hidden="true"/> Adicionar lançamento</AppButton>
      </div>
      <div className="finance-table-head" aria-hidden="true">
        <span>Trabalho</span><span>Cliente</span><span>Data</span><span>Situação</span><span>Valor</span><span>Ações</span>
      </div>
      <div className="finance-table">
        {visible.map(e=><article key={e.id}>
          <div className="finance-work-name"><b>{e.project}</b><small>{e.kind==="expense"?"Despesa":"Receita"}</small></div>
          <span className="finance-cell finance-client" data-label="Cliente">{e.client||"Sem cliente vinculado"}</span>
          <span className="finance-cell finance-date" data-label="Data">{e.date}</span>
          <span className="finance-cell finance-status" data-label="Situação"><i className={"payment-status "+(e.status==="Recebido"?"paid":"pending")}>
            {e.status==="Recebido"?<CircleCheck size={15} aria-hidden="true"/>:<Clock3 size={15} aria-hidden="true"/>}
            {e.kind==="expense"?(e.status==="Recebido"?"Pago":"A pagar"):e.status}
          </i></span>
          <strong className={"finance-cell finance-amount"+(e.kind==="expense"?" expense-amount":"")} data-label="Valor">{e.kind==="expense"?"−":""}{formatMoney(e.amount)}</strong>
          <span className="revenue-actions">
            <AppButton type="button" className="edit-revenue-button" aria-label={"Editar "+(e.kind==="expense"?"despesa ":"receita ")+e.project} title="Editar lançamento" onClick={()=>onEdit(e)}><Pencil size={16} aria-hidden="true"/><span>Editar</span></AppButton>
            <AppButton type="button" className="delete-revenue-button" aria-label={"Excluir "+(e.kind==="expense"?"despesa ":"receita ")+e.project} title="Excluir lançamento" onClick={()=>onDelete(e)}><Trash2 size={16} aria-hidden="true"/></AppButton>
          </span>
        </article>)}
        {!visible.length&&<CollectionState message="Nenhum lançamento com os filtros selecionados."/>}
      </div>
    </section>
  </div>;
}
