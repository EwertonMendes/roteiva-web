import {forwardRef,type TextareaHTMLAttributes} from "react";
export type AppTextareaProps=TextareaHTMLAttributes<HTMLTextAreaElement> & {
  invalid?:boolean;
  controlSize?:"sm"|"md"|"lg";
};
/** Shared semantic textarea; native refs, events and FormData are preserved. */
export const AppTextarea=forwardRef<HTMLTextAreaElement,AppTextareaProps>(function AppTextarea({
  invalid,controlSize="md",className="",...props
},ref){
  return <textarea {...props} ref={ref}
    className={["rt-textarea",className].filter(Boolean).join(" ")}
    data-control-size={controlSize} aria-invalid={invalid||props["aria-invalid"]||undefined}/>;
});
