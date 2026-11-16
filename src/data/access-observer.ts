import type {AccessInfo} from './access-state.ts';
type Snapshot={fromCache:boolean;value:AccessInfo|null};

/** A Firestore listener can terminate while a restored login is contending
 * with another tab for IndexedDB's primary lease. Only the authenticated
 * server may authorize a recovery; stale cache and listener errors never do.
 *
 * Retry transient listener terminations (with bounded backoff) rather than
 * rejecting an otherwise valid session after just the second termination.
 * Every retry requires a fresh owner-scoped server read, and a persistent
 * failure still fails closed. A live server snapshot resets the retry budget.
 */
export function observeAccess(
  subscribe:(next:(snapshot:Snapshot)=>void,error:()=>void)=>()=>void,
  readServer:()=>Promise<AccessInfo|null>,
  onValue:(access:AccessInfo)=>void,onError:(error:Error)=>void,
):()=>void{
  const MAX_RESTARTS=8;
  let active=true,generation=0,restarts=0,recovering=false,unsubscribe=()=>{};
  let restartTimer:ReturnType<typeof setTimeout>|undefined;

  const reconcile=(restart:boolean)=>{
    const current=++generation;
    void Promise.resolve().then(()=>active&&current===generation?readServer():null).then(value=>{
      if(!active||current!==generation)return;
      if(!value){onError(new Error('Não foi possível confirmar seu acesso.'));return;}
      onValue(value);
      if(!restart)return;
      // Do not spin when the SDK immediately terminates a new listener.
      // The first attempts are immediate; repeated terminations back off.
      const delay=restarts<=2?0:Math.min(1500,100*2**(restarts-3));
      const resume=()=>{
        restartTimer=undefined;
        if(!active||current!==generation)return;
        recovering=false;
        start();
      };
      if(delay)restartTimer=setTimeout(resume,delay);
      else resume();
    }).catch(()=>{
      if(active&&current===generation)
        onError(new Error('Não foi possível confirmar seu acesso no servidor. Tente novamente.'));
    });
  };

  const start=()=>{
    unsubscribe=subscribe(snapshot=>{
      if(!active||recovering||snapshot.fromCache)return;
      if(snapshot.value){
        ++generation;
        restarts=0;
        onValue(snapshot.value);
      }else reconcile(false);
    },()=>{
      if(!active||recovering)return;
      recovering=true;
      unsubscribe();
      unsubscribe=()=>{};
      if(restarts>=MAX_RESTARTS){
        ++generation;
        onError(new Error('Não foi possível acompanhar o estado do acesso.'));
        return;
      }
      restarts++;
      reconcile(true);
    });
  };

  start();
  return()=>{
    active=false;
    ++generation;
    if(restartTimer)clearTimeout(restartTimer);
    unsubscribe();
  };
}
