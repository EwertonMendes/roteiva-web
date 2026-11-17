import {forwardRef,type HTMLAttributes,type ReactNode,type ComponentPropsWithoutRef} from "react";
import {X} from "lucide-react";
import {AppDialog} from "./AppDialog";
import {AppButton} from "./AppButton";

type ModalProps=Omit<ComponentPropsWithoutRef<typeof AppDialog>,"children"> & {
  size?:"compact"|"medium"|"wide"|"full";
  children:ReactNode;
};
/** Accessible native dialog shell. Business components keep their own form logic.
 * One dialog owns focus, Escape, outside click and stacked top-layer behavior. */
export const AppModal=forwardRef<HTMLDialogElement,ModalProps>(function AppModal({
  className="",size="medium",children,...props
},ref){
  return <AppDialog {...props} ref={ref} className={["rt-modal","rt-modal--"+size,className].filter(Boolean).join(" ")}>
    {children}
  </AppDialog>;
});

type HeaderProps={
  title:ReactNode;description?:ReactNode;eyebrow?:ReactNode;icon?:ReactNode;
  titleId?:string;descriptionId?:string;onClose:()=>void;
  closeDisabled?:boolean;closeLabel?:string;actions?:ReactNode;
};
export function AppModalHeader({title,description,eyebrow,icon,titleId,descriptionId,
  onClose,closeDisabled=false,closeLabel="Fechar",actions}:HeaderProps){
  return <header className="rt-modal__header">
    {icon&&<span className="rt-modal__icon" aria-hidden="true">{icon}</span>}
    <div className="rt-modal__heading">
      {eyebrow&&<span className="rt-modal__eyebrow">{eyebrow}</span>}
      <h2 id={titleId}>{title}</h2>
      {description&&<p id={descriptionId}>{description}</p>}
    </div>
    {actions}
    <AppButton variant="secondary" controlSize="sm" type="button"
      className="rt-modal__close" aria-label={closeLabel} title={closeLabel}
      disabled={closeDisabled} onClick={onClose}><X size={20} aria-hidden="true"/></AppButton>
  </header>;
}
export function AppModalBody({className="",children,...props}:HTMLAttributes<HTMLDivElement>){
  return <div {...props} className={["rt-modal__body",className].filter(Boolean).join(" ")}>{children}</div>;
}
export function AppModalFooter({className="",children,...props}:HTMLAttributes<HTMLElement>){
  return <footer {...props} className={["rt-modal__footer",className].filter(Boolean).join(" ")}>{children}</footer>;
}
export function AppModalSection({className="",heading,children,...props}:HTMLAttributes<HTMLElement> & {heading?:ReactNode}){
  return <section {...props} className={["rt-modal__section",className].filter(Boolean).join(" ")}>
    {heading&&<h3 className="rt-modal__section-title">{heading}</h3>}
    {children}
  </section>;
}
