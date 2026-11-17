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
    const opener=document.activeElement instanceof HTMLElement?document.activeElement:null;
    if(!element.open)element.showModal();
    // Focus restoration must work after React unmount, including Escape and
    // stacked native dialogs. Do not steal focus from a different active layer.
    return()=>{
      if(element.open)element.close();
      const activeDialog=document.querySelector<HTMLDialogElement>("dialog:modal");
      if(opener?.isConnected && (!activeDialog||activeDialog.contains(opener))){
        opener.focus({preventScroll:true});
      }
    };
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
