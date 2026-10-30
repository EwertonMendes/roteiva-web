import {AppButton} from "./AppButton";
import {useEffect,useId,useRef,useState} from 'react';
import {LogOut,MoreHorizontal,Moon,Sun} from 'lucide-react';
import './sidebar-account-menu.css';
import {useDismissibleLayer} from './useDismissibleLayer';
export function SidebarAccountMenu({theme,onToggleTheme,onLogout}:{theme:'light'|'dark';onToggleTheme:()=>void;onLogout?:()=>void}){
 const [phase,setPhase]=useState<'closed'|'open'|'closing'>('closed');
 const open=phase==='open';
 const root=useRef<HTMLDivElement>(null);const trigger=useRef<HTMLButtonElement>(null);const id=useId();
 function close(){setPhase(current=>current==='closed'?'closed':'closing');}
 useEffect(()=>{
  if(!open)return;
  root.current?.querySelector<HTMLButtonElement>('.sidebar-account-popover button')?.focus();
  // Click-away is shared; this effect handles only opening focus.
 },[open]);
 useDismissibleLayer(open,[root],close,{escape:false});
 function closeAndRestore(){close();trigger.current?.focus();}
 return <div className="sidebar-account-menu" ref={root} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget))close();}} onKeyDown={e=>{if(e.key==='Escape'&&open){e.preventDefault();e.stopPropagation();closeAndRestore();}}}>
  <AppButton ref={trigger} type="button" className="icon-button sidebar-account-trigger" aria-label="Opções da conta" title="Opções da conta" aria-expanded={open} aria-controls={phase==='closed'?undefined:id} onClick={()=>open?close():setPhase('open')}><MoreHorizontal size={19}/></AppButton>
  {phase!=='closed'&&<div id={id} className="sidebar-account-popover" data-state={phase} role="group" aria-label="Opções da conta" aria-hidden={!open} inert={!open} onAnimationEnd={event=>{
   if(event.target===event.currentTarget&&event.animationName==='account-panel-out')setPhase(current=>current==='closing'?'closed':current);
  }}>
   <AppButton type="button" className="sidebar-account-theme" aria-label={theme==='dark'?'Ativar modo claro':'Ativar modo escuro'} onClick={onToggleTheme}>{theme==='dark'?<Sun size={18}/>:<Moon size={18}/>}<span>{theme==='dark'?'Modo claro':'Modo escuro'}</span></AppButton>
   {onLogout&&<><div className="sidebar-account-divider"/><AppButton type="button" className="sidebar-account-logout" onClick={()=>{close();onLogout();}}><LogOut size={18}/><span>Sair da conta</span></AppButton></>}
  </div>}
 </div>;
}
