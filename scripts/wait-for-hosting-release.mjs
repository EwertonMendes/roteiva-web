import {setTimeout as sleep} from 'node:timers/promises';

// Firebase can report a successful release before every CDN edge serves it.
// Retry the complete smoke and surface the final failure when the budget ends.
export async function waitForHostingRelease(verify,{delaysMs=[1000,3000,8000,16000],pause=sleep}={}){
  for(const delay of delaysMs){
    try{return await verify();}
    catch{await pause(delay);}
  }
  return verify();
}
