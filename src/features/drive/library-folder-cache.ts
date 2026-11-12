/** Private, bounded virtual folder snapshots; metadata only. Never stores tokens or content bytes. */
export type LibraryFolderPage<T>={scope:string;nodes:T[];trail:{id:string;name:string}[];nextPage:string|null;fetchedAt:number};
const LIMIT=64,MAX_AGE=60_000,REVALIDATE=30_000;
const pages=new Map<string,LibraryFolderPage<unknown>>();
const flights=new Map<string,Promise<unknown>>();
export function libraryFolderKey(uid:string,project:number,folder:string,trash:boolean,term:string,searchAll:boolean){
 return JSON.stringify([uid,project,folder,trash,term,searchAll]);
}
export function getLibraryFolder<T>(key:string):{data:LibraryFolderPage<T>;stale:boolean}|null{
 const page=pages.get(key);if(!page)return null;
 if(Date.now()-page.fetchedAt>MAX_AGE){pages.delete(key);return null;}
 pages.delete(key);pages.set(key,page);
 return {data:page as LibraryFolderPage<T>,stale:Date.now()-page.fetchedAt>REVALIDATE};
}
export function setLibraryFolder<T>(key:string,page:Omit<LibraryFolderPage<T>,'fetchedAt'>){
 pages.delete(key);pages.set(key,{...page,fetchedAt:Date.now()});
 while(pages.size>LIMIT)pages.delete(pages.keys().next().value!);
}
export function libraryFolderFlight<T>(key:string,work:()=>Promise<T>):Promise<T>{
 const existing=flights.get(key);if(existing)return existing as Promise<T>;
 const result=work().finally(()=>{if(flights.get(key)===result)flights.delete(key);});
 flights.set(key,result);return result;
}
export function invalidateLibraryFolders(uid:string,project:number){
 for(const key of pages.keys())try{const a=JSON.parse(key) as unknown[];if(a[0]===uid&&a[1]===project)pages.delete(key);}catch{pages.delete(key);}
}
export function clearLibraryFolders(uid?:string){
 for(const key of pages.keys())try{if(!uid||(JSON.parse(key) as unknown[])[0]===uid)pages.delete(key);}catch{pages.delete(key);}
}
