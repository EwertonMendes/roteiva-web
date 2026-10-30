import {AppButton} from "../ui/AppButton";
import {useCallback,useLayoutEffect,useRef,useState} from "react";
import {createPortal} from "react-dom";
import {MoreHorizontal} from "lucide-react";
import {useDismissibleLayer} from "../ui/useDismissibleLayer";

type Props={
 name:string;
 onOpen:()=>void;
 onUnlink:()=>void;
 disabled?:boolean;
};

/** Shared accessible portal menu; intentionally escapes the scrollable folder pane.
 * Uses actual viewport geometry rather than nth-child CSS positioning guesses. */
export function FolderActionsMenu({name,onOpen,onUnlink,disabled=false}:Props){
 const [open,setOpen]=useState(false);
 const [position,setPosition]=useState<{top:number;left:number}|null>(null);
 const trigger=useRef<HTMLButtonElement>(null);
 const panel=useRef<HTMLDivElement>(null);
 const update=useCallback(()=>{
  const button=trigger.current,menu=panel.current;
  if(!button)return;
  const rect=button.getBoundingClientRect();
  const width=menu?.offsetWidth||190,height=menu?.offsetHeight||95,gutter=8;
  const below=window.innerHeight-rect.bottom>=height+gutter;
  const top=below?rect.bottom+5:Math.max(gutter,rect.top-height-5);
  const left=Math.max(gutter,Math.min(rect.right-width,window.innerWidth-width-gutter));
  setPosition({top,left});
 },[]);
 useLayoutEffect(()=>{
  if(!open)return;
  update();
  window.addEventListener('scroll',update,true);
  window.addEventListener('resize',update);
  const raf=requestAnimationFrame(()=>{update();panel.current?.querySelector<HTMLButtonElement>('button')?.focus();});
  return()=>{
   cancelAnimationFrame(raf);
   window.removeEventListener('scroll',update,true);
   window.removeEventListener('resize',update);
  };
 },[open,update]);
 useDismissibleLayer(open,[trigger,panel],()=>setOpen(false),{restoreFocus:trigger});
 const choose=(action:()=>void)=>{setOpen(false);action();};
 return <>
  <AppButton ref={trigger} className="rl-folder-actions-trigger" type="button" aria-label={'Opções da pasta '+name}
   aria-haspopup="menu" aria-expanded={open} disabled={disabled} onClick={()=>setOpen(v=>!v)}>
   <MoreHorizontal size={18}/>
  </AppButton>
  {open&&createPortal(<div ref={panel} role="menu" aria-label={'Opções da pasta '+name}
   className="rl-menu-items rl-folder-actions-popup" style={position??{top:0,left:0,visibility:'hidden'}}>
   <AppButton role="menuitem" type="button" onClick={()=>choose(onOpen)}>Abrir pasta</AppButton>
   <AppButton role="menuitem" type="button" onClick={()=>choose(onUnlink)}>Desvincular do projeto</AppButton>
  </div>,document.body)}
 </>;
}
