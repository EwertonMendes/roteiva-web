import {useState} from 'react';
import {CalendarDateField} from '../calendar/CalendarDateTimeField';
import {isValidCivilDate} from '../calendar/calendar-dates';
import {parseDateText} from '../calendar/calendar-input';

/** Shared form adapter for the branded Roteiva date picker.
 * It submits an ISO date and preserves the raw draft separately, so an invalid
 * or unfinished date cannot accidentally be interpreted as an empty field.
 */
export function AppDateFormField({
  name,label,initialValue='',maxYear=2099,optional=true,
}:{
  name:string;label:string;initialValue?:string;maxYear?:number;optional?:boolean;
}){
  const [value,setValue]=useState(()=>isValidCivilDate(initialValue)?initialValue:'');
  const [draft,setDraft]=useState(()=>{
    if(!isValidCivilDate(initialValue))return '';
    const [year,month,day]=initialValue.split('-');
    return day+'/'+month+'/'+year;
  });
  return <div className="rt-date-form-field">
    <span className="rt-date-form-label">{label}</span>
    <CalendarDateField label={label} value={value} onChange={setValue}
      onDraftChange={setDraft} maxYear={maxYear} optional={optional}/>
    <input type="hidden" name={name} value={value} readOnly/>
    <input type="hidden" name={name+'Draft'} value={draft} readOnly/>
  </div>;
}

/** Read the *visible* date and verify it matches the parsed ISO value.
 * Invalid drafts are never silently accepted as "no date". */
export function readFormDate(form:FormData,name:string,maxYear=2099):{valid:boolean;value:string}{
  const value=String(form.get(name)||'');
  const draft=String(form.get(name+'Draft')||'');
  if(!draft&&!value)return {valid:true,value:''};
  if(!isValidCivilDate(value)||Number(value.slice(0,4))>maxYear||parseDateText(draft)!==value)
    return {valid:false,value:''};
  return {valid:true,value};
}
