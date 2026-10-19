import type {DriveItem} from "./DriveLibraryUI";

export type CachedFolder={
  files:DriveItem[];nextPageToken:string|null;fetchedAt:number;
};
/** Short-lived, user/account/folder-scoped metadata. Never stored in localStorage or IndexedDB. */
const MAX_FOLDERS=24;
const entries=new Map<string,CachedFolder>();
export function cacheKey(uid:string,account:string,folder:string,search="",page=""){
  return JSON.stringify([uid,account,folder,search,page]);
}
export function getCachedFolder(key:string):CachedFolder|undefined {
  const result=entries.get(key);
  if(result){entries.delete(key);entries.set(key,result);}
  return result;
}
export function setCachedFolder(key:string,folder:Omit<CachedFolder,"fetchedAt">){
  entries.delete(key);
  entries.set(key,{...folder,fetchedAt:Date.now()});
  while(entries.size>MAX_FOLDERS)entries.delete(entries.keys().next().value!);
}
export function clearDriveFolderCache(){
  entries.clear();
}
