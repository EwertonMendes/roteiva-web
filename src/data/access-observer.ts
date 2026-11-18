import type {AccessInfo} from './access-state.ts';
import {entryDeadline,EntryError} from './bootstrap-request.ts';
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
  options:{firstSnapshotMs?:number;serverTimeoutMs?:number}={},
):()=>void{
  const MAX_RESTARTS=8;
  let active=true,generation=0,subscriptionId=0,restarts=0,recovering=false,unsubscribe=()=>{};
  let restartTimer:ReturnType<typeof setTimeout>|undefined;
  let snapshotTimer:ReturnType<typeof setTimeout>|undefined;
  const clearSnapshotTimer=()=>{clearTimeout(snapshotTimer);snapshotTimer=undefined;};

  const reconcile=(restart:boolean)=>{
    const current=++generation;
    void entryDeadline(()=>active&&current===generation?readServer():Promise.resolve(null),
      'access-server',options.serverTimeoutMs??20000).then(value=>{
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
    }).catch(error=>{
      if(active&&current===generation)
        onError(error instanceof EntryError?error:new EntryError('access-server','server'));
    });
  };

  const start=()=>{
    const subscription=++subscriptionId;
    const fail=()=>{
      if(!active||recovering||subscription!==subscriptionId)return;
      clearSnapshotTimer();
      recovering=true;
      ++subscriptionId;
      unsubscribe();
      unsubscribe=()=>{};
      if(restarts>=MAX_RESTARTS){
        ++generation;
        onError(new EntryError('access-listener','timeout'));
        return;
      }
      restarts++;
      reconcile(true);
    };
    // A buffering proxy can leave the SDK silent without invoking its error callback.
    // Recover with an owner-authenticated read, within the existing finite restart budget.
    snapshotTimer=setTimeout(fail,options.firstSnapshotMs??8000);
    const stop=subscribe(snapshot=>{
      if(!active||recovering||subscription!==subscriptionId||snapshot.fromCache)return;
      clearSnapshotTimer();
      if(snapshot.value){
        ++generation;
        restarts=0;
        onValue(snapshot.value);
      }else reconcile(false);
    },fail);
    if(active&&!recovering&&subscription===subscriptionId)unsubscribe=stop;
    else stop();
  };

  start();
  return()=>{
    active=false;
    ++generation;
    ++subscriptionId;
    clearSnapshotTimer();
    if(restartTimer)clearTimeout(restartTimer);
    unsubscribe();
  };
}
