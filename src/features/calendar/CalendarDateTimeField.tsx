import {useEffect,useId,useLayoutEffect,useRef,useState,type KeyboardEvent} from "react";
import {CalendarDays,ChevronLeft,ChevronRight,Check,Clock3,X} from "lucide-react";
import {AppButton} from "../ui/AppButton";
import {AppInput} from "../ui/AppInput";
import {calendarCells,dateKey,isValidCivilDate,localDate,todayKey} from "./calendar-dates";
import {dateInputError,maskDateText,maskTimeText,normalizeTimeText,parseDateText,timeInputError} from "./calendar-input";

const MONTHS=["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
const WEEKDAYS=["D","S","T","Q","Q","S","S"];

/** Native popovers live in the browser top layer, above clipped cards
 * and scrolling modals, while keeping the same Roteiva visual component. */
function useCalendarPopover(root:React.RefObject<HTMLDivElement|null>,popup:React.RefObject<HTMLDivElement|null>,open:boolean,close:()=>void){
  const dismiss=useRef(close);
  dismiss.current=close;
  useLayoutEffect(()=>{
    const anchor=root.current,layer=popup.current;
    if(!open||!anchor||!layer)return;
    if(!layer.matches(':popover-open'))layer.showPopover();
    // Measure the natural calendar height. Limiting it to the space immediately
    // below the input introduced a scrollbar even on roomy desktop screens.
    // Keep the whole popup visible by flipping or shifting it within the viewport.
    const position=()=>{
      if(!layer.matches(':popover-open'))return;
      const bounds=anchor.getBoundingClientRect();
      const viewport=window.visualViewport;
      const leftEdge=viewport?.offsetLeft??0;
      const topEdge=viewport?.offsetTop??0;
      const rightEdge=leftEdge+(viewport?.width??window.innerWidth);
      const bottomEdge=topEdge+(viewport?.height??window.innerHeight);
      const margin=8;
      const maxAvailable=Math.max(100,bottomEdge-topEdge-margin*2);
      const naturalHeight=Math.ceil(layer.scrollHeight+layer.clientTop*2);
      const needsScroll=naturalHeight>maxAvailable;
      const height=Math.min(naturalHeight,maxAvailable);
      // Only genuinely short viewports should scroll inside the popup.
      layer.style.maxHeight=needsScroll?maxAvailable+'px':'none';
      layer.style.overflowY=needsScroll?'auto':'visible';
      const width=layer.getBoundingClientRect().width||286;
      const spaceBelow=bottomEdge-bounds.bottom-margin;
      const spaceAbove=bounds.top-topEdge-margin;
      let top=bounds.bottom+margin;
      if(spaceBelow<height&&spaceAbove>=height)top=bounds.top-height-margin;
      else if(spaceBelow<height)top=Math.max(topEdge+margin,Math.min(top,bottomEdge-height-margin));
      layer.style.top=Math.max(topEdge+margin,Math.min(top,bottomEdge-height-margin))+'px';
      layer.style.left=Math.max(leftEdge+margin,Math.min(bounds.left,rightEdge-width-margin))+'px';
    };
    position();
    const resizeObserver=typeof ResizeObserver==='undefined'?null:new ResizeObserver(position);
    resizeObserver?.observe(layer);
    const outside=(event:globalThis.PointerEvent)=>{
      if(event.target instanceof Node&&!anchor.contains(event.target)&&!layer.contains(event.target))dismiss.current();
    };
    const escape=(event:globalThis.KeyboardEvent)=>{
      if(event.key!=='Escape')return;
      event.preventDefault();event.stopPropagation();dismiss.current();
      (anchor.querySelector('.calendar-picker-toggle') as HTMLButtonElement|null)?.focus();
    };
    document.addEventListener('pointerdown',outside);
    document.addEventListener('keydown',escape,true);
    window.addEventListener('resize',position);
    window.addEventListener('scroll',position,true);
    window.visualViewport?.addEventListener('resize',position);
    window.visualViewport?.addEventListener('scroll',position);
    return ()=>{
      resizeObserver?.disconnect();
      document.removeEventListener('pointerdown',outside);
      document.removeEventListener('keydown',escape,true);
      window.removeEventListener('resize',position);
      window.removeEventListener('scroll',position,true);
      window.visualViewport?.removeEventListener('resize',position);
      window.visualViewport?.removeEventListener('scroll',position);
      if(layer.matches(':popover-open'))layer.hidePopover();
    };
  },[open,root,popup]);
}
function displayDate(iso:string){
  if(!isValidCivilDate(iso))return "";
  const [year,month,day]=iso.split("-");
  return day+"/"+month+"/"+year;
}
export function CalendarDateField({value,onChange,showValidation=false,optional=false,label="Data do compromisso",onDraftChange,maxYear=2199}:{
  value:string;onChange:(value:string)=>void;showValidation?:boolean;optional?:boolean;
  label?:string;onDraftChange?:(draft:string)=>void;maxYear?:number;
}){
  const [draft,setDraft]=useState(()=>displayDate(value));
  const [touched,setTouched]=useState(false);
  const helpId=useId();
  const fieldError=(touched||showValidation)
    ?(optional&&!draft?"":dateInputError(draft)||(
      Number(draft.slice(-4))>maxYear?`O ano deve ser até ${maxYear}.`:""))
    :"";
  const [open,setOpen]=useState(false);
  const [cursor,setCursor]=useState(()=>localDate(isValidCivilDate(value)?value:todayKey()));
  const root=useRef<HTMLDivElement>(null);
  const input=useRef<HTMLInputElement>(null);
  const trigger=useRef<HTMLButtonElement>(null);
  const popupId=useId();
  const popup=useRef<HTMLDivElement>(null);
  useCalendarPopover(root,popup,open,()=>setOpen(false));
  // A partial date keeps its text while the parent receives an invalid (empty) value.
  useEffect(()=>{if(value&&isValidCivilDate(value))setDraft(displayDate(value));},[value]);

  const year=cursor.getFullYear(),month=cursor.getMonth();
  const selected=isValidCivilDate(value)?value:todayKey();
  const [focused,setFocused]=useState(selected);
  function select(key:string){
    if(Number(key.slice(0,4))>maxYear)return;
    const displayed=displayDate(key);
    setDraft(displayed);onChange(key);onDraftChange?.(displayed);
    setTouched(true);setFocused(key);setOpen(false);trigger.current?.focus();
  }
  function reveal(){
    if(open)return;
    const origin=isValidCivilDate(value)?localDate(value):localDate(todayKey());
    setCursor(new Date(origin.getFullYear(),origin.getMonth(),1,12));
    setFocused(dateKey(origin.getFullYear(),origin.getMonth(),origin.getDate()));
    setOpen(true);
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
    <div className="calendar-picker-control" onClick={()=>{input.current?.focus();reveal();}}>
      <AppInput type="text" ref={input} aria-label={label} inputMode="numeric" autoComplete="off"
        placeholder="dd/mm/aaaa" maxLength={10} value={draft} invalid={!!fieldError}
        aria-describedby={fieldError?helpId:undefined}
        onChange={event=>{
          const next=maskDateText(event.target.value);
          setDraft(next);onDraftChange?.(next);
          const parsed=parseDateText(next);
          onChange(parsed&&Number(parsed.slice(0,4))<=maxYear?parsed:"");
        }}
        onBlur={()=>setTouched(true)}
        onKeyDown={event=>{if(event.key==="Escape"&&open){event.stopPropagation();setOpen(false);}}}/>
      <AppButton ref={trigger} type="button" className="calendar-picker-toggle"
        aria-label="Abrir calendário de data" aria-expanded={open} aria-controls={open?popupId:undefined}
        onClick={event=>{event.stopPropagation();input.current?.focus();if(open)setOpen(false);else reveal();}}><CalendarDays size={20}/></AppButton>
    </div>
    <span className="calendar-field-feedback" id={helpId} aria-live="polite">{fieldError}</span>
    {open&&<div id={popupId} ref={popup} popover="manual" role="dialog" aria-label="Escolher data" className="calendar-picker-popover calendar-date-popover">
      <div className="calendar-picker-top">
        <strong>{MONTHS[month]} {year}</strong>
        <div><AppButton type="button" aria-label="Mês anterior" onClick={()=>setCursor(new Date(year,month-1,1,12))}><ChevronLeft size={17}/></AppButton>
          <AppButton type="button" aria-label="Próximo mês" onClick={()=>setCursor(new Date(year,month+1,1,12))}><ChevronRight size={17}/></AppButton></div>
      </div>
      <div className="calendar-picker-week">{WEEKDAYS.map((d,i)=><span key={i}>{d}</span>)}</div>
      <div className="calendar-picker-days" onKeyDown={onGridKeyDown}>
        {calendarCells(year,month).map(cell=><AppButton key={cell.key} data-date-key={cell.key} type="button"
          aria-label={localDate(cell.key).toLocaleDateString("pt-BR",{day:"numeric",month:"long",year:"numeric"})}
          disabled={Number(cell.key.slice(0,4))>maxYear}
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
export function CalendarTimeField({value,onChange,optional=false,label,showValidation=false,rangeError=""}:{
  value:string;onChange:(value:string)=>void;optional?:boolean;label:string;showValidation?:boolean;rangeError?:string;
}){
  const [open,setOpen]=useState(false);
  const [touched,setTouched]=useState(false);
  const helpId=useId();
  const fieldError=(touched||showValidation)?(timeInputError(value,optional)||rangeError):"";
  const root=useRef<HTMLDivElement>(null);
  const input=useRef<HTMLInputElement>(null);
  const trigger=useRef<HTMLButtonElement>(null);
  const popupId=useId();
  const popup=useRef<HTMLDivElement>(null);
  useCalendarPopover(root,popup,open,()=>setOpen(false));

  const valid=/^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  const hour=valid?Number(value.slice(0,2)):9;
  const minute=valid?Number(value.slice(3,5)):0;
  function choose(nextHour:number,nextMinute:number){
    onChange(String(nextHour).padStart(2,"0")+":"+String(nextMinute).padStart(2,"0"));setTouched(true);
  }
  return <div className="calendar-picker" ref={root} onKeyDown={event=>{if(open&&event.key==="Escape"){event.preventDefault();event.stopPropagation();setOpen(false);trigger.current?.focus();}}}>
    <div className="calendar-picker-control" onClick={()=>{input.current?.focus();setOpen(true);}}>
      <AppInput type="text" ref={input} inputMode="numeric" maxLength={5} autoComplete="off" value={value}
        aria-label={label} placeholder={optional?"Definir":"HH:mm"} invalid={!!fieldError}
        aria-describedby={fieldError?helpId:undefined}
        onChange={event=>onChange(maskTimeText(event.target.value))}
        onBlur={event=>{setTouched(true);const fixed=normalizeTimeText(event.target.value);if(fixed!==value)onChange(fixed);}}
        onKeyDown={event=>{if(event.key==="Escape"&&open){event.stopPropagation();setOpen(false);}}}/>
      {optional&&value&&<AppButton type="button" className="calendar-picker-clear" aria-label="Limpar horário de término" title="Limpar horário" onClick={event=>{event.stopPropagation();onChange("");input.current?.focus();}}><X size={14}/></AppButton>}
      <AppButton ref={trigger} type="button" className="calendar-picker-toggle" aria-label={"Escolher "+label.toLowerCase()}
        aria-expanded={open} aria-controls={open?popupId:undefined}
        onClick={event=>{event.stopPropagation();input.current?.focus();setOpen(v=>!v);}}><Clock3 size={20}/></AppButton>
    </div>
    <span className="calendar-field-feedback" id={helpId} aria-live="polite">{fieldError}</span>
    {open&&<div id={popupId} ref={popup} popover="manual" role="dialog" className="calendar-picker-popover calendar-time-popover" aria-label={"Selecionar "+label.toLowerCase()}>
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

/** Month-only variant of the shared calendar control for recurring client work. */
export function CalendarMonthField({value,onChange,label="Mês do pacote"}:{
 value:string;onChange:(value:string)=>void;label?:string;
}){
 const date=new Date();
 const initialYear=/^(19|20)\d{2}-(0[1-9]|1[0-2])$/.test(value)?Number(value.slice(0,4)):date.getFullYear();
 const [cursorYear,setCursorYear]=useState(initialYear),[open,setOpen]=useState(false);
 const root=useRef<HTMLDivElement>(null),popup=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null),input=useRef<HTMLInputElement>(null);
 const id=useId();
 useCalendarPopover(root,popup,open,()=>setOpen(false));
 const month=Number(value.slice(5,7));
 const display=month>=1&&month<=12?MONTHS[month-1]+' de '+value.slice(0,4):'Selecione um mês';
 function selectMonth(year:number,monthIndex:number){
  onChange(String(year)+'-'+String(monthIndex+1).padStart(2,'0'));
  setOpen(false);trigger.current?.focus();
 }
 return <div className="calendar-picker calendar-month-picker" ref={root}>
  <div className="calendar-picker-control" onClick={()=>{input.current?.focus();setOpen(true);}}>
   <AppInput ref={input} type="text" aria-label={label} readOnly value={display} aria-haspopup="dialog"
    onClick={()=>setOpen(true)}
    onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();setOpen(true);}}}/>
   <AppButton ref={trigger} type="button" className="calendar-picker-toggle"
    aria-label="Escolher mês do pacote" aria-expanded={open} aria-controls={open?id:undefined}
    onClick={event=>{event.stopPropagation();input.current?.focus();setOpen(current=>!current);}}><CalendarDays size={20}/></AppButton>
  </div>
  {open&&<div ref={popup} id={id} popover="manual" role="dialog" aria-label="Escolher mês"
    className="calendar-picker-popover calendar-month-popover">
   <div className="calendar-picker-top"><strong>{cursorYear}</strong>
    <div><AppButton type="button" aria-label="Ano anterior" disabled={cursorYear<=1900}
      onClick={()=>setCursorYear(y=>Math.max(1900,y-1))}><ChevronLeft size={17}/></AppButton>
     <AppButton type="button" aria-label="Próximo ano" disabled={cursorYear>=2099}
      onClick={()=>setCursorYear(y=>Math.min(2099,y+1))}><ChevronRight size={17}/></AppButton></div>
   </div>
   <div className="calendar-month-options">
    {MONTHS.map((name,index)=><AppButton type="button" key={name}
      aria-pressed={cursorYear===Number(value.slice(0,4))&&index+1===month}
      className={cursorYear===Number(value.slice(0,4))&&index+1===month?'selected':''}
      onClick={()=>selectMonth(cursorYear,index)}>{name}</AppButton>)}
   </div>
   <div className="calendar-picker-footer">
    <AppButton type="button" onClick={()=>selectMonth(date.getFullYear(),date.getMonth())}>Este mês</AppButton>
    <AppButton type="button" onClick={()=>{setOpen(false);trigger.current?.focus();}}>Fechar</AppButton>
   </div>
  </div>}
 </div>;
}
