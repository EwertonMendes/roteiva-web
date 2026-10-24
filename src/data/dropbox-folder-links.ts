import {collection,deleteDoc,doc,getDocs,query,where,serverTimestamp,setDoc} from 'firebase/firestore';
import {firebaseServices} from '../lib/firebase';
export type DropboxFolderLink = {id:string;provider:'dropbox';projectId:number;connectionId:string;folderId:string;folderName:string};
const collectionName='dropboxFolders';
const folderId=/^(id:[A-Za-z0-9_-]{8,200}|root)$/;
const connectionId=/^[0-9a-f-]{36}$/i;
export const dropboxFolderLinkId=(projectId:number,connection:string,folder:string)=>
  projectId+'_'+connection+'_'+folder;
export async function readDropboxLinks(uid:string,projectId?:number):Promise<DropboxFolderLink[]>{
 const source=collection(firebaseServices().db,'users',uid,collectionName);
 const snap=await getDocs(projectId===undefined?source:query(source,where('projectId','==',projectId)));
 return snap.docs.map(entry=>{
  const d=entry.data();
  if(typeof d.folderId!=='string'||!folderId.test(d.folderId)||
     typeof d.connectionId!=='string'||!connectionId.test(d.connectionId))
    throw new Error('Vínculo de pasta Dropbox inválido.');
  return {id:entry.id,provider:'dropbox',projectId:Number(d.projectId),
   connectionId:d.connectionId,folderId:d.folderId,folderName:String(d.folderName)};
 });
}
export async function linkDropboxFolder(uid:string,projectId:number,account:string,folder:{id:string;name:string}):Promise<void>{
 if(!Number.isSafeInteger(projectId)||projectId<=0||!connectionId.test(account)||
    !folderId.test(folder.id)||!folder.name.trim()||folder.name.length>250)
  throw new Error('Selecione uma pasta válida do Dropbox.');
 const id=dropboxFolderLinkId(projectId,account,folder.id);
 await setDoc(doc(firebaseServices().db,'users',uid,collectionName,id),{
  ownerUid:uid,schemaVersion:1,projectId,connectionId:account,
  folderId:folder.id,folderName:folder.name.trim(),createdAt:serverTimestamp()
 });
}
export async function unlinkDropboxFolder(uid:string,id:string):Promise<void>{
 if(!/^[0-9]+_[0-9a-f-]{36}_(?:id:[A-Za-z0-9_-]{8,200}|root)$/i.test(id))throw new Error('Vínculo inválido.');
 await deleteDoc(doc(firebaseServices().db,'users',uid,collectionName,id));
}
