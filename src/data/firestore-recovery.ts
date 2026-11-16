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
 * When one browser tab reloads while another owns the persistent Firestore
 * connection, the SDK can transiently deny reads until its Auth credentials
 * and tab ownership converge. A retry is allowed ONLY after fresh server
 * verification of this user's current access and registered profile. Every
 * subsequent protected Firestore query still enforces Rules independently.
 * A genuine access revocation, server denial, different identity or exhausted
 * retry budget must fail closed. Never retry writes.
 */
export async function retryVerifiedInitialRead<T>(
  read:()=>Promise<T>,
  confirmServerEntitlement:()=>Promise<boolean>,
  options:{isCurrent?:()=>boolean;delaysMs?:readonly number[]}={},
):Promise<T>{
  try{
    return await retryFirestoreRead(read,{isCurrent:options.isCurrent});
  }catch(original){
    if(firestoreCode(original)!=='permission-denied')throw original;
    const delays=options.delaysMs??[150,450,1000];
    let lastError:unknown=original;
    for(const delay of delays){
      if(options.isCurrent&&!options.isCurrent())throw new Error('Leitura cancelada.');
      // Fail closed for absent/suspended/expired access, or failed fresh auth.
      if(!(await confirmServerEntitlement()))throw original;
      if(options.isCurrent&&!options.isCurrent())throw new Error('Leitura cancelada.');
      if(delay>0)await new Promise<void>(resolve=>setTimeout(resolve,delay));
      if(options.isCurrent&&!options.isCurrent())throw new Error('Leitura cancelada.');
      try{return await retryFirestoreRead(read,{attempts:1,isCurrent:options.isCurrent});}
      catch(error){
        if(firestoreCode(error)!=='permission-denied')throw error;
        lastError=error;
      }
    }
    throw lastError;
  }
}
