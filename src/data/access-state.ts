export type AccessInfo={source:"trial"|"complimentary"|"subscription"|"none";unlimited:boolean;suspended:boolean;accessUntil:Date;trialEndsAt:Date};
export function parseAccess(value:Record<string,unknown>):AccessInfo{
  function time(field:string):Date{
    const raw=value[field] as Date|{toDate?:()=>Date}|undefined;
    const date=raw instanceof Date?new Date(raw.getTime()):raw?.toDate?.();
    if(!(date instanceof Date)||!Number.isFinite(date.getTime()))throw new Error("Data de acesso inválida.");
    return date;
  }
  if(value.schemaVersion!==1||typeof value.unlimited!=="boolean"||typeof value.suspended!=="boolean"||
     !["trial","complimentary","subscription","none"].includes(String(value.source)))throw new Error("Estado de acesso inválido.");
  return {source:value.source as AccessInfo["source"],unlimited:value.unlimited,suspended:value.suspended,
    accessUntil:time("accessUntil"),trialEndsAt:time("trialEndsAt")};
}
/** Decode only the protected projection, never arbitrary Firestore documents. */
export function parseAccessRest(document:unknown,expectedName:string,uid:string):AccessInfo{
  const data=document as {name?:unknown;fields?:Record<string,{stringValue?:unknown;integerValue?:unknown;booleanValue?:unknown;timestampValue?:unknown}>}|null;
  const fields=data?.fields;
  if(data?.name!==expectedName||fields?.ownerUid?.stringValue!==uid)throw new Error("Estado de acesso inválido.");
  const date=(name:string)=>{
    const value=fields[name]?.timestampValue;
    return new Date(typeof value==='string'?value:NaN);
  };
  return parseAccess({schemaVersion:fields.schemaVersion?.integerValue==='1'?1:undefined,
    source:fields.source?.stringValue,unlimited:fields.unlimited?.booleanValue,suspended:fields.suspended?.booleanValue,
    accessUntil:date('accessUntil'),trialEndsAt:date('trialEndsAt')});
}
