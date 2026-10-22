import {useEffect,useRef,type RefObject} from "react";

/** Wheel events over the entire viewer (including overlaid toolbar) always belong
 * to image zoom, not to any scrollable ancestor or browser page zoom. React's
 * synthetic onWheel cannot reliably cancel root passive wheel listeners.
 * Native capture + passive:false must be installed on the actual DOM element.
 */
export function useImageWheelZoom(
  target:RefObject<HTMLElement|null>,onZoom:(event:WheelEvent)=>void,enabled=true
){
  const callback=useRef(onZoom);
  callback.current=onZoom;
  useEffect(()=>{
    const node=target.current;
    if(!node||!enabled)return;
    const handler=(event:WheelEvent)=>{
      if(!event.cancelable)return;
      event.preventDefault();
      event.stopPropagation();
      callback.current(event);
    };
    node.addEventListener("wheel",handler,{passive:false,capture:true});
    return()=>node.removeEventListener("wheel",handler,true);
  },[target,enabled]);
}
