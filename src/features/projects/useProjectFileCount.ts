import {useEffect,useState} from 'react';
import {useAuth} from '../auth/AuthProvider';
import {useDriveApi} from '../drive/drive-api';

/** Authoritative D1 count: includes files in active nested folders, never folders or trash. */
export function useProjectFileCount(projectId:number,enabled:boolean){
 const {user}=useAuth(),call=useDriveApi();
 const [count,setCount]=useState<number|null>(null);
 useEffect(()=>{
  if(!enabled||!user){setCount(null);return;}
  let active=true;
  const pending=new Set<AbortController>();
  const load=()=>{
   const controller=new AbortController();pending.add(controller);
   void call<{count:number}>('/library/projects/'+projectId+'/count','GET',undefined,controller.signal)
    .then(result=>{if(active&&Number.isSafeInteger(result.count)&&result.count>=0)setCount(result.count);})
    .catch(()=>{if(active)setCount(null);})
    .finally(()=>pending.delete(controller));
  };
  load();
  const changed=(event:Event)=>{
   const detail=(event as CustomEvent<{projectId:number}>).detail;
   if(detail?.projectId===projectId)load();
  };
  window.addEventListener('roteiva:library-changed',changed);
  return()=>{active=false;window.removeEventListener('roteiva:library-changed',changed);pending.forEach(c=>c.abort());};
 },[projectId,enabled,user?.uid,call]);
 return count;
}
