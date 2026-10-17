/**
 * Client-side diagnostic counters, NOT Firestore billing.
 * Index-entry reads, rules-dependent reads, retries and minimum-query charges
 * are only visible in Firebase/GCP usage reports.
 */
export type FirestoreUsage = {
  serverQueries: number;
  serverDocumentsReturned: number;
  cacheQueries: number;
  cacheDocumentsReturned: number;
  aggregationQueries: number;
  revisionReads: number;
  mutationDocuments: number;
  mutationRevisions: number;
};
const zero=():FirestoreUsage=>({
  serverQueries:0,serverDocumentsReturned:0,cacheQueries:0,cacheDocumentsReturned:0,
  aggregationQueries:0,revisionReads:0,mutationDocuments:0,mutationRevisions:0,
});
const stats=new Map<string,FirestoreUsage>();
function current(uid:string):FirestoreUsage {
  let value=stats.get(uid);
  if(!value){value=zero();stats.set(uid,value);}
  return value;
}
export function trackPage(uid:string,source:"server"|"cache",returned:number):void {
  const item=current(uid);
  if(source==="server"){item.serverQueries++;item.serverDocumentsReturned+=returned;}
  else {item.cacheQueries++;item.cacheDocumentsReturned+=returned;}
}
export function trackAggregation(uid:string):void {current(uid).aggregationQueries++;}
export function trackRevision(uid:string):void {current(uid).revisionReads++;}
export function trackMutation(uid:string,documents:number):void {
  const item=current(uid);item.mutationDocuments+=documents;item.mutationRevisions++;
}
export function usageSnapshot(uid:string):Readonly<FirestoreUsage> {
  return Object.freeze({...current(uid)});
}
export function clearUsage(uid:string):void {stats.delete(uid);}
