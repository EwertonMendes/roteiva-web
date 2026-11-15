/** Private image previews reused only in the current browser tab and signed-in identity.
 * Never persists bytes, bearer tokens or source URLs. A second click shares the first fetch.
 */
const MAX_BYTES=48*1024*1024,MAX_ENTRY=24*1024*1024,MAX_ENTRIES=6,TTL=2*60*1000;
type Entry={url:string;bytes:number;expires:number};
export class LibraryPreviewCache {
 private uid:string|null=null;
 private generation=0;
 private bytes=0;
 private entries=new Map<string,Entry>();
 private pending=new Map<string,Promise<string>>();
 scope(uid:string|null){
  if(this.uid===uid)return;
  this.clear();this.uid=uid;
 }
 get(key:string):string|null{
  const entry=this.entries.get(key);
  if(!entry)return null;
  if(entry.expires<=Date.now()){this.drop(key);return null;}
  this.entries.delete(key);this.entries.set(key,entry);
  return entry.url;
 }
 async image(key:string,load:()=>Promise<Blob>):Promise<string>{
  const existing=this.get(key);if(existing)return existing;
  const current=this.pending.get(key);if(current)return current;
  const generation=this.generation;
  const task=(async()=>{
   const blob=await load();
   if(!blob.size||blob.size>MAX_ENTRY)throw new Error('O arquivo excede o limite da prévia.');
   if(generation!==this.generation)throw new Error('A sessão mudou durante a leitura.');
   const url=URL.createObjectURL(blob);
   this.entries.set(key,{url,bytes:blob.size,expires:Date.now()+TTL});
   this.bytes+=blob.size;
   while(this.bytes>MAX_BYTES||this.entries.size>MAX_ENTRIES){
    const oldest=this.entries.keys().next().value;
    if(!oldest)break;
    this.drop(oldest);
   }
   return url;
  })().finally(()=>{if(this.pending.get(key)===task)this.pending.delete(key);});
  this.pending.set(key,task);return task;
 }
 private drop(key:string){
  const entry=this.entries.get(key);if(!entry)return;
  this.bytes-=entry.bytes;this.entries.delete(key);URL.revokeObjectURL(entry.url);
 }
 clear(){
  this.generation++;for(const key of this.entries.keys())this.drop(key);
  this.pending.clear();this.bytes=0;
 }
}
export const libraryPreviewCache=new LibraryPreviewCache();
