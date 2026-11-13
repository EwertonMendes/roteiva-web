import {collection,documentId,endAt,getDocsFromServer,limit,orderBy,query,startAfter,startAt} from 'firebase/firestore';
import {firebaseServices} from '../lib/firebase';
export type LibraryProjectChoice={id:number;name:string};
export type LibraryProjectCursor={prefix:string;lastName:string;lastId:string;more:boolean}[];
export type LibraryProjectPage={items:LibraryProjectChoice[];cursor:LibraryProjectCursor|null};
const PER_PREFIX=20;
/** Bounded, owner-scoped Firestore prefix search with real keyset continuation.
 * Legacy project names are case sensitive; queries cover typed and title-case prefixes.
 * We do not scan the collection or fetch every project for a dropdown.
 */
export async function searchLibraryProjectsPage(uid:string,text:string,previous?:LibraryProjectCursor|null):Promise<LibraryProjectPage>{
 const prefix=text.normalize('NFC').trim().slice(0,90);
 if(!uid||prefix.length<2)return {items:[],cursor:null};
 const parts=previous??Array.from(new Set([prefix,prefix.charAt(0).toLocaleUpperCase('pt-BR')+prefix.slice(1)]))
  .slice(0,2).map(p=>({prefix:p,lastName:'',lastId:'',more:true}));
 const {db}=firebaseServices(),base=collection(db,'users',uid,'projects');
 const fetched=await Promise.all(parts.map(async entry=>{
  if(!entry.more)return {entry,docs:[]};
  const constraints=[orderBy('name'),orderBy(documentId()),
   ...(entry.lastId?[startAfter(entry.lastName,entry.lastId)]:[startAt(entry.prefix)]),
   endAt(entry.prefix+'\uf8ff'),limit(PER_PREFIX+1)];
  const result=await getDocsFromServer(query(base,...constraints));
  return {entry,docs:result.docs};
 }));
 const cursor:LibraryProjectCursor=[],all:LibraryProjectChoice[]=[];
 for(const part of fetched){
  const batch=part.docs.slice(0,PER_PREFIX);
  for(const doc of batch){
   const id=Number(doc.id),name=String(doc.data().name||'');
   if(Number.isSafeInteger(id)&&id>0&&name)all.push({id,name});
  }
  const last=batch.at(-1);
  cursor.push({prefix:part.entry.prefix,lastId:last?.id||part.entry.lastId,
   lastName:last?String(last.data().name||''):part.entry.lastName,
   more:part.entry.more&&part.docs.length>PER_PREFIX});
 }
 const deduped=Array.from(new Map(all.map(p=>[p.id,p])).values())
  .sort((a,b)=>a.name.localeCompare(b.name,'pt-BR',{numeric:true,sensitivity:'base'}));
 return {items:deduped,cursor:cursor.some(x=>x.more)?cursor:null};
}
export async function searchLibraryProjects(uid:string,text:string):Promise<LibraryProjectChoice[]>{
 return (await searchLibraryProjectsPage(uid,text)).items;
}
