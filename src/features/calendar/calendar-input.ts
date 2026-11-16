import {isValidCivilDate} from "./calendar-dates.ts";
import {timeMinutes} from "../../studio-calendar.ts";

/** Keep drafts editable. Validate the completed value, not each keystroke. */
export function maskDateText(raw:string):string {
  const digits=raw.replace(/\D/g,"").slice(0,8);
  return [digits.slice(0,2),digits.slice(2,4),digits.slice(4,8)].filter(Boolean).join("/");
}

export function parseDateText(value:string):string {
  const parts=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if(!parts)return "";
  const iso=parts[3]+"-"+parts[2]+"-"+parts[1];
  return isValidCivilDate(iso)?iso:"";
}

export function dateInputError(draft:string):string {
  if(!draft || draft.length!==10)return "Informe a data no formato DD/MM/AAAA.";
  if(parseDateText(draft))return "";
  return "Data inválida. Verifique dia, mês e ano.";
}

/** Restrict to four time digits, inserting HH:mm as soon as minutes are typed.
 * Preserve explicit colon input (9:30 -> 09:30) for desktop keyboard users. */
export function maskTimeText(raw:string):string {
  const text=raw.replace(/[^\d:]/g,"");
  if(text.includes(":")){
    const [hours,minutes=""]=text.split(":");
    if(!hours)return "";
    const left=hours.slice(0,2);
    const right=minutes.slice(0,2);
    return (left.length===1&&right?"0"+left:left)+":"+right;
  }
  const digits=text.slice(0,4);
  if(digits.length===3 && /^[3-9]/.test(digits))return "0"+digits[0]+":"+digits.slice(1);
  return digits.length<=2?digits:digits.slice(0,2)+":"+digits.slice(2);
}

export function normalizeTimeText(value:string):string {
  const text=maskTimeText(value);
  if(!text)return "";
  const [hours,minutes]=text.split(":");
  if(!/^\d{1,2}$/.test(hours)|| (minutes!==undefined&&!/^\d{0,2}$/.test(minutes)))return text;
  const hour=Number(hours),minute=minutes===undefined?0:Number(minutes);
  if(hour>23||minute>59|| (minutes!==undefined&&minutes===""))return text;
  return String(hour).padStart(2,"0")+":"+String(minute).padStart(2,"0");
}

export function timeInputError(value:string,optional=false):string {
  if(optional&&!value)return "";
  if(!value)return "Informe o horário de início.";
  if(Number.isFinite(timeMinutes(value)))return "";
  return "Horário inválido. Use HH:mm (00:00 a 23:59).";
}
