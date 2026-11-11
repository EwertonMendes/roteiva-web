import {firestoreCode} from './firestore-recovery.ts';
import type {RoteivaProfile} from './firestore-workspace.ts';

/** Confirm a missing/unauthorized initial SDK read using the same user's fresh
 * credentials. Real server denial still rejects; never synthesize a profile.
 */
export async function readConfirmedProfile(
  readSdk:()=>Promise<RoteivaProfile|null>,readServer:()=>Promise<RoteivaProfile|null>,
):Promise<RoteivaProfile|null>{
  try{const profile=await readSdk();if(profile)return profile;}
  catch(error){if(!['permission-denied','unauthenticated'].includes(firestoreCode(error)))throw error;}
  return readServer();
}
