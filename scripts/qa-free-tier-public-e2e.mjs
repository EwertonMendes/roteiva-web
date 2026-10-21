/** Temporary real-network Chromium E2E smoke, no Firebase emulators and no test credentials.
 * This intentionally cannot validate authenticated customer data or Google Drive grants.
 */
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
const root='https://roteiva-web-dev.web.app';
const browser=await chromium.launch({headless:true});
try{
  for(const viewport of [{width:1366,height:768},{width:390,height:844}]){
    const page=await browser.newPage({viewport});
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    const response=await page.goto(root,{waitUntil:'domcontentloaded',timeout:30000});
    assert.equal(response?.status(),200);
    await page.locator('#root').waitFor({state:'visible',timeout:15000});
    await page.waitForTimeout(1200);
    const visible=await page.locator('#root').innerText();
    assert.ok(visible.length>20,'Real DEV sign-in page must render');
    assert.equal(errors.length,0,'No uncaught frontend errors on public page: '+errors.join(';'));
    console.log(JSON.stringify({check:'anonymous_browser',viewport:viewport.width,renderedCharacters:visible.length,uncaughtErrors:errors.length}));
    await page.close();
  }
}finally{await browser.close();}
