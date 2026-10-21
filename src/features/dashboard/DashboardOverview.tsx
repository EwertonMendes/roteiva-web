import { useState } from "react";
import { CalendarDays, Eye, EyeOff } from "lucide-react";
import { PROJECT_STATUS_ICONS } from "../ui/project-status";
import { ActivityPreview } from "./ActivityHistory";
import { eventRange } from "../../studio-calendar";
import { sumMoney } from "../../studio-finance";
import type { Project, Client, FinanceEntry, CalendarEvent, View, Status } from "../../dashboard-client";

const money = (value:number) => new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(value);
const civilToday = () => {
  const now = new Date();
  return [now.getFullYear(),String(now.getMonth()+1).padStart(2,"0"),String(now.getDate()).padStart(2,"0")].join("-");
};
type Summary = {clientCount?:number;receivableAmount?:number;cashBalance?:number;projectCount?:number;projectStatuses?:Record<Status,number>};
type Props = {
  projects:Project[];clients:Client[];entries:FinanceEntry[];events:CalendarEvent[];
  activities:{text:string;when:string}[];onView:(view:View)=>void;onOpenActivity:()=>void;overviewMetrics?:Summary;
};

export function TodayStudio({projects,clients,entries,events,activities,onView,onOpenActivity,overviewMetrics}:Props) {
  const [showBalance,setShowBalance] = useState(true);
  const statuses = overviewMetrics?.projectStatuses;
  const projectCount = overviewMetrics?.projectCount ?? projects.length;
  const active = statuses && overviewMetrics?.projectCount !== undefined
    ? projectCount - statuses.Aprovado : projects.filter(project => project.status !== "Aprovado").length;
  const pending = statuses ? statuses["Em aprovação"] + statuses.Ajustes
    : projects.filter(project => project.status === "Em aprovação" || project.status === "Ajustes").length;
  const approved = statuses?.Aprovado ?? projects.filter(project => project.status === "Aprovado").length;
  const received = entries.filter(entry => entry.kind !== "expense" && entry.status === "Recebido");
  const paid = entries.filter(entry => entry.kind === "expense" && entry.status === "Recebido");
  const localBalance = Math.round((sumMoney(received) - sumMoney(paid))*100)/100;
  const balance = overviewMetrics?.cashBalance ?? localBalance;
  const receivable = overviewMetrics?.receivableAmount ?? sumMoney(entries.filter(entry => entry.kind !== "expense" && entry.status === "A receber"));
  const phases = [
    {label:"Produção",status:"Em produção",color:"var(--phase-production)"},
    {label:"Aprovação",status:"Em aprovação",color:"var(--phase-approval)"},
    {label:"Ajustes",status:"Ajustes",color:"var(--phase-adjustments)"},
    {label:"Concluídos",status:"Aprovado",color:"var(--phase-completed)"},
  ].map(phase => ({...phase,count:statuses?.[phase.status as Status] ?? projects.filter(project => project.status === phase.status).length}));
  const today = civilToday();
  const clock = new Date().toTimeString().slice(0,5);
  const next = [...events]
    .filter(event => event.date > today || (event.date === today && (event.endTime || event.time) >= clock))
    .sort((a,b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`))[0];

  return <section className="panel flow-overview" aria-label="Panorama geral do estúdio">
    <header className="flow-overview-head">
      <div><span className="eyebrow">PANORAMA GERAL</span><h2>O ritmo do seu estúdio</h2></div>
      <span className="flow-total">{projectCount} {projectCount === 1 ? "projeto" : "projetos"} no total</span>
    </header>
    <div className="flow-numbers">
      <button type="button" onClick={() => onView("projects")}><span>Projetos ativos</span><strong>{active}</strong><small>Em produção e revisão</small></button>
      <button type="button" onClick={() => onView("reviews")}><span>Em revisão</span><strong>{pending}</strong><small>Aprovações e ajustes</small></button>
      <button type="button" onClick={() => onView("clients")}><span>Clientes</span><strong>{overviewMetrics?.clientCount ?? clients.length}</strong><small>Na sua carteira</small></button>
      <div className="flow-metric-finance">
        <div className="flow-finance-top"><button type="button" onClick={() => onView("finance")}>Saldo em caixa</button>
          <button type="button" className="flow-balance-visibility" onClick={() => setShowBalance(value => !value)}
            aria-label={showBalance ? "Ocultar valores financeiros" : "Mostrar valores financeiros"}
            aria-pressed={!showBalance} title={showBalance ? "Ocultar valores" : "Mostrar valores"}>
            {showBalance ? <Eye size={18} /> : <EyeOff size={18} />}
          </button>
        </div>
        <button className="flow-finance-amount" type="button" onClick={() => onView("finance")}>
          <strong className="flow-money">{showBalance ? money(balance) : "••••••"}</strong>
          <small>Valor a receber <b>{showBalance ? money(receivable) : "••••"}</b></small>
        </button>
      </div>
    </div>
    <div className="flow-progress">
      <div className="flow-progress-title"><span>Fluxo de produção</span><b>{projectCount ? `${approved} de ${projectCount} concluídos` : "Nenhum projeto ainda"}</b></div>
      <div className={`flow-track ${projectCount ? "" : "is-empty"}`} role="img" aria-label={phases.map(phase => `${phase.label}: ${phase.count}`).join(", ")}>
        {phases.filter(phase => phase.count > 0).map(phase => <i key={phase.status} style={{width:`${phase.count / Math.max(1,projectCount)*100}%`,background:phase.color}}/>)}
      </div>
      <div className="flow-legend">{phases.map(phase => { const StatusIcon=PROJECT_STATUS_ICONS[phase.status as Status]; return <span key={phase.status} style={{color:phase.color}}><StatusIcon size={17} strokeWidth={2} aria-hidden="true"/><span>{phase.label}</span><b>{phase.count}</b></span>; })}</div>
    </div>
    <footer className="flow-next"><CalendarDays size={22} aria-hidden="true"/><div><span>Próximo compromisso</span>
      <p>{next ? <><b>{next.title}</b> · {next.date.split("-").reverse().join("/")} · {eventRange(next)}</> : "Sua agenda está livre. Adicione a próxima produção."}</p>
    </div><button className="secondary-button" type="button" onClick={() => onView("calendar")}>Ver agenda</button></footer>
    <ActivityPreview activities={activities} onOpen={onOpenActivity}/>
  </section>;
}
