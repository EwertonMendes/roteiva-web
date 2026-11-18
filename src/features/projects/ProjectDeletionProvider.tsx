import {createContext,useCallback,useContext,useEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import type {Project} from '../../domain/workspace';
import {useAuth} from '../auth/AuthProvider';
import {useToast} from '../ui/ToastProvider';
import {firebaseServices} from '../../lib/firebase';
import {API_BASE_URL} from '../../lib/environment';

export type DeletionProject=Pick<Project,'id'|'name'|'status'>;
export type DeletionStatus='idle'|'processing'|'completed'|'manual_review';
export type DeletionResult={status:DeletionStatus;phase?:string;operationId?:string};
type Job={project:DeletionProject;status:'processing'|'manual_review';phase:string;operationId?:string};
type Completion={project:DeletionProject;operationId:string;sequence:number};
type ContextValue={
  jobs:Record<number,Job>;
  completion:Completion|null;
  inspect:(project:DeletionProject,force?:boolean)=>Promise<DeletionResult>;
  start:(project:DeletionProject)=>Promise<DeletionResult>;
  acknowledge:(sequence:number)=>void;
};
const Context=createContext<ContextValue|null>(null);
const key=(uid:string)=>'roteiva-project-deletions-v1:'+uid;
const valid=(p:DeletionProject)=>Number.isSafeInteger(p.id)&&p.id>0&&typeof p.name==='string'&&p.name.length>0&&p.name.length<=200
  &&['Em produção','Em aprovação','Ajustes','Aprovado'].includes(p.status);
function restored(uid:string):Record<number,Job>{
  if(!uid)return {};
  try{
    const raw=localStorage.getItem(key(uid));
    const value=raw?JSON.parse(raw) as unknown:null;
    if(!Array.isArray(value))return {};
    const output:Record<number,Job>={};
    for(const item of value.slice(0,30)){
      if(!item||typeof item!=='object')continue;
      const candidate=item as Job;
      if(!candidate.project||!valid(candidate.project)||!['processing','manual_review'].includes(candidate.status))continue;
      output[candidate.project.id]={project:candidate.project,status:candidate.status,
        phase:typeof candidate.phase==='string'?candidate.phase:'',
        operationId:typeof candidate.operationId==='string'?candidate.operationId:undefined};
    }
    return output;
  }catch{return {};}
}
async function request(uid:string,id:number,method:'GET'|'POST',name?:string):Promise<DeletionResult>{
  const user=firebaseServices().auth.currentUser;
  if(!user||user.uid!==uid)throw new Error('Sua sessão mudou. Entre novamente para continuar.');
  const token=await user.getIdToken();
  let response:Response;
  try{
    response=await fetch(API_BASE_URL+'/projects/'+id+'/deletion',{
      method,cache:'no-store',
      headers:{Authorization:'Bearer '+token,...(method==='POST'?{'Content-Type':'application/json'}:{})},
      ...(method==='POST'?{body:JSON.stringify({phrase:'EXCLUIR PROJETO',name,acknowledged:true})}:{})
    });
  }catch{throw new Error('Não foi possível consultar a exclusão. Verifique sua conexão.');}
  const data=await response.json().catch(()=>null) as (DeletionResult&{error?:{code?:string}})|null;
  if(!response.ok){
    if(data?.error?.code==='project_confirmation_mismatch')throw new Error('O projeto foi alterado em outra aba. Atualize a página.');
    if(data?.error?.code==='project_not_found')throw new Error('O projeto não está mais disponível.');
    if(data?.error?.code==='project_deletion_unavailable')throw new Error('A exclusão não está disponível neste ambiente.');
    throw new Error('Não foi possível confirmar a operação. Verifique a conexão e tente novamente.');
  }
  if(!data||!['idle','processing','completed','manual_review'].includes(data.status))
    throw new Error('O servidor não confirmou o estado da exclusão.');
  return data;
}

/**
 * Lives above the route-driven DashboardClient. Only pending jobs are polled,
 * while D1 + Worker cron carry out the actual deletion independently of this
 * browser. A tiny account-scoped journal lets polling recover after refresh.
 */
export function ProjectDeletionProvider({children}:{children:ReactNode}){
  const {user}=useAuth(),uid=user?.uid||'';
  const notify=useToast();
  const [jobs,setJobs]=useState<Record<number,Job>>(()=>restored(uid));
  const [completion,setCompletion]=useState<Completion|null>(null);
  const checks=useRef(new Set<number>());
  const completed=useRef(new Set<string>());
  const inFlight=useRef(new Set<number>());
  const jobsRef=useRef(jobs);
  jobsRef.current=jobs;
  const sequence=useRef(0);
  useEffect(()=>{setJobs(restored(uid));checks.current.clear();completed.current.clear();inFlight.current.clear();},[uid]);
  useEffect(()=>{
    if(!uid)return;
    try{localStorage.setItem(key(uid),JSON.stringify(Object.values(jobs).slice(0,30)));}catch{ /* Browser storage can be unavailable; in-tab completion still works. */ }
  },[uid,jobs]);
  const finish=useCallback((job:Job)=>{
    const token=job.operationId||String(job.project.id);
    if(completed.current.has(token))return;
    completed.current.add(token);
    setJobs(current=>{
      if(!current[job.project.id])return current;
      const next={...current};delete next[job.project.id];return next;
    });
    setCompletion({project:job.project,operationId:token,sequence:++sequence.current});
    notify(<><strong>{job.project.name}</strong> foi excluído com sucesso.</>,'success');
  },[notify]);
  const update=useCallback((project:DeletionProject,result:DeletionResult)=>{
    const current=jobsRef.current[project.id];
    if(result.status==='completed'){
      finish({project,status:'processing',phase:'completed',operationId:result.operationId||current?.operationId});
      return;
    }
    if(result.status==='processing'||result.status==='manual_review'){
      setJobs(previous=>{
        const before=previous[project.id];
        if(before?.status===result.status&&before.phase===(result.phase||'')&&
          before.operationId===(result.operationId||before.operationId))return previous;
        return {...previous,[project.id]:{project,status:result.status,phase:result.phase||'',
          operationId:result.operationId||before?.operationId}};
      });
      if(result.status==='manual_review'&&current?.status!=='manual_review')
        notify('A exclusão de '+project.name+' precisa de verificação do suporte. Os dados continuam protegidos.','error');
    }else if(current){
      setJobs(previous=>{const next={...previous};delete next[project.id];return next;});
    }
  },[finish,notify]);
  const inspect=useCallback(async(project:DeletionProject,force=false):Promise<DeletionResult>=>{
    if(!uid||!valid(project))throw new Error('Projeto inválido.');
    const tracked=jobsRef.current[project.id];
    if(tracked&&!force)return {status:tracked.status,phase:tracked.phase,operationId:tracked.operationId};
    if(!force&&checks.current.has(project.id))return {status:'idle'};
    checks.current.add(project.id);
    try{
      const result=await request(uid,project.id,'GET');
      update(project,result);
      return result;
    }catch(error){
      checks.current.delete(project.id);
      throw error;
    }
  },[uid,update]);
  const start=useCallback(async(project:DeletionProject):Promise<DeletionResult>=>{
    if(!uid||!valid(project))throw new Error('Projeto inválido.');
    if(inFlight.current.has(project.id)||jobsRef.current[project.id]?.status==='processing')
      return {status:'processing',phase:jobsRef.current[project.id]?.phase};
    inFlight.current.add(project.id);
    try{
      // Keep the job visible and recoverable even if the POST response is lost.
      setJobs(previous=>({...previous,[project.id]:{
        project,status:'processing',phase:'locking',operationId:previous[project.id]?.operationId
      }}));
      const result=await request(uid,project.id,'POST',project.name);
      update(project,result);
      if(result.status==='idle')throw new Error('A exclusão não foi iniciada.');
      return result;
    }catch(error){
      // Never resubmit an ambiguous destructive POST. Reconcile through one
      // read-only status request, then let the global monitor continue if needed.
      try{
        const result=await request(uid,project.id,'GET');
        update(project,result);
        if(result.status==='processing'||result.status==='completed')return result;
      }catch{ /* Retain the pending journal until connectivity returns. */ }
      throw error;
    }finally{inFlight.current.delete(project.id);}
  },[uid,update]);
  const pendingKey=useMemo(()=>Object.values(jobs).filter(j=>j.status==='processing')
    .map(j=>j.project.id).sort((a,b)=>a-b).join(','),[jobs]);
  useEffect(()=>{
    if(!uid||!pendingKey)return;
    let active=true,timeout:ReturnType<typeof setTimeout>|undefined;
    let backoff=4000;
    async function poll(){
      for(const id of pendingKey.split(',').map(Number)){
        const job=jobsRef.current[id];
        if(!active||!job||job.status!=='processing')continue;
        try{
          const result=await request(uid,id,'GET');
          if(!active)return;
          update(job.project,result);
          backoff=4000;
        }catch{backoff=Math.min(30000,backoff*2);}
      }
      if(active)timeout=setTimeout(()=>void poll(),backoff);
    }
    timeout=setTimeout(()=>void poll(),2500);
    return()=>{active=false;clearTimeout(timeout);};
  },[uid,pendingKey,update]);
  const acknowledge=useCallback((value:number)=>setCompletion(current=>current?.sequence===value?null:current),[]);
  const context=useMemo(()=>({jobs,completion,inspect,start,acknowledge}),[jobs,completion,inspect,start,acknowledge]);
  return <Context.Provider value={context}>{children}</Context.Provider>;
}
export function useProjectDeletion():ContextValue|null{return useContext(Context);}
