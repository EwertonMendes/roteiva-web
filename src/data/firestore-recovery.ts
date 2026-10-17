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
  return code==="failed-precondition" &&
    (typeof message!=="string" || /index|índice|query requires|building/i.test(message));
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
