import {test as base} from '@playwright/test';
export {expect,type Page} from '@playwright/test';

// Emulator identities must never call the real DEV service. Individual tests
// may override this default route to exercise processing/failure/completion.
export const test=base.extend<{deletionService:void}>({
  deletionService:[async({page},use)=>{
    await page.route('https://roteiva-api-dev.ewertonmendes9.workers.dev/account/deletion/status',async route=>{
      const headers={'Access-Control-Allow-Origin':'http://127.0.0.1:4173',
        'Access-Control-Allow-Methods':'GET, OPTIONS',
        'Access-Control-Allow-Headers':'Authorization, Content-Type'};
      await route.fulfill(route.request().method()==='OPTIONS'?{status:204,headers}:{status:200,headers,
        contentType:'application/json',body:JSON.stringify({available:true,operation:null})});
    });
    await use();
  },{auto:true}],
});
