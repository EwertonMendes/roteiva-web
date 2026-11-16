import type {AccessInfo} from './access-state.ts';
type Snapshot={fromCache:boolean;value:AccessInfo|null};

// Re-authenticate against the same user's protected server document before
// re-establishing a terminated Firestore listener. Browser tabs sharing
// IndexedDB can transiently terminate a listener during reload/ownership
// changes. A bounded backoff avoids an immediate failure loop, while real
// revocations and denied server reads must still fail closed.
const RECONNECT_DELAYS_MS=[0,200,500,1000] as const;

export function observeAccess(
  subscribe:(next:(snapshot:Snapshot)=>void,error:()=>void)=>()=>void,
  readServer:()=>Promise<AccessInfo|null>,
  onValue:(access:AccessInfo)=>void,onError:(error:Error)=>void,
):()=>void{
  let active=true,generation=0,listenerVersion=0,consecutiveFailures=0,unsubscribe=()=>{};
  let reconnectTimer:ReturnType<typeof setTimeout>|null=null;
  const clearReconnect=()=>{
    if(reconnectTimer!==null){clearTimeout(reconnectTimer);reconnectTimer=null;}
  };
  const reconcile=(restart:boolean)=>{
    const current=++generation;
    if(restart)unsubscribe();
    void Promise.resolve().then(()=>active&&current===generation?readServer():null).then(value=>{
      if(!active||current!==generation)return;
      if(!value){onError(new Error('Não foi possível confirmar seu acesso.'));return;}
      onValue(value);
      if(!restart||!active)return;
      const delay=RECONNECT_DELAYS_MS[consecutiveFailures-1];
      if(delay===0)start();
      else reconnectTimer=setTimeout(()=>{
        reconnectTimer=null;
        if(active&&current===generation)start();
      },delay);
    }).catch(()=>{
      if(active&&current===generation)onError(new Error('Não foi possível confirmar seu acesso no servidor. Tente novamente.'));
    });
  };
  const start=()=>{
    if(!active)return;
    const version=++listenerVersion;
    unsubscribe=subscribe(snapshot=>{
      if(!active||version!==listenerVersion||snapshot.fromCache)return;
      if(snapshot.value){
        clearReconnect();
        consecutiveFailures=0;
        ++generation;
        onValue(snapshot.value);
      }else reconcile(false);
    },()=>{
      if(!active||version!==listenerVersion)return;
      ++listenerVersion; // Ignore callbacks from the terminated subscription.
      if(consecutiveFailures>=RECONNECT_DELAYS_MS.length){
        ++generation;
        unsubscribe();
        onError(new Error('Não foi possível acompanhar o estado do acesso.'));
        return;
      }
      consecutiveFailures++;
      // This recovery never trusts a cache snapshot or the old listener:
      // every retry first revalidates entitlement using the authenticated
      // server read, then restores live revocation monitoring.
      reconcile(true);
    });
  };
  start();
  return()=>{active=false;++generation;++listenerVersion;clearReconnect();unsubscribe();};
}
