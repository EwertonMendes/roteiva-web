import type {Firestore} from 'firebase/firestore';
import {FirestoreWorkspace,readProfile,type RoteivaProfile} from './firestore-workspace.ts';
import {readOwnServerDocument} from './firestore-server-read.ts';
import {readConfirmedProfile} from './profile-read.ts';

export function loadRegistrationProfile(db:Firestore,uid:string,repository:FirestoreWorkspace):Promise<RoteivaProfile|null>{
  return readConfirmedProfile(()=>repository.loadProfile(),async()=>{
    const document=await readOwnServerDocument(db,uid);
    if(!document)return null;
    const f=document.fields,revision=Number(f.revision?.integerValue);
    if(f.schemaVersion?.integerValue!=='1'||!Number.isSafeInteger(revision)||revision<1)throw new Error('Cadastro inválido.');
    return readProfile({displayName:f.displayName?.stringValue,studioName:f.studioName?.stringValue,
      professionalType:f.professionalType?.stringValue,revision,
      registrationCompletedAt:f.registrationCompletedAt,deletionState:f.deletionState?.stringValue});
  });
}
