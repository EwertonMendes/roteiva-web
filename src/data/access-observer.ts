import type {AccessInfo} from './access-state.ts';
type Snapshot={fromCache:boolean;value:AccessInfo|null};
/** Confirm anomalous SDK results with the authenticated server. A terminated
 * listener is restarted once after credential refresh so revocations stay live.
 */
export function observeAccess(
  subscribe:(next:(snapshot:Snapshot)=>void,error:()=>void)=>()=>void,
  readServer:()=>Promise<AccessInfo|null>,
  onValue:(access:AccessInfo)=>void,onError:(error:Error)=>void,
):()=>void{
  let active=true,generation=0,restarted=false,unsubscribe=()=>{};
  const reconcile=(restart:boolean)=>{
    const current=++generation;
    void Promise.resolve().then(()=>active&&current===generation?readServer():null).then(value=>{
      if(!active||current!==generation)return;
      if(!value){onError(new Error('Não foi possível confirmar seu acesso.'));return;}
      onValue(value);
      if(restart&&active){unsubscribe();start();}
    }).catch(()=>{
      if(active&&current===generation)onError(new Error('Não foi possível confirmar seu acesso no servidor. Tente novamente.'));
    });
  };
  const start=()=>{
    unsubscribe=subscribe(snapshot=>{
      if(!active||snapshot.fromCache)return;
      if(snapshot.value){++generation;onValue(snapshot.value);}
      else reconcile(false);
    },()=>{
      if(!active)return;
      if(restarted){++generation;onError(new Error('Não foi possível acompanhar o estado do acesso.'));return;}
      restarted=true;reconcile(true);
    });
  };
  start();
  return()=>{active=false;++generation;unsubscribe();};
}
