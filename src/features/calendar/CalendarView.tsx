import {useEffect,useMemo,useRef,useState} from "react";
import {CalendarDays,ChevronLeft,ChevronRight,Plus,Pencil,Trash2,X} from "lucide-react";
import {AppButton} from "../ui/AppButton";
import type {CalendarEvent,Project} from "../../domain/workspace";
import {eventRange} from "../../studio-calendar";
import {calendarCells,dateKey,localDate,todayKey} from "./calendar-dates";

const months=["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
const weekdays=["DOM","SEG","TER","QUA","QUI","SEX","SÁB"];
const sorted=(entries:readonly CalendarEvent[])=>[...entries].sort((a,b)=>(a.date+"T"+a.time+a.id).localeCompare(b.date+"T"+b.time+b.id));
type FocusDate={date:string;revision:number}|null;
type Props={
  events:CalendarEvent[];
  projects:Project[];
  onAdd:(date:string)=>void;
  onEdit:(event:CalendarEvent)=>void;
  onDelete:(event:CalendarEvent)=>void;
  onMonthChange?:(year:number,month:number)=>void;
  focusDate?:FocusDate;
};

function DayEventsDialog({date,events,projects,onClose,onAdd,onEdit,onDelete}:{
  date:string;events:CalendarEvent[];projects:Project[];
  onClose:()=>void;onAdd:()=>void;onEdit:(item:CalendarEvent)=>void;onDelete:(item:CalendarEvent)=>void;
}) {
  const dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{
    const node=dialog.current;
    node?.showModal();
    return ()=>{if(node?.open)node.close();};
  },[]);
  const formatted=localDate(date).toLocaleDateString("pt-BR",{weekday:"long",day:"numeric",month:"long",year:"numeric"});
  return <dialog ref={dialog} onClose={onClose} className="roteiva-calendar-dialog day-events-dialog"
    aria-labelledby="day-events-title" onMouseDown={event=>{if(event.target===event.currentTarget)event.currentTarget.close();}}>
    <div className="calendar-dialog-head">
      <div className="calendar-dialog-heading"><CalendarDays size={21} aria-hidden="true"/><span>Compromissos do dia</span></div>
      <AppButton type="button" className="calendar-dialog-close" aria-label="Fechar compromissos do dia" onClick={onClose}><X size={21}/></AppButton>
    </div>
    <div className="calendar-day-heading">
      <h2 id="day-events-title">{formatted.slice(0,1).toUpperCase()+formatted.slice(1)}</h2>
      <div className="calendar-day-actions"><span>{events.length} {events.length===1?"compromisso":"compromissos"}</span>
        <AppButton className="primary-button" onClick={onAdd}><Plus size={18}/> Novo compromisso</AppButton>
      </div>
    </div>
    <div className="calendar-day-records">
      {sorted(events).map(item=>{
        const project=projects.find(p=>p.id===item.projectId);
        return <article key={item.id} className="calendar-day-record">
          <div className="calendar-record-time"><b>{item.time}{item.endTime?" – "+item.endTime:""}</b><small>{item.endTime?"":"Sem término"}</small></div>
          <div className="calendar-record-info">
            <b>{item.title}</b>
            <div><span className="calendar-event-kind">{item.type}</span><span>{item.client||"Sem cliente"} · {project?.name||"Sem projeto"}</span></div>
          </div>
          <div className="calendar-record-actions">
            <AppButton className="secondary-button" aria-label={"Editar "+item.title} onClick={()=>onEdit(item)}><Pencil size={16}/> Editar</AppButton>
            {!item.autoDeadline&&<AppButton className="calendar-record-delete" aria-label={"Excluir "+item.title} title="Excluir compromisso" onClick={()=>onDelete(item)}><Trash2 size={16}/></AppButton>}
          </div>
        </article>;
      })}
    </div>
  </dialog>;
}

export function CalendarView({events,projects,onAdd,onEdit,onDelete,onMonthChange,focusDate}:Props) {
  const today=todayKey();
  const [cursor,setCursor]=useState(()=>{const now=new Date();return new Date(now.getFullYear(),now.getMonth(),1,12);});
  const [selectedDate,setSelectedDate]=useState(today);
  const [openedDay,setOpenedDay]=useState<string|null>(null);
  const year=cursor.getFullYear(),month=cursor.getMonth();
  useEffect(()=>onMonthChange?.(year,month),[year,month,onMonthChange]);
  useEffect(()=>{
    if(!focusDate?.date)return;
    setSelectedDate(focusDate.date);
    const next=localDate(focusDate.date);
    setCursor(new Date(next.getFullYear(),next.getMonth(),1,12));
  },[focusDate?.revision,focusDate?.date]);
  const cells=useMemo(()=>calendarCells(year,month),[year,month]);
  const perDate=useMemo(()=>{
    const map=new Map<string,CalendarEvent[]>();
    for(const event of sorted(events)){
      const list=map.get(event.date)||[];
      list.push(event);
      map.set(event.date,list);
    }
    return map;
  },[events]);
  const selectedEvents=perDate.get(selectedDate)||[];
  const upcoming=useMemo(()=>sorted(events).filter(e=>e.date>=today&&e.date>=selectedDate).slice(0,50),[events,today,selectedDate]);
  function selectDate(key:string){
    setSelectedDate(key);
    const next=localDate(key);
    if(next.getMonth()!==month||next.getFullYear()!==year){
      setCursor(new Date(next.getFullYear(),next.getMonth(),1,12));
    }
    if((perDate.get(key)||[]).length)setOpenedDay(key);
    else onAdd(key);
  }
  function navigateMonth(delta:number) {
    const next=new Date(year,month+delta,1,12);
    const currentDay=localDate(selectedDate).getDate();
    const day=Math.min(currentDay,new Date(next.getFullYear(),next.getMonth()+1,0,12).getDate());
    setCursor(next);setSelectedDate(dateKey(next.getFullYear(),next.getMonth(),day));
    setOpenedDay(null);
  }
  // Keep the day sheet mounted under the child editor/confirmation. Native
  // dialogs are stacked by the browser's top layer; closing a child restores
  // the day sheet and its selection without destroying state.
  function openChildAdd(date:string){onAdd(date);}
  function openChildEdit(item:CalendarEvent){onEdit(item);}
  function openChildDelete(item:CalendarEvent){onDelete(item);}
  return <div className="calendar-layout roteiva-calendar">
    <section className="panel calendar-panel" aria-label="Calendário mensal">
      <div className="calendar-toolbar"><div>
        <AppButton aria-label="Mês anterior" onClick={()=>navigateMonth(-1)}><ChevronLeft size={20}/></AppButton>
        <AppButton aria-label="Próximo mês" onClick={()=>navigateMonth(1)}><ChevronRight size={20}/></AppButton>
      </div><h2>{months[month]} <span>{year}</span></h2>
      <AppButton className="secondary-button" onClick={()=>{
        const now=new Date();setCursor(new Date(now.getFullYear(),now.getMonth(),1,12));setSelectedDate(dateKey(now.getFullYear(),now.getMonth(),now.getDate()));
      }}>Hoje</AppButton></div>
      <div className="calendar-week">{weekdays.map(name=><span key={name}>{name}</span>)}</div>
      <div className="calendar-grid" style={{gridTemplateRows:"repeat("+(cells.length/7)+",minmax(0,1fr))"}}>{cells.map(cell=>{
        const items=perDate.get(cell.key)||[];
        const cellDate=localDate(cell.key);
        const label=cell.day+" de "+months[cellDate.getMonth()].toLowerCase()+" de "+cellDate.getFullYear()+", "+items.length+" "+(items.length===1?"compromisso":"compromissos");
        return <AppButton key={cell.key} className={(cell.current?"":"outside")+(selectedDate===cell.key?" selected":"")+(cell.key===today?" today":"")+(items.length?" has-events":"")}
          aria-label={label} aria-pressed={selectedDate===cell.key} onClick={()=>selectDate(cell.key)}>
          <b>{cell.day}</b>{items.length>0&&<span className="calendar-event-counter" aria-hidden="true">{items.length}</span>}
        </AppButton>;
      })}</div>
    </section>
    <aside className="panel agenda-panel">
      <div className="panel-head"><div><span>AGENDA DO DIA</span><h2>{localDate(selectedDate).toLocaleDateString("pt-BR",{day:"numeric",month:"long"})}</h2></div>
        <AppButton aria-label="Adicionar compromisso neste dia" onClick={()=>onAdd(selectedDate)}><Plus size={21}/></AppButton>
      </div>
      <div className="calendar-agenda-body">
        {selectedEvents.length>0
          ? <div className="calendar-agenda-events">
              {selectedEvents.slice(0,2).map(item=><AppButton key={item.id} className="calendar-agenda-row" onClick={()=>setOpenedDay(selectedDate)}>
                <b>{item.time}</b><span>{item.title}</span><small>{item.type}</small>
              </AppButton>)}
              <AppButton className="calendar-agenda-all" onClick={()=>setOpenedDay(selectedDate)}>Ver agenda completa do dia{selectedEvents.length>4?" ("+selectedEvents.length+")":""}</AppButton>
            </div>
          : <div className="agenda-empty"><CalendarDays size={29}/><b>Dia livre</b><span>Nenhum compromisso nesta data.</span>
              <AppButton onClick={()=>onAdd(selectedDate)}>Adicionar compromisso</AppButton></div>}
      </div>
      <div className="upcoming-list"><span>PRÓXIMOS COMPROMISSOS</span>
        <div className="upcoming-scroll" tabIndex={upcoming.length>3?0:undefined} aria-label="Lista de próximos compromissos">
          {upcoming.map(item=><article key={item.id}>
            <div><b>{localDate(item.date).getDate()}</b><small>{months[localDate(item.date).getMonth()].slice(0,3)}</small></div>
            <p><b>{item.title}</b><small>{eventRange(item)} · {item.client||"Sem cliente vinculado"}</small></p>
          </article>)}
        </div>
      </div>
    </aside>
    {openedDay&&<DayEventsDialog key={openedDay} date={openedDay} events={perDate.get(openedDay)||[]} projects={projects}
      onClose={()=>setOpenedDay(null)} onAdd={()=>openChildAdd(openedDay)} onEdit={openChildEdit} onDelete={openChildDelete}/>}
  </div>;
}
