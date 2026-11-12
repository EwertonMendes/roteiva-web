import {collection,documentId,endAt,getDocsFromServer,limit,orderBy,query,startAt} from 'firebase/firestore';
import {firebaseServices} from '../lib/firebase';
export type LibraryProjectChoice={id:number;name:string};
/** Owner-scoped, bounded Firestore lookup; UI never directly reads collections.
 * The legacy name field is case-sensitive, so try the entered and title-case prefix.
 */
export async function searchLibraryProjects(uid:string,text:string):Promise<LibraryProjectChoice[]>{
 const prefix=text.normalize('NFC').trim().slice(0,90);
 if(!uid||prefix.length<2)return [];
 const variants=Array.from(new Set([prefix,prefix.charAt(0).toLocaleUpperCase('pt-BR')+prefix.slice(1)])).slice(0,2);
 const {db}=firebaseServices(),base=collection(db,'users',uid,'projects');
 const snapshots=await Promise.all(variants.map(p=>getDocsFromServer(query(base,orderBy('name'),orderBy(documentId()),
  startAt(p),endAt(p+'\uf8ff'),limit(35)))));
 return Array.from(new Map(snapshots.flatMap(batch=>batch.docs.map(d=>({id:Number(d.id),name:String(d.data().name||'')})))
  .filter(p=>Number.isSafeInteger(p.id)&&p.id>0&&p.name).map(p=>[p.id,p])).values());
}
