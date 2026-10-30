import {useEffect,useRef,type RefObject} from "react";

/** One safe outside-click / Escape contract for menus and nonmodal popovers. */
export function useDismissibleLayer(
  open:boolean,
  elements:ReadonlyArray<RefObject<HTMLElement|null>>,
  onDismiss:()=>void,
  options:{escape?:boolean;restoreFocus?:RefObject<HTMLElement|null>}={},
){
  const latest=useRef(onDismiss);
  latest.current=onDismiss;
  const refs=useRef(elements);
  refs.current=elements;
  const restore=useRef(options.restoreFocus);
  restore.current=options.restoreFocus;
  const escape=options.escape!==false;
  useEffect(()=>{
    if(!open)return;
    const outside=(event:PointerEvent)=>{
      if(!(event.target instanceof Node))return;
      if(refs.current.some(ref=>ref.current?.contains(event.target as Node)))return;
      latest.current();
    };
    const key=(event:KeyboardEvent)=>{
      if(!escape||event.key!=="Escape")return;
      event.preventDefault();
      latest.current();
      restore.current?.current?.focus();
    };
    document.addEventListener("pointerdown",outside);
    document.addEventListener("keydown",key);
    return()=>{
      document.removeEventListener("pointerdown",outside);
      document.removeEventListener("keydown",key);
    };
  },[open,escape]);
}
