import {useEffect,useRef,forwardRef,type DialogHTMLAttributes,type ReactNode} from "react";
type Props=Omit<DialogHTMLAttributes<HTMLDialogElement>,"open"> & {
  onCloseRequest:()=>void;
  children:ReactNode;
};
/**
 * Native top-layer dialog: built-in focus trap, Escape behavior and accessibility.
 * Never reinvents the browser's modal management.
 */
export const AppDialog=forwardRef<HTMLDialogElement,Props>(function AppDialog({
  onCloseRequest,onCancel,onClick,children,...props
},ref){
  const localRef=useRef<HTMLDialogElement>(null);
  useEffect(()=>{
    const element=localRef.current;
    if(!element)return;
    if(!element.open)element.showModal();
    // Native dialog already traps focus; only lock background scrolling.
    const previous=document.body.style.overflow;
    document.body.style.overflow="hidden";
    return()=>{document.body.style.overflow=previous;if(element.open)element.close();};
  },[]);
  return <dialog {...props} ref={element=>{
    localRef.current=element;
    if(typeof ref==="function")ref(element);
    else if(ref)ref.current=element;
  }} onCancel={event=>{onCancel?.(event);event.preventDefault();onCloseRequest();}}
    onClick={event=>{onClick?.(event);if(!event.defaultPrevented&&event.target===event.currentTarget)onCloseRequest();}}>
    {children}
  </dialog>;
});
