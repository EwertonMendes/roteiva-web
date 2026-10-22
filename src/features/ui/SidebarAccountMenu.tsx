import {useEffect,useId,useRef,useState} from 'react';
import {LogOut,MoreHorizontal,Moon,Sun} from 'lucide-react';
import './sidebar-account-menu.css';
export function SidebarAccountMenu({theme,onToggleTheme,onLogout}:{theme:'light'|'dark';onToggleTheme:()=>void;onLogout?:()=>void}){
 const [open,setOpen]=useState(false);const root=useRef<HTMLDivElement>(null);const trigger=useRef<HTMLButtonElement>(null);const id=useId();
 useEffect(()=>{
  if(!open)return;
  root.current?.querySelector<HTMLButtonElement>('.sidebar-account-popover button')?.focus();
  const outside=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))setOpen(false);};
  document.addEventListener('pointerdown',outside);return ()=>document.removeEventListener('pointerdown',outside);
 },[open]);
 function closeAndRestore(){setOpen(false);trigger.current?.focus();}
 return <div className="sidebar-account-menu" ref={root} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget))setOpen(false);}} onKeyDown={e=>{if(e.key==='Escape'&&open){e.preventDefault();e.stopPropagation();closeAndRestore();}}}>
  <button ref={trigger} type="button" className="icon-button sidebar-account-trigger" aria-label="Opções da conta" title="Opções da conta" aria-expanded={open} aria-controls={id} onClick={()=>setOpen(value=>!value)}><MoreHorizontal size={19}/></button>
  {open&&<div id={id} className="sidebar-account-popover" role="group" aria-label="Opções da conta">
   <button type="button" aria-label={theme==='dark'?'Ativar modo claro':'Ativar modo escuro'} onClick={()=>{closeAndRestore();onToggleTheme();}}>{theme==='dark'?<Sun size={18}/>:<Moon size={18}/>}<span>{theme==='dark'?'Modo claro':'Modo escuro'}</span></button>
   {onLogout&&<><div className="sidebar-account-divider"/><button type="button" onClick={()=>{setOpen(false);onLogout();}}><LogOut size={18}/><span>Sair da conta</span></button></>}
  </div>}
 </div>;
}
