import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPair,SignJWT,exportJWK,createLocalJWKSet} from 'jose';
import {environments} from '../../shared/environments.ts';
import {assertEnvironment,assertDatabaseEnvironment} from '../src/environment.ts';
import {applyResponsePolicy} from '../src/response-policy.ts';
import {verifyFirebase} from '../src/auth.ts';
import {database} from './helpers/database.mjs';
import {handle,default as worker} from '../src/index.ts';
for(const name of ['dev','prod'])test(name+' rejects cross-environment configuration, D1 and PDF origins',async(t)=>{
  const contract=environments[name];
  const env={ENVIRONMENT:name,FIREBASE_PROJECT_ID:contract.projectId,FRONTEND_ORIGIN:contract.frontendOrigin,
    OAUTH_REDIRECT_URI:contract.apiOrigin+'/oauth/drive/callback',DROPBOX_ENABLED:'true',DROPBOX_OAUTH_REDIRECT_URI:contract.apiOrigin+'/oauth/dropbox/callback'};
  assert.doesNotThrow(()=>assertEnvironment(env));
  const other=environments[name==='dev'?'prod':'dev'];
  for(const patch of [{ENVIRONMENT:''},{FIREBASE_PROJECT_ID:other.projectId},{FRONTEND_ORIGIN:other.frontendOrigin},
    {OAUTH_REDIRECT_URI:other.apiOrigin+'/oauth/drive/callback'}, {DROPBOX_OAUTH_REDIRECT_URI:other.apiOrigin+'/oauth/dropbox/callback'}])
    assert.throws(()=>assertEnvironment({...env,...patch}),e=>e.code==='invalid_environment');
  const db=database();t.after(db.close);
  // Fixture is sealed DEV. This must never be inferred or rewritten by runtime.
  await (name==='dev'?assertDatabaseEnvironment({...env,DB:db.DB}):assert.rejects(()=>assertDatabaseEnvironment({...env,DB:db.DB})));
  const pdf=()=>new Response('synthetic',{headers:{'Content-Type':'application/pdf'}});
  assert.match(applyResponsePolicy(pdf(),'/reviews/media',env.FRONTEND_ORIGIN).headers.get('Content-Security-Policy'),new RegExp('frame-ancestors '+env.FRONTEND_ORIGIN));
  assert.match(applyResponsePolicy(pdf(),'/reviews/media','https://evil.example').headers.get('Content-Security-Policy'),/frame-ancestors 'none'/);
  assert.match(applyResponsePolicy(pdf(),'/unrelated',env.FRONTEND_ORIGIN).headers.get('Content-Security-Policy'),/frame-ancestors 'none'/);
  if(name==='prod'){
    const result=await handle(new Request(contract.apiOrigin+'/health'),{...env,DB:db.DB,API_RATE_LIMIT:{limit:async()=>({success:true})}});
    assert.equal(result.status,503);
    let task;worker.scheduled({cron:'* * * * *'},{...env,DB:db.DB},{waitUntil:p=>task=p});
    await assert.rejects(task,e=>e.code==='invalid_database_environment');
  }
});
test('database identity cannot be changed, deleted, duplicated or omitted',async(t)=>{
  const db=database();t.after(db.close);
  assert.throws(()=>db.sql.exec("UPDATE deployment_identity SET environment='prod'"));
  assert.throws(()=>db.sql.exec('DELETE FROM deployment_identity'));
  assert.throws(()=>db.sql.exec("INSERT INTO deployment_identity VALUES(2,'prod')"));
  await assert.rejects(()=>assertDatabaseEnvironment({ENVIRONMENT:'prod',DB:db.DB}));
});
test('edge rate limiting rejects abuse before any D1 query',async()=>{
 let reads=0;
 const env={ENVIRONMENT:'dev',FIREBASE_PROJECT_ID:environments.dev.projectId,FRONTEND_ORIGIN:environments.dev.frontendOrigin,
  OAUTH_REDIRECT_URI:environments.dev.apiOrigin+'/oauth/drive/callback',
  API_RATE_LIMIT:{limit:async()=>({success:false})},API_THUMB_LIMIT:{limit:async()=>({success:false})},
  DB:{prepare(){reads++;throw new Error('Rate-limited requests must not touch D1');}}};
 for(const path of ['/health','/integrations/drive','/reviews/media']){
  assert.equal((await handle(new Request(environments.dev.apiOrigin+path),env)).status,429);
 }
 assert.equal(reads,0);
});
test('signed Firebase DEV and PROD tokens are mutually rejected',async()=>{
  const {privateKey,publicKey}=await generateKeyPair('RS256');
  const jwk=await exportJWK(publicKey);jwk.kid='environment-test';const keys=createLocalJWKSet({keys:[jwk]});
  for(const name of ['dev','prod']){
    const project=environments[name].projectId,other=environments[name==='dev'?'prod':'dev'].projectId;
    const jwt=await new SignJWT({auth_time:Math.floor(Date.now()/1000)}).setProtectedHeader({alg:'RS256',kid:jwk.kid})
      .setSubject('synthetic-user').setIssuer('https://securetoken.google.com/'+project).setAudience(project).setIssuedAt().setExpirationTime('5m').sign(privateKey);
    assert.equal(await verifyFirebase(jwt,project,keys),'synthetic-user');
    await assert.rejects(()=>verifyFirebase(jwt,other,keys));
  }
});
