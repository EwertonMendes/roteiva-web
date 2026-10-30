import {useId,type ReactNode} from "react";
type Props={
  label:string; children:(id:string)=>ReactNode; id?:string;
  hint?:string; error?:string; required?:boolean; className?:string;
};
/**
 * Label, hint and error ownership remains consistent for every field.
 * Render prop allows native inputs, a masked Input, or a custom AppSelect.
 */
export function AppField({label,children,id,hint,error,required,className=""}:Props){
  const generated=useId(),fieldId=id??"rt-field-"+generated;
  return <div className={["rt-form-field",className].filter(Boolean).join(" ")}
    data-invalid={!!error||undefined}>
    <label htmlFor={fieldId} className="rt-field-label">{label}{required&&<span aria-hidden="true"> *</span>}</label>
    {children(fieldId)}
    {hint&&<small className="rt-field-hint">{hint}</small>}
    {error&&<small className="rt-field-error" role="alert">{error}</small>}
  </div>;
}
