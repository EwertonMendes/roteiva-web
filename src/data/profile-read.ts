import {firestoreCode} from './firestore-recovery.ts';
import {entryDeadline} from './bootstrap-request.ts';
import type {RoteivaProfile} from './firestore-workspace.ts';

/** Confirm a missing/unauthorized initial SDK read using the same user's fresh
 * credentials. Real server denial still rejects; never synthesize a profile.
 */
export async function readConfirmedProfile(
  readSdk:()=>Promise<RoteivaProfile|null>,readServer:()=>Promise<RoteivaProfile|null>,
  options:{sdkTimeoutMs?:number;serverTimeoutMs?:number}={},
):Promise<RoteivaProfile|null>{
  try{const profile=await entryDeadline(readSdk,'profile-sdk',options.sdkTimeoutMs??8000);if(profile)return profile;}
  catch(error){
    // A fresh owner-scoped REST read is safe when SDK cache initialization or
    // Auth token propagation fails. The same Firebase ID token and Firestore
    // Rules apply; a real denial is NEVER treated as a missing profile.
    const recoverable=['permission-denied','unauthenticated','failed-precondition',
      'unimplemented','internal','unavailable','deadline-exceeded','aborted'];
    if(!recoverable.includes(firestoreCode(error)))throw error;
  }
  return entryDeadline(readServer,'profile-server',options.serverTimeoutMs??20000);
}
