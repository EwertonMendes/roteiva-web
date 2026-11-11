import type {AccessInfo} from './access-state.ts';
type Snapshot={fromCache:boolean;value:AccessInfo|null};
/** Reconcile a missing listener snapshot without cache before denying access.
 * A newer event, listener error or UID cleanup wins over an older server read.
 */
export function observeAccess(
  subscribe:(next:(snapshot:Snapshot)=>void,error:()=>void)=>()=>void,
  readServer:()=>Promise<AccessInfo|null>,
  onValue:(access:AccessInfo)=>void,onError:(error:Error)=>void,
):()=>void{
  let active=true,generation=0;
  const unsubscribe=subscribe(snapshot=>{
    if(!active||snapshot.fromCache)return;
    const current=++generation;
    if(snapshot.value){onValue(snapshot.value);return;}
    // No grant is invented or written. The independent read uses the user's
    // own ID token and remains subject to the same Firestore Rules.
    void Promise.resolve().then(()=>active&&current===generation?readServer():null).then(value=>{
      if(!active||current!==generation)return;
      if(value)onValue(value);
      else onError(new Error("Não foi possível confirmar seu acesso."));
    }).catch(()=>{
      if(active&&current===generation)onError(new Error("Não foi possível confirmar seu acesso no servidor. Tente novamente."));
    });
  },()=>{
    if(!active)return;
    ++generation;onError(new Error("Não foi possível acompanhar o estado do acesso."));
  });
  return()=>{active=false;++generation;unsubscribe();};
}
