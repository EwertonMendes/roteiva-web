import {forwardRef,useLayoutEffect,useRef,type HTMLAttributes,type ReactNode,type ComponentPropsWithoutRef} from "react";
import {X} from "lucide-react";
import {AppDialog} from "./AppDialog";
import {AppButton} from "./AppButton";

type ModalProps=Omit<ComponentPropsWithoutRef<typeof AppDialog>,"children"> & {
  size?:"compact"|"medium"|"wide"|"full";
  children:ReactNode;
};
/**
 * Reuses the visual contract of CalendarEventDialog from PROD without modifying
 * the calendar or shared date/time fields. All styles are scoped to this class.
 */
export const AppModal=forwardRef<HTMLDialogElement,ModalProps>(function AppModal({
  className="",size="medium",children,...props
},ref){
  const opener=useRef<HTMLElement|null>(null);
  useLayoutEffect(()=>{
    opener.current=document.activeElement instanceof HTMLElement?document.activeElement:null;
    return()=>{
      const target=opener.current;
      queueMicrotask(()=>{if(target?.isConnected&&!document.querySelector("dialog:modal"))target.focus({preventScroll:true});});
    };
  },[]);
  return <AppDialog {...props} ref={ref}
    className={["rt-modal","rt-parity-modal","rt-modal--"+size,className].filter(Boolean).join(" ")}>
    {children}
  </AppDialog>;
});

type HeaderProps={
  title:ReactNode;description?:ReactNode;eyebrow?:ReactNode;
  /** Semantic icon is required: parity with the PROD calendar's leading calendar icon. */
  icon:ReactNode;
  titleId?:string;descriptionId?:string;onClose:()=>void;
  closeDisabled?:boolean;closeLabel?:string;actions?:ReactNode;
};
export function AppModalHeader({title,description,icon,titleId,descriptionId,
  onClose,closeDisabled=false,closeLabel="Fechar",actions}:HeaderProps){
  return <header className="rt-modal__header">
    <span className="rt-modal__icon" aria-hidden="true">{icon}</span>
    <div className="rt-modal__heading">
      <h2 id={titleId}>{title}</h2>
      {description&&<p id={descriptionId}>{description}</p>}
    </div>
    {actions&&<div className="rt-modal__header-actions">{actions}</div>}
    <AppButton className="rt-modal__close" type="button"
      aria-label={closeLabel} title={closeLabel}
      disabled={closeDisabled} onClick={onClose}><X size={21} aria-hidden="true"/></AppButton>
  </header>;
}
export function AppModalBody({className="",children,...props}:HTMLAttributes<HTMLDivElement>){
  return <div {...props} className={["rt-modal__body",className].filter(Boolean).join(" ")}>{children}</div>;
}
export function AppModalFooter({className="",children,...props}:HTMLAttributes<HTMLElement>){
  return <footer {...props} className={["rt-modal__footer",className].filter(Boolean).join(" ")}>{children}</footer>;
}
export function AppModalSection({className="",heading,icon,children,...props}:HTMLAttributes<HTMLElement> & {heading?:ReactNode;icon?:ReactNode}){
  return <section {...props} className={["rt-modal__section",className].filter(Boolean).join(" ")}>
    {heading&&<h3 className="rt-modal__section-title">{icon&&<span aria-hidden="true">{icon}</span>}{heading}</h3>}
    {children}
  </section>;
}
