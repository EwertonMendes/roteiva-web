export type LibraryImport={provider:'google_drive'|'dropbox';connectionId:string;fileId:string;name:string};
export type FailedLibraryImport=LibraryImport&{code:string};
type Call=<T>(path:string,method:'POST',body:unknown,signal:AbortSignal)=>Promise<T>;
/** Retrying an uncertain batch is safe: the server deduplicates active placements. */
export async function importLibraryBatch(call:Call,path:string,parentId:string,items:LibraryImport[],signal:AbortSignal,progress:(done:number,total:number)=>void){
 const failed:FailedLibraryImport[]=[];
 for(let i=0;i<items.length;i+=10){
  if(signal.aborted)throw new DOMException('Cancelled','AbortError');
  const batch=items.slice(i,i+10);progress(i,items.length);
  try{
   const reply=await call<{results:{fileId:string;status:string;code?:string}[]}>(path,'POST',{parentId,items:batch.map(({provider,connectionId,fileId})=>({provider,connectionId,fileId}))},signal);
   for(const item of batch){const result=reply.results.find(x=>x.fileId===item.fileId);if(result?.status!=='added')failed.push({...item,code:result?.code||'service_unavailable'});}
  }catch(error){
   if(signal.aborted)throw error;
   const code=(error as {code?:string}).code||'service_unavailable';
   failed.push(...batch.map(item=>({...item,code})));
   // Stop after transport/quota failure; avoid hammering a provider already unavailable.
   failed.push(...items.slice(i+10).map(item=>({...item,code})));break;
  }
 }
 progress(items.length,items.length);return failed;
}
