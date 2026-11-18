import {getAuth} from 'firebase/auth';
import type {Firestore} from 'firebase/firestore';
import {appEnvironment} from '../lib/environment.ts';
import {entryToken,entryRequest,type EntryStage} from './bootstrap-request.ts';

export type ServerField={stringValue?:unknown;integerValue?:unknown;booleanValue?:unknown;timestampValue?:unknown};
export type OwnServerDocument={name:string;fields:Record<string,ServerField>};
/** Recovery-only read. Same user, project and Rules; never administrative access. */
export async function readOwnServerDocument(db:Firestore,uid:string,child?:'access/current'):Promise<OwnServerDocument|null>{
  const auth=getAuth(db.app),user=auth.currentUser,project=appEnvironment.firebase?.projectId;
  if(!user||user.uid!==uid||!project||db.app.options.projectId!==project)throw new Error('Sessão inválida.');
  // A restored SDK listener can still hold old credentials. Refreshing also
  // notifies Firestore's token provider before subsequent workspace queries.
  const token=await entryToken(()=>user.getIdToken(true));
  if(auth.currentUser?.uid!==uid)throw new Error('Sessão alterada.');
  const name='projects/'+project+'/databases/(default)/documents/users/'+encodeURIComponent(uid)+(child?'/'+child:'');
  const origin=appEnvironment.useEmulators?'http://127.0.0.1:8080':'https://firestore.googleapis.com';
  const stage:EntryStage=child?'access-server':'profile-server';
  let document:OwnServerDocument;
  try{document=await entryRequest<OwnServerDocument>(origin+'/v1/'+name,{headers:{Authorization:'Bearer '+token},
    cache:'no-store',credentials:'omit',redirect:'error'},stage,10000);}
  catch(error){
    if(auth.currentUser?.uid!==uid)throw new Error('Sessão alterada.');
    if((error as {status?:number}).status===404)return null;
    throw error;
  }
  if(auth.currentUser?.uid!==uid)throw new Error('Sessão alterada.');
  if(auth.currentUser?.uid!==uid||document?.name!==name||document.fields?.ownerUid?.stringValue!==uid)
    throw new Error('Documento de outra sessão ou projeto.');
  return document;
}
