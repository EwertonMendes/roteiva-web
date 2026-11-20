import assert from 'node:assert/strict';
import {environment,legacyProdFrontendOrigin} from '../shared/environments.ts';
import {waitForHostingRelease} from './wait-for-hosting-release.mjs';

const config=environment('prod');
const origin=config.frontendOrigin;
const preflight=process.argv.includes('--before-deploy');
const send=(url)=>fetch(url,{redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(15000)});

async function verify(){
  const response=await send(origin+'/roteiva-build.json');
  assert.equal(response.status,200,'App build manifest');
  const identity=await response.json();
  assert.equal(identity.environment,'prod');
  assert.equal(identity.projectId,config.projectId);
  assert.equal(identity.apiOrigin,config.apiOrigin);
  assert.match(identity.sha,/^[a-f0-9]{40}$/,'Live application SHA');
  if(!preflight){
    assert.equal(identity.authDomain,config.authDomain);
    if(process.env.GITHUB_SHA)assert.equal(identity.sha,process.env.GITHUB_SHA,'Live application SHA');
  }

  for(const host of [origin,legacyProdFrontendOrigin]){
    const handler=await send(host+'/__/auth/handler');
    assert.equal(handler.status,200,'Firebase handler at '+host);
    const body=await handler.text();
    assert.match(body,/firebase/i);
    assert.doesNotMatch(body,/<div id="root">/i,'Auth handler received the React SPA');
  }
  return identity;
}
const identity=await (preflight?verify():waitForHostingRelease(verify));
console.log('Verified the live app identity and new and legacy Firebase Auth handlers. App SHA: '+identity.sha);
