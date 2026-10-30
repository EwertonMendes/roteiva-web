import {forwardRef, type InputHTMLAttributes, type ReactNode} from "react";

/**
 * Canonical input primitive. Keep the browser's native semantics, name,
 * validation, FormData serialization, and controlled/uncontrolled behavior.
 * Domain-specific masks (phone, BRL) compose this component instead of
 * reimplementing its accessibility and visual states.
 */
export type AppInputProps=InputHTMLAttributes<HTMLInputElement> & {
  invalid?:boolean;
  controlSize?:"sm"|"md"|"lg";
  leading?:ReactNode;
  trailing?:ReactNode;
};
export const AppInput=forwardRef<HTMLInputElement,AppInputProps>(function AppInput({
  invalid,controlSize="md",leading,trailing,className="",...props
},ref){
  const field=<input {...props} ref={ref}
    className={["rt-input",className].filter(Boolean).join(" ")}
    data-control-size={controlSize} aria-invalid={invalid||props["aria-invalid"]||undefined}/>;
  if(leading==null&&trailing==null)return field;
  return <span className="rt-input-frame" data-control-size={controlSize} data-disabled={props.disabled||undefined} data-invalid={invalid||undefined}>
    {leading!=null&&<span className="rt-input-adornment" aria-hidden="true">{leading}</span>}
    {field}
    {trailing!=null&&<span className="rt-input-adornment" aria-hidden="true">{trailing}</span>}
  </span>;
});
