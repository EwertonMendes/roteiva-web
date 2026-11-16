/**
 * Read recovery only. NEVER retry business writes here: a write may have
 * succeeded before the connection dropped and repeating it can duplicate work.
 */
export function firestoreCode(error:unknown):string {
  const item=error as {code?:unknown;message?:unknown}|null;
  return typeof item?.code==="string" ? item.code.replace(/^firestore\//,"") : "";
}
export function missingQueryIndex(error:unknown):boolean {
  const code=firestoreCode(error);
  const message=(error as {message?:unknown}|null)?.message;
  return (code==="failed-precondition" &&
    (typeof message!=="string" || /index|índice|query requires|building/i.test(message))) ||
    code==="invalid-argument" || code==="unimplemented";
}
export function transientFirestoreRead(error:unknown):boolean {
  return ["unavailable","deadline-exceeded","aborted","internal"].includes(firestoreCode(error));
}
export async function retryFirestoreRead<T>(
  read:()=>Promise<T>,
  options:{attempts?:number;delaysMs?:readonly number[];isCurrent?:()=>boolean}={},
):Promise<T> {
  const attempts=options.attempts??3;
  const delays=options.delaysMs??[300,900,2000];
  if(!Number.isInteger(attempts)||attempts<1)throw Error("Tentativas de leitura inválidas.");
  for(let i=0;i<attempts;i++){
    if(options.isCurrent && !options.isCurrent())throw Error("Leitura cancelada.");
    try{return await read();}
    catch(error){
      if(!transientFirestoreRead(error)||i===attempts-1)throw error;
      const wait=delays[Math.min(i,delays.length-1)]??0;
      if(wait>0)await new Promise<void>(resolve=>setTimeout(resolve,wait));
    }
  }
  throw Error("Leitura esgotada.");
}

/**
 * A newly restored Firebase tab can briefly get a permission-denied SDK read
 * while its cross-tab credential provider is still synchronizing. This is NOT
 * a blanket retry: first confirm the current user's entitlement and profile
 * with fresh authenticated server-only reads. The actual Firestore Rules must
 * allow the retried business query; a second denial is final.
 *
 * Never use this for writes. Writes may have committed before an error.
 */
export async function retryVerifiedInitialRead<T>(
  read:()=>Promise<T>,
  confirmServerEntitlement:()=>Promise<boolean>,
  options:{isCurrent?:()=>boolean}={},
):Promise<T>{
  try{
    return await retryFirestoreRead(read,{isCurrent:options.isCurrent});
  }catch(original){
    if(firestoreCode(original)!=='permission-denied')throw original;
    if(options.isCurrent&&!options.isCurrent())throw new Error('Leitura cancelada.');
    // A failure to confirm access must deny, never authorize the retry.
    const verified=await confirmServerEntitlement();
    if(!verified)throw original;
    if(options.isCurrent&&!options.isCurrent())throw new Error('Leitura cancelada.');
    return retryFirestoreRead(read,{attempts:1,isCurrent:options.isCurrent});
  }
}
