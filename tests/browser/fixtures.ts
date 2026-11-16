import {test as base,type Route} from '@playwright/test';
import {initializeTestEnvironment} from '@firebase/rules-unit-testing';
import {doc,getDoc,setDoc,Timestamp} from 'firebase/firestore';
export {expect,type Page} from '@playwright/test';

const emulatorApi='http://127.0.0.1:8787/access/ensure';
const allowOrigin='http://127.0.0.1:4173';

// The exact same entitlement provisioning must be used by every browser tab.
// A bare 200 response would falsely claim that a new tab was authorized without
// creating the document required by Firestore Rules.
export async function fulfillEmulatorAccessEnsure(route:Route):Promise<void>{
  const headers={'Access-Control-Allow-Origin':allowOrigin,
    'Access-Control-Allow-Methods':'POST, OPTIONS',
    'Access-Control-Allow-Headers':'Authorization, Content-Type'};
  if(route.request().method()==='OPTIONS'){
    await route.fulfill({status:204,headers});return;
  }
  const auth=route.request().headers().authorization||'';
  let uid='';
  try{uid=JSON.parse(Buffer.from(auth.slice(7).split('.')[1],'base64url').toString()).sub;}
  catch{await route.fulfill({status:401,headers,body:'{}'});return;}
  if(!/^[A-Za-z0-9_-]{1,128}$/.test(uid)){
    await route.fulfill({status:401,headers,body:'{}'});return;
  }
  const environment=await initializeTestEnvironment({projectId:'demo-roteiva',firestore:{host:'127.0.0.1',port:8080}});
  try{
    await environment.withSecurityRulesDisabled(async context=>{
      const ref=doc(context.firestore(),'users',uid,'access','current');
      const existing=await getDoc(ref);
      if(!existing.exists()){
        const end=Timestamp.fromMillis(Date.now()+604800000);
        await setDoc(ref,{ownerUid:uid,schemaVersion:1,source:'trial',
          suspended:false,unlimited:false,trialEndsAt:end,accessUntil:end,
          updatedAt:Timestamp.now()});
      }
    });
  }finally{await environment.cleanup();}
  await route.fulfill({status:200,headers,contentType:'application/json',body:'{}'});
}

// Emulator identities must never call the real DEV service. Individual tests
// may override this default route to exercise processing/failure/completion.
export const test=base.extend<{deletionService:void}>({
  deletionService:[async({page},use)=>{
    await page.route('http://127.0.0.1:8787/account/deletion/status',async route=>{
      const headers={'Access-Control-Allow-Origin':allowOrigin,
        'Access-Control-Allow-Methods':'GET, OPTIONS',
        'Access-Control-Allow-Headers':'Authorization, Content-Type'};
      await route.fulfill(route.request().method()==='OPTIONS'?{status:204,headers}:{status:200,headers,
        contentType:'application/json',body:JSON.stringify({available:true,operation:null})});
    });
    await page.route(emulatorApi,fulfillEmulatorAccessEnsure);
    await use();
  },{auto:true}],
});
