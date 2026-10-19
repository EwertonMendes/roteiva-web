import {doc,onSnapshot,type Firestore,type Timestamp} from "firebase/firestore";
export type AccessInfo={source:"trial"|"complimentary"|"subscription"|"none";unlimited:boolean;suspended:boolean;accessUntil:Date;trialEndsAt:Date};
export function parseAccess(value:Record<string,unknown>):AccessInfo{
  function time(field:string):Date{
    const raw=value[field] as Timestamp|undefined;
    if(!raw||typeof raw.toDate!=="function")throw new Error("Estado de acesso inválido.");
    const date=raw.toDate();
    if(!Number.isFinite(date.getTime()))throw new Error("Data de acesso inválida.");
    return date;
  }
  if(value.schemaVersion!==1||typeof value.unlimited!=="boolean"||typeof value.suspended!=="boolean"||
     !["trial","complimentary","subscription","none"].includes(String(value.source)))
    throw new Error("Estado de acesso inválido.");
  return {source:value.source as AccessInfo["source"],unlimited:value.unlimited,suspended:value.suspended,
    accessUntil:time("accessUntil"),trialEndsAt:time("trialEndsAt")};
}
export function watchAccess(db:Firestore,uid:string,onValue:(access:AccessInfo)=>void,onError:(error:Error)=>void):()=>void{
  return onSnapshot(doc(db,"users",uid,"access","current"),{includeMetadataChanges:true},snapshot=>{
    if(snapshot.metadata.fromCache)return;
    if(!snapshot.exists()){onError(new Error("Não foi possível confirmar seu acesso."));return;}
    try{onValue(parseAccess(snapshot.data()));}
    catch{onError(new Error("O servidor retornou um estado de acesso inválido."));}
  },()=>onError(new Error("Não foi possível acompanhar o estado do acesso.")));
}
