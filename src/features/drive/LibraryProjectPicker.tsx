import {useEffect,useMemo,useRef,useState} from 'react';
import {ChevronDown,FolderKanban,Search,LoaderCircle} from 'lucide-react';
import {collection,documentId,endAt,getDocsFromServer,limit,orderBy,query,startAt} from 'firebase/firestore';
import {firebaseServices,isDemo} from '../../lib/firebase';
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
 const [history,setHistory]=useState<Choice[]>(()=>recent(uid));
 useEffect(()=>{setHistory(recent(uid));setRemote([]);},[uid]);
 const loaded=useMemo(()=>projects.map(p=>({id:p.id,name:p.name})),[projects]);
 const choices=useMemo(()=>{
  const search=term.trim().toLocaleLowerCase('pt-BR');
  const input=search?[...loaded,...remote].filter(p=>p.name.toLocaleLowerCase('pt-BR').includes(search)):
   [...history,...loaded.slice(0,12)];
  return Array.from(new Map(input.map(p=>[p.id,p])).values()).slice(0,40);
 },[loaded,remote,term,history]);
 const selected=[...loaded,...remote,...history].find(p=>p.id===value);
 useEffect(()=>{
  if(!open||term.trim().length<2||isDemo||!user){setRemote([]);setBusy(false);return;}
  const request=++serial.current;
  const timer=window.setTimeout(async()=>{
   setBusy(true);setError('');
   try{
    // The existing project schema has a case-sensitive name field. Probe
    // common capitalizations without reading all projects into memory.
    const prefix=term.trim().slice(0,90);
    const variants=Array.from(new Set([prefix,prefix.charAt(0).toLocaleUpperCase('pt-BR')+prefix.slice(1)])).slice(0,2);
    const {db}=firebaseServices();
    const base=collection(db,'users',user.uid,'projects');
    const batches=await Promise.all(variants.map(p=>getDocsFromServer(query(base,orderBy('name'),orderBy(documentId()),
     startAt(p),endAt(p+'\uf8ff'),limit(35)))));
    if(request!==serial.current)return;
    setRemote(Array.from(new Map(batches.flatMap(b=>b.docs.map(d=>({id:Number(d.id),name:String(d.data().name||'')})))
     .filter(p=>Number.isSafeInteger(p.id)&&p.id>0&&p.name).map(p=>[p.id,p])).values()));
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
   {error&&<p role="alert" className="lp-error">{error}</p>}
   {value&&<AppButton className="lp-clear" onClick={()=>choose(null)}>Limpar seleção</AppButton>}
  </div>}
 </div>;
}
