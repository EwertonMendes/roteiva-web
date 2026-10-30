import {useLayoutEffect,useRef,useState,type InputHTMLAttributes} from 'react';
import {
  formatMoneyDigits,moneyDigitsFromPaste,moneyDigitsFromValue,
  moneyValueFromDigits,normalizeMoneyDigits,
} from '../../lib/money-input';

type Props=Omit<InputHTMLAttributes<HTMLInputElement>,
  'type'|'inputMode'|'defaultValue'|'value'|'onChange'|'onPaste'|'min'|'max'|'step'|'pattern'> & {
  /** Optional initial amount in reais, not cents. Remount/key the form to reset it. */
  defaultValue?:number|null;
  /** Optional numeric callback; native form submission still uses the formatted string. */
  onValueChange?:(value:number|null)=>void;
};

/**
 * Accessible BRL input shared by all monetary forms.
 * Type 1,2,3 -> 0,01; 0,12; 1,23. Always stores digits as integer cents.
 * No locale-specific text is persisted in the domain model.
 */
export function MoneyInput({defaultValue,onValueChange,onKeyDown,onFocus,placeholder='0,00',...props}:Props){
  const [digits,setDigits]=useState(()=>moneyDigitsFromValue(defaultValue));
  const input=useRef<HTMLInputElement>(null);
  const displayed=formatMoneyDigits(digits);

  function commit(next:string|null){
    if(next===null || next===digits)return;
    setDigits(next);
    onValueChange?.(moneyValueFromDigits(next));
  }
  useLayoutEffect(()=>{
    const element=input.current;
    if(!element||document.activeElement!==element)return;
    const end=element.value.length;
    // After formatting, typing must continue from cents rather than changing the integer side.
    element.setSelectionRange(end,end);
  },[displayed]);

  return <div className="money-input">
    <span aria-hidden="true">R$</span>
    <input {...props} ref={input} type="text" inputMode="numeric"
      autoComplete="off" placeholder={placeholder} value={displayed}
      onFocus={event=>{event.currentTarget.select();onFocus?.(event);}}
      onKeyDown={event=>{
        onKeyDown?.(event);
        if(event.defaultPrevented||event.altKey||event.ctrlKey||event.metaKey)return;
        const input=event.currentTarget;
        const selected=input.selectionStart===0&&input.selectionEnd===input.value.length&&input.value.length>0;
        if(/^\d$/.test(event.key)){
          event.preventDefault();
          commit(normalizeMoneyDigits((selected?'':digits)+event.key));
        }else if(event.key==='Backspace'||event.key==='Delete'){
          event.preventDefault();
          commit(selected?'':digits.slice(0,-1));
        }
      }}
      onChange={event=>{
        // Mobile virtual keyboards often bypass keydown. Detect deletion via
        // InputEvent so repeated backspaces can clear the final zero.
        const kind=(event.nativeEvent as InputEvent).inputType||'';
        if(kind.startsWith('delete')){
          commit(event.currentTarget.value===''?'':digits.slice(0,-1));
          return;
        }
        commit(normalizeMoneyDigits(event.currentTarget.value));
      }}
      onPaste={event=>{
        event.preventDefault();
        commit(moneyDigitsFromPaste(event.clipboardData.getData('text')));
      }}
    />
  </div>;
}
