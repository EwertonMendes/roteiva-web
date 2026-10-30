import {useCallback,useLayoutEffect,useRef,useState,type ReactNode} from "react";
import {createPortal} from "react-dom";
import {AppButton} from "./AppButton";
import {useDismissibleLayer} from "./useDismissibleLayer";

export type AppDropdownItem={
  label:string;
  onSelect:()=>void;
  disabled?:boolean;
  icon?:ReactNode;
};
type Props={
  label:string;
  items:readonly AppDropdownItem[];
  icon:ReactNode;
  disabled?:boolean;
  className?:string;
  menuClassName?:string;
};
/** Shared accessible, anchored action menu, never clipped by scrolling panels. */
export function AppDropdownMenu({
  label,items,icon,disabled=false,className="",menuClassName=""
}:Props){
  const [open,setOpen]=useState(false);
  const [position,setPosition]=useState<{top:number;left:number}|null>(null);
  const trigger=useRef<HTMLButtonElement>(null);
  const panel=useRef<HTMLDivElement>(null);
  const update=useCallback(()=>{
    const button=trigger.current,menu=panel.current;
    if(!button)return;
    const rect=button.getBoundingClientRect();
    const width=menu?.offsetWidth||190,height=menu?.offsetHeight||95,edge=8,gap=5;
    const below=window.innerHeight-rect.bottom>=height+edge;
    setPosition({top:below?rect.bottom+gap:Math.max(edge,rect.top-height-gap),
      left:Math.max(edge,Math.min(rect.right-width,window.innerWidth-width-edge))});
  },[]);
  useLayoutEffect(()=>{
    if(!open)return;
    update();
    window.addEventListener("resize",update);
    window.addEventListener("scroll",update,true);
    window.visualViewport?.addEventListener("resize",update);
    const raf=requestAnimationFrame(()=>{
      update();panel.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
    });
    return()=>{
      cancelAnimationFrame(raf);
      window.removeEventListener("resize",update);
      window.removeEventListener("scroll",update,true);
      window.visualViewport?.removeEventListener("resize",update);
    };
  },[open,update]);
  useDismissibleLayer(open,[trigger,panel],()=>setOpen(false),{restoreFocus:trigger});
  const close=()=>{setOpen(false);trigger.current?.focus();};
  const select=(action:()=>void)=>{close();action();};
  return <>
    <AppButton type="button" ref={trigger} className={className} aria-label={label}
      aria-haspopup="menu" aria-expanded={open} disabled={disabled}
      onClick={()=>setOpen(value=>!value)}>{icon}</AppButton>
    {open&&createPortal(<div ref={panel} role="menu" aria-label={label}
      className={menuClassName} style={position??{top:0,left:0,visibility:"hidden"}}
      onKeyDown={event=>{
        if(event.key==="Tab"){setOpen(false);return;}
        if(!["ArrowDown","ArrowUp","Home","End"].includes(event.key))return;
        const available=[...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')];
        if(!available.length)return;
        event.preventDefault();
        const at=available.indexOf(document.activeElement as HTMLButtonElement);
        const next=event.key==="Home"?0:event.key==="End"?available.length-1:
          (at+(event.key==="ArrowDown"?1:-1)+available.length)%available.length;
        available[next]?.focus();
      }}>
      {items.map((item,index)=><AppButton key={index} role="menuitem" type="button"
        disabled={item.disabled} onClick={()=>select(item.onSelect)}>
        {item.icon}{item.label}
      </AppButton>)}
    </div>,document.body)}
  </>;
}
