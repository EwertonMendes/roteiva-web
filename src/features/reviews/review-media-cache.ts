/** Short-lived, tab-memory-only preview reuse. Never writes private media to CacheStorage,
 * IndexedDB or localStorage. A session/revision change revokes every object URL. */
export type MediaTicket={url:string;expiresAt:number};
type Entry={url:string;size:number;last:number};
export const IMAGE_CACHE_LIMIT=48*1024*1024;
export const IMAGE_ENTRY_LIMIT=18*1024*1024;
const MAX_ENTRIES=8;
export class ReviewMediaSessionCache{
  private entries=new Map<string,Entry>();
  private inFlight=new Map<string,Promise<string>>();
  private tickets=new Map<string,MediaTicket>();
  private pendingTickets=new Map<string,Promise<MediaTicket>>();
  private controllers=new Set<AbortController>();
  private generation=0;
  private used=0;
  private counter=0;

  private evict(){
    while(this.used>IMAGE_CACHE_LIMIT||this.entries.size>MAX_ENTRIES){
      const oldest=[...this.entries.entries()].sort((a,b)=>a[1].last-b[1].last)[0];
      if(!oldest)break;
      this.entries.delete(oldest[0]);this.used-=oldest[1].size;URL.revokeObjectURL(oldest[1].url);
    }
  }
  get(key:string):string|null{
    const entry=this.entries.get(key);
    if(!entry)return null;
    entry.last=++this.counter;
    return entry.url;
  }
  rememberTicket(key:string,ticket:MediaTicket){
    if(ticket.expiresAt>Date.now()+20000)this.tickets.set(key,ticket);
  }
  async ticket(key:string,create:()=>Promise<MediaTicket>):Promise<MediaTicket>{
    const existing=this.tickets.get(key);
    if(existing&&existing.expiresAt>Date.now()+60000)return existing;
    const pending=this.pendingTickets.get(key);
    if(pending)return pending;
    const generation=this.generation;
    const task=create().then(result=>{
      if(generation===this.generation)this.rememberTicket(key,result);
      return result;
    }).finally(()=>{if(this.pendingTickets.get(key)===task)this.pendingTickets.delete(key);});
    this.pendingTickets.set(key,task);
    return task;
  }
  /** One in-flight fetch for a given file; reselecting a file reuses its Blob URL instantly. */
  async image(key:string,ticketUrl:string,mimeType:string):Promise<string>{
    const loaded=this.get(key);if(loaded)return loaded;
    const pending=this.inFlight.get(key);if(pending)return pending;
    const generation=this.generation;
    const controller=new AbortController();this.controllers.add(controller);
    const task=(async()=>{
      const response=await fetch(ticketUrl,{method:'GET',cache:'no-store',
        referrerPolicy:'no-referrer',signal:controller.signal});
      if(!response.ok)throw new Error('A imagem está temporariamente indisponível. Tente novamente.');
      const reported=Number(response.headers.get('Content-Length')||0);
      if(Number.isFinite(reported)&&reported>IMAGE_ENTRY_LIMIT){
        await response.body?.cancel();
        // Large images are streamed by the browser directly, without holding
        // multiple full copies in memory.
        return ticketUrl;
      }
      const blob=await response.blob();
      if(!blob.size||blob.size>IMAGE_ENTRY_LIMIT)return ticketUrl;
      const received=(response.headers.get('Content-Type')||'').split(';')[0];
      if(!received.startsWith('image/')||!mimeType.startsWith('image/'))
        throw new Error('O conteúdo do arquivo não corresponde ao formato de imagem.');
      if(controller.signal.aborted||generation!==this.generation)
        throw new DOMException('Preview cancelled','AbortError');
      const url=URL.createObjectURL(blob);
      this.entries.set(key,{url,size:blob.size,last:++this.counter});this.used+=blob.size;
      this.evict();
      return url;
    })().finally(()=>{
      this.controllers.delete(controller);
      if(this.inFlight.get(key)===task)this.inFlight.delete(key);
    });
    this.inFlight.set(key,task);return task;
  }
  clear(){
    this.generation++;
    for(const controller of this.controllers)controller.abort();
    this.controllers.clear();this.inFlight.clear();this.pendingTickets.clear();this.tickets.clear();
    for(const entry of this.entries.values())URL.revokeObjectURL(entry.url);
    this.entries.clear();this.used=0;
  }
}
