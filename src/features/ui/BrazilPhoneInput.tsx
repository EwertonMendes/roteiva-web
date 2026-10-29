import {useLayoutEffect,useRef,useState,type InputHTMLAttributes} from 'react';
import {formatPhoneInput,phoneDigits} from '../../lib/brazil-phone';

type Props=Omit<InputHTMLAttributes<HTMLInputElement>,'type'|'value'|'defaultValue'|'onChange'> & {
 defaultValue?:string;
};
/** Reusable phone input: keyboard, paste, +55, caret-aware DDD formatting. */
export function BrazilPhoneInput({defaultValue='',...props}:Props){
 const [value,setValue]=useState(()=>formatPhoneInput(defaultValue));
 const ref=useRef<HTMLInputElement>(null);
 const caret=useRef<number|null>(null);
 useLayoutEffect(()=>{
  if(caret.current===null||!ref.current)return;
  const wanted=caret.current;caret.current=null;
  if(document.activeElement!==ref.current)return;
  let seen=0,position=value.length;
  for(let i=0;i<value.length;i++){
   if(/\d/.test(value[i]))seen++;
   if(seen>=wanted){position=i+1;break;}
  }
  if(wanted===0)position=0;
  ref.current.setSelectionRange(position,position);
 },[value]);
 return <input {...props} ref={ref} type="tel" inputMode="numeric" autoComplete="tel-national"
   value={value} maxLength={16}
   pattern="\\(\\d{2}\\) \\d{4,5}-\\d{4}"
   title="Informe o DDD e o número, com 10 ou 11 dígitos."
   onChange={event=>{
    const selection=event.currentTarget.selectionStart??event.currentTarget.value.length;
    caret.current=phoneDigits(event.currentTarget.value.slice(0,selection)).length;
    setValue(formatPhoneInput(event.currentTarget.value));
   }}/>;
}
