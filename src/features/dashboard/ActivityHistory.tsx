import {AppButton} from "../ui/AppButton";
import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, CircleDollarSign, FolderKanban, History, ReceiptText, UserRound, Wallet, X } from "lucide-react";
import type { Activity } from "../../domain/workspace";

type Category = "projects" | "finance" | "clients" | "calendar" | "other";
type Filter = "all" | Category;
type Item = Activity & {category: Category; title: string; detail: string; date: Date | null};

function classify(text: string): Category {
  if (/^(projeto|entregas)\b/i.test(text)) return "projects";
  if (/^(receita|despesa|lançamento)\b/i.test(text)) return "finance";
  if (/^cliente\b/i.test(text)) return "clients";
  if (/^compromisso\b/i.test(text)) return "calendar";
  return "other";
}
function describe(activity: Activity): Item {
  const split = activity.text.indexOf(":");
  const title = split >= 0 ? activity.text.slice(0,split).trim() : activity.text.trim();
  const detail = split >= 0 ? activity.text.slice(split+1).trim() : "";
  const date = new Date(activity.when);
  return {...activity, title, detail, category:classify(title), date:Number.isNaN(date.getTime())?null:date};
}
const dateKey = (date:Date) => [date.getFullYear(),date.getMonth(),date.getDate()].join("-");
const timeFormatter = new Intl.DateTimeFormat("pt-BR",{hour:"2-digit",minute:"2-digit"});
const dateFormatter = new Intl.DateTimeFormat("pt-BR",{day:"2-digit",month:"2-digit"});
const dayFormatter = new Intl.DateTimeFormat("pt-BR",{day:"numeric",month:"long",year:"numeric"});
function itemTime(item:Item,compact:boolean) {
  if (!item.date) return "";
  const time=timeFormatter.format(item.date);
  return compact && dateKey(item.date)!==dateKey(new Date()) ? `${dateFormatter.format(item.date)} · ${time}` : time;
}
function groupLabel(item:Item) {
  if (!item.date) return "Sem data";
  const now = new Date();
  if(dateKey(item.date)===dateKey(now)) return "Hoje";
  const yesterday=new Date(now.getFullYear(),now.getMonth(),now.getDate()-1);
  if(dateKey(item.date)===dateKey(yesterday)) return "Ontem";
  return dayFormatter.format(item.date);
}
export function sortedActivityItems(activities: readonly Activity[]):Item[] {
  return activities.map(describe).sort((a,b)=>(b.date?.getTime()??0)-(a.date?.getTime()??0));
}
function ActivityIcon({item}:{item:Item}) {
  const Icon = item.category === "projects" ? FolderKanban
    : item.category === "clients" ? UserRound
    : item.category === "calendar" ? CalendarDays
    : item.category === "finance" ? (/^receita/i.test(item.title) ? CircleDollarSign : /^despesa/i.test(item.title) ? ReceiptText : Wallet)
    : History;
  return <span className={`activity-kind-icon activity-kind-${item.category}`} aria-hidden="true"><Icon size={18} strokeWidth={1.9}/></span>;
}
export function ActivityRow({item,compact=false}:{item:Item;compact?:boolean}) {
  return <div className={`activity-history-item ${compact?"is-compact":""}`}>
    <ActivityIcon item={item}/>
    <div className="activity-history-copy"><strong title={item.title}>{item.title}</strong>{item.detail && <span title={item.detail}>{item.detail}</span>}</div>
    {item.date && <time dateTime={item.when} title={item.date.toLocaleString("pt-BR")} suppressHydrationWarning>{itemTime(item,compact)}</time>}
  </div>;
}
export function ActivityPreview({activities,onOpen}:{activities:readonly Activity[];onOpen:()=>void}) {
  const latest=useMemo(()=>sortedActivityItems(activities).slice(0,2),[activities]);
  return <section className="flow-activity-preview" aria-label="Atividade recente">
    <div className="flow-activity-header"><span><History size={18} aria-hidden="true"/> Atividade recente</span>
      <AppButton className="flow-activity-open" type="button" onClick={onOpen}>Ver histórico completo <span aria-hidden="true">→</span></AppButton>
    </div>
    {latest.length ? <div className="flow-activity-rows">{latest.map((item,index)=><ActivityRow item={item} compact key={item.id||`${item.when}-${index}`}/>)}</div>
      : <p className="flow-activity-empty">Suas próximas movimentações aparecerão aqui.</p>}
  </section>;
}
export function ActivityHistoryDrawer({activities,onClose}:{activities:readonly Activity[];onClose:()=>void}) {
  const [filter,setFilter]=useState<Filter>("all");
  const panelRef=useRef<HTMLElement>(null);
  const closeRef=useRef<HTMLButtonElement>(null);
  const items=useMemo(()=>sortedActivityItems(activities),[activities]);
  const filtered=useMemo(()=>items.filter(item=>filter==="all"||item.category===filter),[items,filter]);
  const groups=useMemo(()=>{
    const result=new Map<string,Item[]>();
    for(const item of filtered) {
      const label=groupLabel(item);
      if(!result.has(label)) result.set(label,[]);
      result.get(label)!.push(item);
    }
    return [...result.entries()];
  },[filtered]);
  const options: {value:Filter;label:string}[]=[
    {value:"all",label:"Todas"},{value:"projects",label:"Projetos"},
    {value:"finance",label:"Financeiro"},{value:"clients",label:"Clientes"},
    ...(items.some(item=>item.category==="calendar")?[{value:"calendar" as const,label:"Agenda"}]:[]),
    ...(items.some(item=>item.category==="other")?[{value:"other" as const,label:"Outras"}]:[]),
  ];
  useEffect(()=>{
    const previousFocus=document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow=document.body.style.overflow;
    document.body.style.overflow="hidden";
    closeRef.current?.focus();
    const onKey=(event:KeyboardEvent)=>{
      if(event.key==="Escape"){event.preventDefault();onClose();return;}
      if(event.key!=="Tab"||!panelRef.current)return;
      const focusable=[...panelRef.current.querySelectorAll<HTMLElement>('button:not([disabled]),[href],input:not([disabled]),[tabindex]:not([tabindex="-1"])')];
      if(!focusable.length)return;
      const first=focusable[0],last=focusable[focusable.length-1];
      if(event.shiftKey&&(document.activeElement===first||!panelRef.current.contains(document.activeElement))){
        event.preventDefault();last.focus();
      }else if(!event.shiftKey&&(document.activeElement===last||!panelRef.current.contains(document.activeElement))){
        event.preventDefault();first.focus();
      }
    };
    window.addEventListener("keydown",onKey);
    return ()=>{
      window.removeEventListener("keydown",onKey);
      document.body.style.overflow=previousOverflow;
      if(previousFocus?.isConnected)previousFocus.focus();
    };
  },[onClose]);
  return <div className="activity-history-overlay">
    <AppButton type="button" className="activity-history-backdrop" onClick={onClose} aria-label="Fechar histórico de atividades"/>
    <section id="activity-history-drawer" ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="activity-history-title" className="activity-history-drawer">
      <header className="activity-drawer-heading"><div><h2 id="activity-history-title">Histórico de atividades</h2><p>Acompanhe as movimentações do seu espaço.</p></div>
        <AppButton ref={closeRef} type="button" className="activity-drawer-close" onClick={onClose} aria-label="Fechar histórico"><X size={20}/></AppButton>
      </header>
      <div className="activity-drawer-filters" role="group" aria-label="Filtrar atividades">
        {options.map(option=><AppButton key={option.value} type="button" className={filter===option.value?"selected":""}
          aria-pressed={filter===option.value} onClick={()=>setFilter(option.value)}>{option.label}</AppButton>)}
      </div>
      <div className="activity-drawer-content">
        {!groups.length ? <div className="activity-drawer-empty"><History size={26}/><strong>Nenhuma atividade por aqui</strong><p>{filter==="all"?"As movimentações do seu espaço aparecerão neste histórico.":"Ainda não existem registros nessa categoria."}</p></div>
          : groups.map(([label,entries])=><section className="activity-history-group" key={label}><h3>{label}</h3><div>{entries.map((item,index)=><ActivityRow key={item.id||`${item.when}-${index}`} item={item}/>)}</div></section>)}
      </div>
    </section>
  </div>;
}
