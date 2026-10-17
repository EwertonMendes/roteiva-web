import { collection, deleteDoc, doc, getDocsFromServer, serverTimestamp, setDoc } from 'firebase/firestore';
import {firebaseServices} from '../lib/firebase';

export type DriveFolderLink = {
  id:string; projectId:number; connectionId:string; folderId:string; folderName:string;
};
const collectionName='driveFolders';
export const driveFolderLinkId=(projectId:number,connectionId:string,folderId:string)=>
  projectId+'_'+connectionId+'_'+folderId;

export async function readDriveLinks(uid:string):Promise<DriveFolderLink[]>{
  const snap=await getDocsFromServer(collection(firebaseServices().db,'users',uid,collectionName));
  return snap.docs.map(entry=>{
    const data=entry.data();
    return {
      id:entry.id,projectId:Number(data.projectId),connectionId:String(data.connectionId),
      folderId:String(data.folderId),folderName:String(data.folderName),
    };
  });
}

export async function linkDriveFolder(uid:string, projectId:number, connectionId:string, folder:{id:string;name:string}):Promise<void>{
  if(!Number.isSafeInteger(projectId)||projectId<=0)throw new Error('Selecione um projeto.');
  if(!/^[a-zA-Z0-9-]{36}$/.test(connectionId)||!/^[A-Za-z0-9_-]{10,200}$/.test(folder.id)||
    !folder.name.trim()||folder.name.length>250)throw new Error('Pasta inválida.');
  const id=driveFolderLinkId(projectId,connectionId,folder.id);
  await setDoc(doc(firebaseServices().db,'users',uid,collectionName,id),{
    ownerUid:uid,schemaVersion:1,projectId,connectionId,
    folderId:folder.id,folderName:folder.name.trim(),createdAt:serverTimestamp(),
  });
}
export async function unlinkDriveFolder(uid:string,id:string):Promise<void>{
  if(!/^[0-9]+_[a-zA-Z0-9-]{36}_[A-Za-z0-9_-]{10,200}$/.test(id))throw new Error('Vínculo inválido.');
  await deleteDoc(doc(firebaseServices().db,'users',uid,collectionName,id));
}
