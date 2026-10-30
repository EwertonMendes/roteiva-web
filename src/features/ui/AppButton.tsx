import {forwardRef,type ButtonHTMLAttributes} from "react";
export type AppButtonProps=ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?:"primary"|"secondary"|"ghost"|"danger";
  controlSize?:"sm"|"md"|"lg";
  loading?:boolean;
};
/** Native button semantics; opt-in variants support gradual migration of legacy styles. */
export const AppButton=forwardRef<HTMLButtonElement,AppButtonProps>(function AppButton({
  variant,controlSize,loading=false,disabled=false,className="",children,...props
},ref){
  return <button {...props} ref={ref}
    className={[variant?"rt-button rt-button--"+variant:"",className].filter(Boolean).join(" ")}
    data-control-size={controlSize} aria-busy={loading||undefined} disabled={disabled||loading}>
    {children}
  </button>;
});
