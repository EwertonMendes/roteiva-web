import type {DriveItem} from "./DriveLibraryUI";

export type StorageProvider="google_drive"|"dropbox";
export type CachedFolder={
  files:DriveItem[];
  nextPageToken:string|null;
  fetchedAt:number;
  /** Only valid for a completely enumerated Dropbox folder, never search or partial pages. */
  syncCursor?:string|null;
  complete?:boolean;
};
/** Private, bounded in-memory metadata only; never persisted in browser or Worker storage. */
const MAX_ENTRIES=32;
const entries=new Map<string,CachedFolder>();
const flights=new Map<string,Promise<unknown>>();

export function cacheKey(uid:string,account:string,folder:string,search="",page="",provider:StorageProvider="google_drive"){
  return JSON.stringify([provider,uid,account,folder,search,page]);
}
export function getCachedFolder(key:string):CachedFolder|undefined{
  const result=entries.get(key);
  if(result){entries.delete(key);entries.set(key,result);}
  return result;
}
export function setCachedFolder(key:string,folder:Omit<CachedFolder,"fetchedAt">){
  entries.delete(key);
  entries.set(key,{...folder,fetchedAt:Date.now()});
  while(entries.size>MAX_ENTRIES)entries.delete(entries.keys().next().value!);
}
/** Prevent duplicate network calls when the user revisits an in-flight folder. */
export function onceFolderRequest<T>(key:string,fetcher:()=>Promise<T>):Promise<T>{
  const existing=flights.get(key);
  if(existing)return existing as Promise<T>;
  const result=fetcher().finally(()=>{if(flights.get(key)===result)flights.delete(key);});
  flights.set(key,result);
  return result;
}
export function clearStorageFolderCache(provider?:StorageProvider,uid?:string,account?:string){
  for(const key of entries.keys()){
    try{
      const parts=JSON.parse(key) as string[];
      if((!provider||parts[0]===provider)&&(!uid||parts[1]===uid)&&(!account||parts[2]===account))
        entries.delete(key);
    }catch{entries.delete(key);}
  }
}
export function invalidateStorageFolderCache(provider:StorageProvider,uid:string,account:string,folder:string){
  for(const key of entries.keys()){
    try{
      const parts=JSON.parse(key) as string[];
      if(parts[0]===provider&&parts[1]===uid&&parts[2]===account&&parts[3]===folder)entries.delete(key);
    }catch{entries.delete(key);}
  }
}
export function clearDriveFolderCache(){clearStorageFolderCache("google_drive");}
export function invalidateDriveFolderCache(uid:string,account:string,folder:string){
  invalidateStorageFolderCache("google_drive",uid,account,folder);
}
