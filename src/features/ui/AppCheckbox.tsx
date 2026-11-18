import {Check} from 'lucide-react';
import {forwardRef,type InputHTMLAttributes,type ReactNode} from 'react';

/** Native, keyboard-accessible checkbox with the shared Roteiva selection skin.
 * Never replaces the input with a role="checkbox" imitation. */
export type AppCheckboxProps=Omit<InputHTMLAttributes<HTMLInputElement>,'type'|'children'> & {
  children:ReactNode;
};
export const AppCheckbox=forwardRef<HTMLInputElement,AppCheckboxProps>(function AppCheckbox({
  children,className="",...props
},ref){
  return <label className={["rt-checkbox",className].filter(Boolean).join(" ")}>
    <input {...props} ref={ref} type="checkbox" className="rt-checkbox__input"/>
    <span className="rt-checkbox__box" aria-hidden="true"><Check size={15} strokeWidth={3}/></span>
    <span className="rt-checkbox__label">{children}</span>
  </label>;
});
