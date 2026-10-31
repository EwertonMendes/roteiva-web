/** Private display-image cache. Only small, authenticated thumbnails may touch IndexedDB.
 * Full originals and approval media always remain memory-only or uncached. */
export type MediaProvider = "google_drive" | "dropbox";
export type MediaIdentity = {
  uid:string; provider:MediaProvider; connectionId:string; fileId:string;
  variant:"thumbnail"|"original"; revision?:string;
};
const MEMORY_LIMIT=32*1024*1024;
const DISK_LIMIT=50*1024*1024;
const DISK_MAX_AGE=30*60*1000;
const MAX_CONCURRENT=4;
const DB_NAME="roteiva-private-display-images-v1";
type Cached={url:string;bytes:number;at:number};
type DiskEntry={key:string;uid:string;blob:Blob;bytes:number;at:number;last:number};
const memory=new Map<string,Cached>();
const flights=new Map<string,Promise<string>>();
const controllers=new Set<AbortController>();
const connectionEpochs=new Map<string,number>();
function connectionScope(media:Pick<MediaIdentity,"uid"|"provider"|"connectionId">){
 return JSON.stringify([media.uid,media.provider,media.connectionId]);
}
const queue:Array<{priority:number;start:()=>void;cancel:()=>void}>=[];
let used=0,running=0,generation=0;
let database:Promise<IDBDatabase|null>|undefined;
export function mediaKey(media:MediaIdentity):string{
  return JSON.stringify([media.uid,media.provider,media.connectionId,media.fileId,media.variant,media.revision||"legacy"]);
}
function remember(key:string,blob:Blob,at=Date.now()):string{
  const existing=memory.get(key);
  if(existing){used-=existing.bytes;URL.revokeObjectURL(existing.url);memory.delete(key);}
  const url=URL.createObjectURL(blob);
  memory.set(key,{url,bytes:blob.size,at});used+=blob.size;
  while(used>MEMORY_LIMIT&&memory.size>1){
    const oldest=memory.keys().next().value as string;
    const entry=memory.get(oldest)!;URL.revokeObjectURL(entry.url);
    used-=entry.bytes;memory.delete(oldest);
  }
  return url;
}
export function cachedMediaUrl(identity:MediaIdentity):string|null{
  const key=mediaKey(identity),entry=memory.get(key);
  if(!entry)return null;
  if(Date.now()-entry.at>DISK_MAX_AGE){
    memory.delete(key);used-=entry.bytes;URL.revokeObjectURL(entry.url);return null;
  }
  memory.delete(key);memory.set(key,entry);
  return entry.url;
}
function openDb():Promise<IDBDatabase|null>{
  if(typeof indexedDB==="undefined")return Promise.resolve(null);
  if(database)return database;
  database=new Promise(resolve=>{
    try{
      const request=indexedDB.open(DB_NAME,1);
      request.onupgradeneeded=()=>{
        const db=request.result;
        if(!db.objectStoreNames.contains("images"))db.createObjectStore("images",{keyPath:"key"});
      };
      request.onsuccess=()=>{request.result.onversionchange=()=>request.result.close();resolve(request.result);};
      request.onerror=()=>resolve(null);
      request.onblocked=()=>resolve(null);
    }catch{resolve(null);}
  });
  return database;
}
async function readDisk(key:string):Promise<DiskEntry|null>{
  const db=await openDb();if(!db)return null;
  return new Promise(resolve=>{
    try{
      const tx=db.transaction("images","readwrite"),store=tx.objectStore("images");
      const request=store.get(key);
      request.onsuccess=()=>{
        const item=request.result as DiskEntry|undefined;
        const valid=item&&item.blob instanceof Blob&&item.bytes>0&&item.bytes<=1024*1024&&Date.now()-item.at<DISK_MAX_AGE?item:null;
        if(valid)store.put({...valid,last:Date.now()});
        resolve(valid);
      };
      request.onerror=()=>resolve(null);
    }catch{resolve(null);}
  });
}
async function writeDisk(key:string,uid:string,blob:Blob,epoch:number,scope:string,scopeEpoch:number):Promise<void>{
  if(generation!==epoch||(connectionEpochs.get(scope)||0)!==scopeEpoch)return;
  const db=await openDb();if(!db||generation!==epoch||(connectionEpochs.get(scope)||0)!==scopeEpoch)return;
  try{
    await new Promise<void>(resolve=>{
      const tx=db.transaction("images","readwrite");
      tx.objectStore("images").put({key,uid,blob,bytes:blob.size,at:Date.now(),last:Date.now()} satisfies DiskEntry);
      tx.oncomplete=()=>resolve();tx.onerror=()=>resolve();tx.onabort=()=>resolve();
    });
    // Bounded LRU by total bytes. This is intentionally not a general-purpose media database.
    const items=await new Promise<Array<Pick<DiskEntry,"key"|"bytes"|"at"|"last">>>(resolve=>{
      const list:Array<Pick<DiskEntry,"key"|"bytes"|"at"|"last">>=[];
      try{
        const tx=db.transaction("images","readonly"),req=tx.objectStore("images").openCursor();
        req.onsuccess=()=>{const cursor=req.result;if(!cursor){resolve(list);return;}
          const item=cursor.value as DiskEntry;
          list.push({key:item.key,bytes:item.bytes,at:item.at,last:item.last});cursor.continue();};
        req.onerror=()=>resolve(list);
      }catch{resolve(list);}
    });
    let bytes=items.reduce((sum,item)=>sum+item.bytes,0);
    const stale=items.filter(item=>Date.now()-item.at>=DISK_MAX_AGE).map(item=>item.key);
    for(const item of items.sort((a,b)=>a.last-b.last)){
      if(bytes<=DISK_LIMIT)break;
      if(!stale.includes(item.key))stale.push(item.key);
      bytes-=item.bytes;
    }
    if(stale.length){
      await new Promise<void>(resolve=>{
        try{const tx=db.transaction("images","readwrite");for(const k of stale)tx.objectStore("images").delete(k);
          tx.oncomplete=()=>resolve();tx.onerror=()=>resolve();tx.onabort=()=>resolve();}
        catch{resolve();}
      });
    }
  }catch{/* No persistence available: memory remains operational. */}
}
function schedule<T>(priority:number,run:()=>Promise<T>):Promise<T>{
  return new Promise((resolve,reject)=>{
    const start=()=>{
      running++;
      void run().then(resolve,reject).finally(()=>{running--;pump();});
    };
    queue.push({priority,start,cancel:()=>reject(new Error("Sessão de imagens alterada."))});pump();
  });
}
function pump(){
  queue.sort((a,b)=>b.priority-a.priority);
  while(running<MAX_CONCURRENT&&queue.length)queue.shift()!.start();
}
/** Duplicate consumers share a single request. An unmounted consumer may ignore its result;
 * network fetches are aborted on identity change/logout, not on unrelated route navigation. */
export function loadStorageImage(
  identity:MediaIdentity,
  fetchImage:(signal:AbortSignal)=>Promise<Blob>,
  options:{persist:boolean;priority?:number},
):Promise<string>{
  const key=mediaKey(identity),existing=cachedMediaUrl(identity);
  if(existing)return Promise.resolve(existing);
  const pending=flights.get(key);if(pending)return pending;
  const epoch=generation;
  const scope=connectionScope(identity),scopeEpoch=connectionEpochs.get(scope)||0;
  const revoked=()=>epoch!==generation||(connectionEpochs.get(scope)||0)!==scopeEpoch;
  const promise=schedule(options.priority??1,async()=>{
    if(revoked())throw new Error("Sessão de imagens alterada.");
    if(options.persist&&identity.variant==="thumbnail"){
      const stored=await readDisk(key);
      if(revoked())throw new Error("Sessão de imagens alterada.");
      if(stored)return remember(key,stored.blob,stored.at);
    }
    const controller=new AbortController();controllers.add(controller);
    try{
      const blob=await fetchImage(controller.signal);
      if(revoked()||controller.signal.aborted)throw new Error("Sessão de imagens alterada.");
      if(!blob.size||blob.size>8*1024*1024||!["image/jpeg","image/png","image/webp","image/avif"].includes(blob.type))
        throw new Error("Imagem inválida ou muito grande.");
      const url=remember(key,blob);
      if(options.persist&&identity.variant==="thumbnail"&&blob.size<=1024*1024&&!revoked()){
        // Never delay displaying an image for IndexedDB writes.
        void writeDisk(key,identity.uid,blob,epoch,scope,scopeEpoch);
      }
      return url;
    }finally{controllers.delete(controller);}
  }).finally(()=>{if(flights.get(key)===promise)flights.delete(key);});
  flights.set(key,promise);
  return promise;
}
/** Clears volatile objects immediately; persistent cleanup is best-effort and scoped by UID.
 * The call sites must also revoke access by rechecking active authentication/connection. */
export async function clearStorageImageCache(uid?:string,clearDisk=true):Promise<void>{
  generation++;
  for(const controller of controllers)controller.abort();
  controllers.clear();flights.clear();for(const item of queue)item.cancel();queue.splice(0);
  for(const [key,entry] of memory){
    if(uid&&!key.startsWith('["'+uid+'",'))continue;
    URL.revokeObjectURL(entry.url);memory.delete(key);used-=entry.bytes;
  }
  if(!clearDisk)return;
  const db=await openDb();if(!db)return;
  await new Promise<void>(resolve=>{
    try{
      const tx=db.transaction("images","readwrite"),store=tx.objectStore("images");
      const request=store.openCursor();
      request.onsuccess=()=>{
        const cursor=request.result;if(!cursor)return;
        if(!uid||(cursor.value as DiskEntry).uid===uid)cursor.delete();
        cursor.continue();
      };
      tx.oncomplete=()=>resolve();tx.onerror=()=>resolve();tx.onabort=()=>resolve();
    }catch{resolve();}
  });
}
export async function invalidateStorageConnection(uid:string,provider:MediaProvider,connectionId:string):Promise<void>{
  // Reject in-flight results from this grant without disrupting another connected provider.
  const scope=JSON.stringify([uid,provider,connectionId]);
  connectionEpochs.set(scope,(connectionEpochs.get(scope)||0)+1);
  const prefix=JSON.stringify([uid,provider,connectionId]).slice(0,-1)+",";
  for(const [key,entry] of memory){
    if(!key.startsWith(prefix))continue;
    URL.revokeObjectURL(entry.url);memory.delete(key);used-=entry.bytes;
  }
  const db=await openDb();if(!db)return;
  await new Promise<void>(resolve=>{
    try{
      const tx=db.transaction("images","readwrite"),req=tx.objectStore("images").openCursor();
      req.onsuccess=()=>{const cursor=req.result;if(!cursor)return;
        if(String(cursor.key).startsWith(prefix))cursor.delete();cursor.continue();};
      tx.oncomplete=()=>resolve();tx.onerror=()=>resolve();tx.onabort=()=>resolve();
    }catch{resolve();}
  });
}
export async function invalidateStorageFile(identity:MediaIdentity):Promise<void>{
  const prefix=JSON.stringify([identity.uid,identity.provider,identity.connectionId,identity.fileId]).slice(0,-1)+",";
  for(const [key,entry] of memory){
    if(key.startsWith(prefix)){URL.revokeObjectURL(entry.url);memory.delete(key);used-=entry.bytes;}
  }
  const db=await openDb();if(!db)return;
  await new Promise<void>(resolve=>{
    try{const tx=db.transaction("images","readwrite"),req=tx.objectStore("images").openCursor();
      req.onsuccess=()=>{const cursor=req.result;if(!cursor)return;
        if(String(cursor.key).startsWith(prefix))cursor.delete();cursor.continue();};
      tx.oncomplete=()=>resolve();tx.onerror=()=>resolve();tx.onabort=()=>resolve();
    }catch{resolve();}
  });
}
