import assert from 'node:assert/strict';
import {environment,legacyProdFrontendOrigin} from '../shared/environments.ts';

const target=process.argv[2];
assert.ok(['https://roteiva-site-prod.web.app',legacyProdFrontendOrigin].includes(target),
  'Select the exact institutional Hosting origin');
const app=environment('prod').frontendOrigin;
const send=(url)=>fetch(url,{redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(15000)});

for(const path of ['/?billing=return','/projetos/123','/clientes/123','/review','/review/'+'a'.repeat(43)+'?source=legacy']){
  const response=await send(target+path);
  assert.equal(response.status,302,'Expected a temporary redirect');
  assert.equal(response.headers.get('Location'),app+path,'Redirect changed the path or query');
}
for(const path of ['/sobre.html','/suporte.html','/privacidade.html','/termos.html',
  '/googleb5008dcbf685c696.html','/legal.css','/brand/roteiva-wordmark-black.svg','/__/auth/handler']){
  const response=await send(target+path);
  assert.equal(response.status,200,path);
  assert.doesNotMatch(await response.text(),/<div id="root">/i,path+' served the SPA');
}
assert.equal((await send(target+'/__probe-not-found')).status,404,'Unknown URL');
if(target===legacyProdFrontendOrigin){
  const response=await send('https://www.roteiva.com/review?source=legacy');
  assert.equal(response.status,301);
  assert.equal(response.headers.get('Location'),target+'/review?source=legacy');
}
console.log('Verified institutional redirects, public documents, verification and Firebase handler at '+target);
