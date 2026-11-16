import {useEffect,useId,useRef,useState,type KeyboardEvent} from "react";
import {CalendarDays,ChevronLeft,ChevronRight,Check,Clock3,X} from "lucide-react";
import {AppButton} from "../ui/AppButton";
import {AppInput} from "../ui/AppInput";
import {calendarCells,dateKey,isValidCivilDate,localDate,todayKey} from "./calendar-dates";
import {dateInputError,maskDateText,maskTimeText,normalizeTimeText,parseDateText,timeInputError} from "./calendar-input";

const MONTHS=["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
const WEEKDAYS=["D","S","T","Q","Q","S","S"];

function useOutsideDismiss(ref:React.RefObject<HTMLDivElement|null>,open:boolean,close:()=>void){
  useEffect(()=>{
    if(!open)return;
    function onPointer(event:PointerEvent){
      if(event.target instanceof Node&&!ref.current?.contains(event.target))close();
    }
    document.addEventListener("pointerdown",onPointer);
    return ()=>document.removeEventListener("pointerdown",onPointer);
  },[ref,open,close]);
}
function displayDate(iso:string){
  if(!isValidCivilDate(iso))return "";
  const [year,month,day]=iso.split("-");
  return day+"/"+month+"/"+year;
}
export function CalendarDateField({value,onChange,showValidation=false}:{value:string;onChange:(value:string)=>void;showValidation?:boolean}){
  const [draft,setDraft]=useState(()=>displayDate(value));
  const [touched,setTouched]=useState(false);
  const helpId=useId();
  const fieldError=(touched||showValidation)?dateInputError(draft):"";
  const [open,setOpen]=useState(false);
  const [cursor,setCursor]=useState(()=>localDate(isValidCivilDate(value)?value:todayKey()));
  const root=useRef<HTMLDivElement>(null);
  const input=useRef<HTMLInputElement>(null);
  const trigger=useRef<HTMLButtonElement>(null);
  const popupId=useId();
  // A partial date keeps its text while the parent receives an invalid (empty) value.
  useEffect(()=>{if(value&&isValidCivilDate(value))setDraft(displayDate(value));},[value]);
  useOutsideDismiss(root,open,()=>setOpen(false));
  const year=cursor.getFullYear(),month=cursor.getMonth();
  const selected=isValidCivilDate(value)?value:todayKey();
  const [focused,setFocused]=useState(selected);
  function select(key:string){
    setDraft(displayDate(key));onChange(key);setTouched(true);setFocused(key);setOpen(false);trigger.current?.focus();
  }
  function reveal(){
    const origin=isValidCivilDate(value)?localDate(value):localDate(todayKey());
    setCursor(new Date(origin.getFullYear(),origin.getMonth(),1,12));
    setFocused(dateKey(origin.getFullYear(),origin.getMonth(),origin.getDate()));
    setOpen(v=>!v);
  }
  function onGridKeyDown(event:KeyboardEvent<HTMLDivElement>){
    const changes:Record<string,number>={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7};
    if(event.key==="Escape"){event.preventDefault();setOpen(false);trigger.current?.focus();return;}
    if(event.key==="Enter"||event.key===" "){event.preventDefault();select(focused);return;}
    if(!(event.key in changes))return;
    event.preventDefault();
    const next=localDate(focused);
    next.setDate(next.getDate()+changes[event.key]);
    const key=dateKey(next.getFullYear(),next.getMonth(),next.getDate());
    setFocused(key);setCursor(new Date(next.getFullYear(),next.getMonth(),1,12));
    requestAnimationFrame(()=>root.current?.querySelector<HTMLButtonElement>('[data-date-key="'+key+'"]')?.focus());
  }
  return <div className="calendar-picker" ref={root} onKeyDown={event=>{if(open&&event.key==="Escape"){event.preventDefault();event.stopPropagation();setOpen(false);trigger.current?.focus();}}}>
    <div className="calendar-picker-control">
      <AppInput type="text" ref={input} aria-label="Data do compromisso" inputMode="numeric" autoComplete="off"
        placeholder="dd/mm/aaaa" maxLength={10} value={draft} invalid={!!fieldError}
        aria-describedby={fieldError?helpId:undefined}
        onChange={event=>{
          const next=maskDateText(event.target.value);
          setDraft(next);onChange(parseDateText(next));
        }}
        onBlur={()=>setTouched(true)}
        onKeyDown={event=>{if(event.key==="Escape"&&open){event.stopPropagation();setOpen(false);}}}/>
      <AppButton ref={trigger} type="button" className="calendar-picker-toggle"
        aria-label="Abrir calendário de data" aria-expanded={open} aria-controls={open?popupId:undefined}
        onClick={reveal}><CalendarDays size={20}/></AppButton>
    </div>
    <span className="calendar-field-feedback" id={helpId} aria-live="polite">{fieldError}</span>
    {open&&<div id={popupId} role="dialog" aria-label="Escolher data" className="calendar-picker-popover calendar-date-popover">
      <div className="calendar-picker-top">
        <strong>{MONTHS[month]} {year}</strong>
        <div><AppButton type="button" aria-label="Mês anterior" onClick={()=>setCursor(new Date(year,month-1,1,12))}><ChevronLeft size={17}/></AppButton>
          <AppButton type="button" aria-label="Próximo mês" onClick={()=>setCursor(new Date(year,month+1,1,12))}><ChevronRight size={17}/></AppButton></div>
      </div>
      <div className="calendar-picker-week">{WEEKDAYS.map((d,i)=><span key={i}>{d}</span>)}</div>
      <div className="calendar-picker-days" onKeyDown={onGridKeyDown}>
        {calendarCells(year,month).map(cell=><AppButton key={cell.key} data-date-key={cell.key} type="button"
          aria-label={localDate(cell.key).toLocaleDateString("pt-BR",{day:"numeric",month:"long",year:"numeric"})}
          aria-pressed={value===cell.key}
          tabIndex={focused===cell.key?0:-1}
          className={(cell.current?"":"outside")+(value===cell.key?" selected":"")+(cell.key===todayKey()?" today":"")}
          onClick={()=>select(cell.key)}>{cell.day}</AppButton>)}
      </div>
      <div className="calendar-picker-footer"><AppButton type="button" onClick={()=>select(todayKey())}>Hoje</AppButton>
        <AppButton type="button" onClick={()=>{setOpen(false);trigger.current?.focus();}}>Fechar</AppButton></div>
    </div>}
  </div>;
}
export function CalendarTimeField({value,onChange,optional=false,label,showValidation=false}:{
  value:string;onChange:(value:string)=>void;optional?:boolean;label:string;showValidation?:boolean;
}){
  const [open,setOpen]=useState(false);
  const [touched,setTouched]=useState(false);
  const helpId=useId();
  const fieldError=(touched||showValidation)?timeInputError(value,optional):"";
  const root=useRef<HTMLDivElement>(null);
  const trigger=useRef<HTMLButtonElement>(null);
  const popupId=useId();
  useOutsideDismiss(root,open,()=>setOpen(false));
  const valid=/^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  const hour=valid?Number(value.slice(0,2)):9;
  const minute=valid?Number(value.slice(3,5)):0;
  function choose(nextHour:number,nextMinute:number){
    onChange(String(nextHour).padStart(2,"0")+":"+String(nextMinute).padStart(2,"0"));setTouched(true);
  }
  return <div className="calendar-picker" ref={root} onKeyDown={event=>{if(open&&event.key==="Escape"){event.preventDefault();event.stopPropagation();setOpen(false);trigger.current?.focus();}}}>
    <div className="calendar-picker-control">
      <AppInput type="text" inputMode="numeric" maxLength={5} autoComplete="off" value={value}
        aria-label={label} placeholder={optional?"Definir":"HH:mm"} invalid={!!fieldError}
        aria-describedby={fieldError?helpId:undefined}
        onChange={event=>onChange(maskTimeText(event.target.value))}
        onBlur={event=>{setTouched(true);const fixed=normalizeTimeText(event.target.value);if(fixed!==value)onChange(fixed);}}
        onKeyDown={event=>{if(event.key==="Escape"&&open){event.stopPropagation();setOpen(false);}}}/>
      {optional&&value&&<AppButton type="button" className="calendar-picker-clear" aria-label="Limpar horário de término" title="Limpar horário" onClick={()=>onChange("")}><X size={14}/></AppButton>}
      <AppButton ref={trigger} type="button" className="calendar-picker-toggle" aria-label={"Escolher "+label.toLowerCase()}
        aria-expanded={open} aria-controls={open?popupId:undefined}
        onClick={()=>setOpen(v=>!v)}><Clock3 size={20}/></AppButton>
    </div>
    <span className="calendar-field-feedback" id={helpId} aria-live="polite">{fieldError}</span>
    {open&&<div id={popupId} role="dialog" className="calendar-picker-popover calendar-time-popover" aria-label={"Selecionar "+label.toLowerCase()}>
      <div className="calendar-time-title"><Clock3 size={17}/><strong>Escolher horário</strong></div>
      <div className="calendar-time-columns">
        <div><span>Hora</span><div className="calendar-time-options" role="group" aria-label="Horas">{Array.from({length:24},(_,i)=><AppButton key={i} type="button"
          className={i===hour?"active":""} aria-pressed={i===hour} onClick={()=>choose(i,minute)}>{String(i).padStart(2,"0")}</AppButton>)}</div></div>
        <div><span>Minuto</span><div className="calendar-time-options" role="group" aria-label="Minutos">{Array.from({length:12},(_,i)=>i*5).map(i=><AppButton key={i} type="button"
          className={i===minute?"active":""} aria-pressed={i===minute} onClick={()=>choose(hour,i)}>{String(i).padStart(2,"0")}</AppButton>)}</div></div>
      </div>
      <p>Você também pode digitar um horário exato (HH:mm).</p>
      <div className="calendar-picker-footer">
        {optional?<AppButton type="button" onClick={()=>{onChange("");setOpen(false);}}>Limpar</AppButton>:<span/>}
        <AppButton type="button" className="calendar-time-done" onClick={()=>{if(!value)choose(hour,minute);setOpen(false);trigger.current?.focus();}}><Check size={15}/> Concluir</AppButton>
      </div>
    </div>}
  </div>;
}
