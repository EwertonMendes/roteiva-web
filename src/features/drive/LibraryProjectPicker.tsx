import {useEffect,useMemo,useRef,useState} from 'react';
import {ChevronDown,FolderKanban,Search,LoaderCircle} from 'lucide-react';
import {isDemo} from '../../lib/firebase';
import {searchLibraryProjectsPage,type LibraryProjectCursor} from '../../data/firestore-project-search';
import {useAuth} from '../auth/AuthProvider';
import {AppButton} from '../ui/AppButton';
import {AppInput} from '../ui/AppInput';
import type {Project} from '../../domain/workspace';
import './library-project-picker.css';
type Choice={id:number;name:string};
const RECENT='roteiva:library-recent-projects:v1';
function recentKey(uid:string){return RECENT+':'+uid;}
function recent(uid:string):Choice[]{
 try{
  const data=JSON.parse(localStorage.getItem(recentKey(uid))||'[]') as Choice[];
  return Array.isArray(data)?data.filter(p=>Number.isSafeInteger(p.id)&&p.id>0&&typeof p.name==='string').slice(0,6):[];
 }catch{return [];}
}
export function LibraryProjectPicker({projects,value,onChange}:{projects:readonly Project[];value?:number;onChange:(id:string)=>void}){
 const {user}=useAuth(),uid=user?.uid||'demo';
 const wrapper=useRef<HTMLDivElement>(null),input=useRef<HTMLInputElement>(null),serial=useRef(0);
 const [open,setOpen]=useState(false),[term,setTerm]=useState(''),[remote,setRemote]=useState<Choice[]>([]);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[index,setIndex]=useState(0);
 const [cursor,setCursor]=useState<LibraryProjectCursor|null>(null);
 const [history,setHistory]=useState<Choice[]>(()=>recent(uid));
 useEffect(()=>{setHistory(recent(uid));setRemote([]);},[uid]);
 const loaded=useMemo(()=>projects.map(p=>({id:p.id,name:p.name})),[projects]);
 const choices=useMemo(()=>{
  const search=term.trim().toLocaleLowerCase('pt-BR');
  const input=search?[...loaded,...remote].filter(p=>p.name.toLocaleLowerCase('pt-BR').includes(search)):
   [...history,...loaded.slice(0,12)];
  return Array.from(new Map(input.map(p=>[p.id,p])).values()).slice(0,160);
 },[loaded,remote,term,history]);
 const selected=[...loaded,...remote,...history].find(p=>p.id===value);
 useEffect(()=>{
  if(!open||term.trim().length<2||isDemo||!user){setRemote([]);setCursor(null);setBusy(false);return;}
  const request=++serial.current;setCursor(null);setRemote([]);
  const timer=window.setTimeout(async()=>{
   setBusy(true);setError('');
   try{
    const results=await searchLibraryProjectsPage(user.uid,term.trim());
    if(request!==serial.current)return;
    setRemote(results.items);setCursor(results.cursor);
   }catch{
    if(request===serial.current)setError('Não foi possível pesquisar online. Você ainda pode escolher um projeto carregado.');
   }finally{if(request===serial.current)setBusy(false);}
  },300);
  return()=>{++serial.current;window.clearTimeout(timer);};
 },[open,term,user?.uid]);
 useEffect(()=>{
  if(!open)return;
  const outside=(event:PointerEvent)=>{if(!wrapper.current?.contains(event.target as Node))setOpen(false);};
  document.addEventListener('pointerdown',outside);
  return()=>document.removeEventListener('pointerdown',outside);
 },[open]);
 async function loadMore(){
  if(busy||!cursor||!user||term.trim().length<2)return;
  const request=serial.current;setBusy(true);setError('');
  try{
   const next=await searchLibraryProjectsPage(user.uid,term.trim(),cursor);
   if(request!==serial.current)return;
   setRemote(old=>Array.from(new Map([...old,...next.items].map(p=>[p.id,p])).values()));
   setCursor(next.cursor);
  }catch{if(request===serial.current)setError('Não foi possível carregar mais projetos. Tente novamente.');}
  finally{if(request===serial.current)setBusy(false);}
 }
 function choose(choice:Choice|null){
  onChange(choice?String(choice.id):'');
  if(choice){
   const next=[choice,...history.filter(p=>p.id!==choice.id)].slice(0,6);setHistory(next);
   try{localStorage.setItem(recentKey(uid),JSON.stringify(next));}catch{/* no persistence available */}
  }
  setOpen(false);setTerm('');
 }
 return <div className="lp-picker" ref={wrapper}>
  <AppButton className="lp-trigger" type="button" aria-label="Projeto dos arquivos" aria-haspopup="listbox"
   aria-expanded={open} onClick={()=>{setOpen(x=>!x);setTerm('');setIndex(0);window.setTimeout(()=>input.current?.focus(),0);}}>
   <FolderKanban size={17} aria-hidden="true"/><span>{selected?.name|| (value?'Projeto '+value:'Selecionar projeto')}</span><ChevronDown size={16} aria-hidden="true"/>
  </AppButton>
  {open&&<div className="lp-popover">
   <div className="lp-search"><Search size={17} aria-hidden="true"/>
    <AppInput ref={input} type="search" autoComplete="off" value={term} aria-label="Pesquisar projetos"
     placeholder="Pesquisar projetos…" onChange={e=>{setTerm(e.target.value);setIndex(0);}}
     onKeyDown={e=>{
      if(e.key==='Escape'){e.preventDefault();setOpen(false);}
      if(e.key==='ArrowDown'){e.preventDefault();setIndex(i=>Math.min(choices.length-1,i+1));}
      if(e.key==='ArrowUp'){e.preventDefault();setIndex(i=>Math.max(0,i-1));}
      if(e.key==='Enter'&&choices[index]){e.preventDefault();choose(choices[index]);}
     }}/>
    {busy&&<LoaderCircle size={17} className="lp-loading" aria-label="Pesquisando"/>}
   </div>
   <div className="lp-label">{term?'Resultados':'Recentes e projetos carregados'}</div>
   <div className="lp-results" role="listbox" aria-label="Projetos">
    {choices.map((p,i)=><AppButton key={p.id} type="button" className="lp-option" role="option" aria-selected={p.id===value}
      data-active={index===i} onMouseEnter={()=>setIndex(i)} onClick={()=>choose(p)}>
      <FolderKanban size={16} aria-hidden="true"/><span>{p.name}</span></AppButton>)}
    {!choices.length&&<div className="lp-empty">{busy?'Pesquisando…':term?'Nenhum projeto encontrado. Pesquise pelo início do nome.':'Nenhum projeto disponível.'}</div>}
   </div>
   {cursor&&remote.length<160&&<AppButton type="button" className="lp-more" disabled={busy} onClick={()=>void loadMore()}>{busy?'Pesquisando…':'Mostrar mais projetos'}</AppButton>}
   {cursor&&remote.length>=160&&<p className="lp-hint">Refine sua busca para encontrar outros projetos.</p>}
   {error&&<p role="alert" className="lp-error">{error}</p>}
   {value&&<AppButton className="lp-clear" onClick={()=>choose(null)}>Limpar seleção</AppButton>}
  </div>}
 </div>;
}
