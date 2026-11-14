import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {parseEnvironment} from '../src/lib/environment-config.ts';
import {environments} from '../shared/environments.ts';
import {canonicalFrontendUrl} from '../src/lib/canonical-frontend.ts';
const config=(env)=>({VITE_APP_MODE:'firebase',VITE_APP_ENV:env,VITE_USE_EMULATORS:'false',
  VITE_API_BASE_URL:environments[env].apiOrigin,VITE_FIREBASE_PROJECT_ID:environments[env].projectId,
  VITE_FIREBASE_AUTH_DOMAIN:environments[env].authDomain,VITE_FIREBASE_API_KEY:'synthetic',
  VITE_FIREBASE_APP_ID:'1:123:web:synthetic',VITE_FIREBASE_MESSAGING_SENDER_ID:'123'});

test('old PROD links move to the canonical domain without changing route, query or fragment',()=>{
  for(const origin of environments.prod.frontendAliases){
    assert.equal(canonicalFrontendUrl(origin+'/review/synthetic?drive=connected#section','prod'),
      'https://roteiva.com/review/synthetic?drive=connected#section');
    assert.equal(new URL(canonicalFrontendUrl(origin+'//evil.example/?next=https://evil.example','prod')).origin,'https://roteiva.com');
    for(const mode of ['dev','demo','emulator',undefined])assert.equal(canonicalFrontendUrl(origin+'/biblioteca',mode),null);
  }
  for(const href of ['https://roteiva.com/biblioteca','https://www.roteiva.com/','https://evil.example/',environments.dev.frontendOrigin])
    assert.equal(canonicalFrontendUrl(href,'prod'),null);
});

for(const env of ['dev','prod']) test(env+' configuration rejects missing and crossed values',()=>{
  const valid=config(env),mode=env==='dev'?'firebase':'production';
  assert.equal(parseEnvironment(valid,mode).appEnv,env);
  for(const key of Object.keys(valid)) assert.throws(()=>parseEnvironment({...valid,[key]:undefined},mode),key);
  const other=config(env==='dev'?'prod':'dev');
  for(const key of ['VITE_API_BASE_URL','VITE_FIREBASE_PROJECT_ID','VITE_FIREBASE_AUTH_DOMAIN'])
    assert.throws(()=>parseEnvironment({...valid,[key]:other[key]},mode),key);
  for(const key of ['VITE_API_BASE_URL','VITE_FIREBASE_AUTH_DOMAIN']) {
    for(const value of ['https://evil.example','https://roteiva-api-dev.ewertonmendes9.workers.dev','https://user:pass@example.com','https://example.com/path'])
      assert.throws(()=>parseEnvironment({...valid,[key]:value},mode));
  }
  assert.throws(()=>parseEnvironment(valid,env==='dev'?'production':'firebase'));
});
test('demo and emulator stay explicit and isolated',()=>{
  assert.equal(parseEnvironment({VITE_APP_MODE:'demo',VITE_APP_ENV:'demo'},'demo').firebase,undefined);
  assert.throws(()=>parseEnvironment({VITE_APP_MODE:'demo',VITE_APP_ENV:'demo'},'production'));
  const emulator={...config('dev'),VITE_APP_ENV:'emulator',VITE_USE_EMULATORS:'true',
    VITE_FIREBASE_PROJECT_ID:'demo-roteiva',VITE_FIREBASE_AUTH_DOMAIN:'demo-roteiva.firebaseapp.com',VITE_API_BASE_URL:undefined};
  assert.equal(parseEnvironment(emulator,'emulator').apiBaseUrl,'http://127.0.0.1:8787');
  assert.throws(()=>parseEnvironment({...emulator,VITE_API_BASE_URL:environments.dev.apiOrigin},'emulator'));
  assert.throws(()=>parseEnvironment({...emulator,VITE_FIREBASE_PROJECT_ID:environments.dev.projectId},'emulator'));
});
test('runtime source has no personal infrastructure endpoints',()=>{
  function walk(path){for(const entry of readdirSync(path,{withFileTypes:true})){
    const full=path+'/'+entry.name;if(entry.isDirectory())walk(full);
    else if(/\.(ts|tsx|css|svg|html)$/.test(full)) assert.doesNotMatch(readFileSync(full,'utf8'),/https?:[^\s'"<>]*ewertonmendes/i,full);
  }}
  for(const path of ['src','api/src','public'])walk(path);
});


test('production virtual library and owner-confirmed release target are configured consistently',()=>{
  const worker=JSON.parse(readFileSync('api/wrangler.jsonc','utf8'));
  assert.equal(worker.env.prod.vars.VIRTUAL_LIBRARY_ENABLED,'true');
  assert.equal(worker.env.prod.vars.FIREBASE_PROJECT_ID,'roteiva-web-prod');
  const web=readFileSync('.env.production','utf8');
  assert.match(web,/^VITE_VIRTUAL_LIBRARY=true$/m);
  const release=readFileSync('.github/workflows/production.yml','utf8');
  assert.match(release,/VITE_VIRTUAL_LIBRARY: 'true'/);
  assert.match(release,/inputs\.confirmation == 'DEPLOY ROTEIVA PROD'/);
  assert.match(release,/test "\$GITHUB_ACTOR" = "\$GITHUB_REPOSITORY_OWNER"/);
  assert.match(release,/test "\$APPROVED_SHA" = "\$GITHUB_SHA"/);
  assert.match(release,/environment: cloudflare-production/);
  assert.match(release,/environment: firebase-production/);
});
