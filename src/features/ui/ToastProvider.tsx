import {createContext,useCallback,useContext,useEffect,useRef,useState,type ReactNode} from "react";
import {createPortal} from "react-dom";
import {AlertCircle,CheckCircle2,Info,TriangleAlert,X} from "lucide-react";
import {AppButton} from "./AppButton";

export type ToastTone="success"|"error"|"warning"|"info";
export type ToastNotify=(message:string,tone?:ToastTone)=>void;
type Toast={id:number;message:string;tone:ToastTone};
const ToastContext=createContext<ToastNotify|null>(null);
const durations:Record<ToastTone,number>={success:3500,error:6500,warning:5500,info:4200};
const symbols={success:CheckCircle2,error:AlertCircle,warning:TriangleAlert,info:Info};

/**
 * One global notification slot: new messages replace the previous message and
 * equal consecutive messages are deduplicated. Timers belong to this provider,
 * never to individual pages. The portal follows the topmost native dialog,
 * which otherwise obscures fixed notifications behind its top-layer backdrop.
 */
export function ToastProvider({children}:{children:ReactNode}){
  const [current,setCurrent]=useState<Toast|null>(null);
  const sequence=useRef(0);
  const [portalTarget,setPortalTarget]=useState<HTMLElement|null>(null);
  const notify=useCallback<ToastNotify>((message,tone="info")=>{
    const clean=message.trim();
    if(!clean)return;
    setCurrent(previous=>previous?.message===clean&&previous.tone===tone
      ?previous:{id:++sequence.current,message:clean,tone});
  },[]);
  useEffect(()=>{
    const update=()=>{
      // Native dialogs live in the browser top layer. Render inside the last
      // modal so the notification remains visible even over a preserved day dialog.
      const top=Array.from(document.querySelectorAll<HTMLDialogElement>("dialog:modal")).at(-1);
      setPortalTarget(top??document.body);
    };
    const observer=new MutationObserver(update);
    observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:["open"]});
    update();
    return()=>observer.disconnect();
  },[]);
  useEffect(()=>{
    if(!current)return;
    const timer=window.setTimeout(()=>setCurrent(previous=>previous?.id===current.id?null:previous),durations[current.tone]);
    return()=>window.clearTimeout(timer);
  },[current]);
  const Icon=current?symbols[current.tone]:Info;
  return <ToastContext.Provider value={notify}>
    {children}
    {current&&portalTarget&&createPortal(
      <div key={current.id} className={"toast rt-toast rt-toast--"+current.tone}
        role={current.tone==="error"?"alert":"status"}
        aria-live={current.tone==="error"?"assertive":"polite"} aria-atomic="true">
        <Icon className="rt-toast-icon" size={20} aria-hidden="true"/>
        <span className="rt-toast-message">{current.message}</span>
        <AppButton className="rt-toast-close" type="button" aria-label="Dispensar notificação"
          onClick={()=>setCurrent(null)}><X size={17}/></AppButton>
      </div>,portalTarget)}
  </ToastContext.Provider>;
}

export function useToast():ToastNotify{
  const context=useContext(ToastContext);
  if(!context)throw new Error("useToast precisa estar dentro de ToastProvider.");
  return context;
}
