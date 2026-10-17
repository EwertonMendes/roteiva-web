import test from 'node:test';
import assert from 'node:assert/strict';
import {persistDriveConsent} from '../src/consent.ts';
import {base64url, decrypt, context} from '../src/crypto.ts';
import {DRIVE_SCOPE} from '../src/google.ts';

function makeEnv(existing = null) {
  const writes=[];
  const DB={prepare(sql) {
    if(sql.startsWith('SELECT encrypted_refresh_token')) return {
      bind:(uid,account)=>({first:async()=> uid==='user-A' && account==='google-A'?existing:null})
    };
    if(sql.startsWith('INSERT INTO drive_connections')) return {
      bind:(...values)=>({run:async()=>{writes.push(values);return {meta:{changes:1}};}})
    };
    throw new Error('Unexpected database statement');
  }};
  const env={
    DB, ENVIRONMENT:'dev', TOKEN_KEY_VERSION:'v1',
    TOKEN_KEYS:JSON.stringify({v1:base64url(crypto.getRandomValues(new Uint8Array(32)))}),
  };
  return {env,writes};
}
const identity={sub:'google-A',email:'a@example.com'};
const grant=(overrides={})=>({
  access_token:'example-access',refresh_token:'example-refresh',
  token_type:'Bearer',expires_in:3600,...overrides,
});
function driveOK() {
  return async(url,options)=>{
    assert.equal(new URL(url).origin,'https://www.googleapis.com');
    assert.equal(new URL(url).pathname,'/drive/v3/about');
    assert.equal(new URL(url).searchParams.get('fields'),'user(emailAddress)');
    assert.equal(options.headers.Authorization,'Bearer example-access');
    return Response.json({user:{emailAddress:'a@example.com'}});
  };
}

test('Google code response missing optional scope is confirmed with real Drive endpoint contract',async()=>{
  const {env,writes}=makeEnv();
  await persistDriveConsent(env,'user-A',grant(),identity,driveOK());
  assert.equal(writes.length,1);
  assert.equal(writes[0][1],'user-A');
  assert.equal(writes[0][2],'google-A');
  assert.equal(writes[0][5],DRIVE_SCOPE);
  assert.ok(!writes[0][4].includes('example-refresh'));
  assert.equal(await decrypt(env,writes[0][4],context(env,'user-A','google-A')),'example-refresh');
});

test('Google code response with correct scope succeeds and never persists access token',async()=>{
  const {env,writes}=makeEnv();
  await persistDriveConsent(env,'user-A',grant({scope:'openid email '+DRIVE_SCOPE}),identity,driveOK());
  assert.equal(writes.length,1);
  assert.equal(JSON.stringify(writes).includes('example-access'),false);
});

test('explicitly missing Drive scope and denied Drive access refuse persistence',async()=>{
  const {env,writes}=makeEnv();
  await assert.rejects(
    ()=>persistDriveConsent(env,'user-A',grant({scope:'openid email'}),identity,
      async()=>{throw new Error('Drive must never be called');}),
    e=>e.code==='drive_permission_missing'
  );
  await assert.rejects(
    ()=>persistDriveConsent(env,'user-A',grant({scope:DRIVE_SCOPE}),identity,
      async()=>Response.json({error:'insufficientPermissions'},{status:403})),
    e=>e.code==='drive_permission_missing'
  );
  assert.equal(writes.length,0);
});

test('first connection without offline refresh token gives a distinct, actionable failure',async()=>{
  const {env,writes}=makeEnv();
  await assert.rejects(
    ()=>persistDriveConsent(env,'user-A',grant({refresh_token:undefined,scope:DRIVE_SCOPE}),identity,driveOK()),
    e=>e.code==='offline_access_unavailable'
  );
  assert.equal(writes.length,0);
});

test('re-authorization without new refresh token preserves existing encrypted credential for same owner/account',async()=>{
  const {env:source}=makeEnv();
  const {encrypt}=await import('../src/crypto.ts');
  const previous=await encrypt(source,'original-refresh',context(source,'user-A','google-A'));
  const {env,writes}=makeEnv({status:'connected',encrypted_refresh_token:previous});
  await persistDriveConsent(env,'user-A',grant({refresh_token:undefined,scope:DRIVE_SCOPE}),identity,driveOK());
  assert.equal(writes[0][4],previous);
  assert.equal(writes[0][1],'user-A');
  assert.equal(writes[0][2],'google-A');
  await assert.rejects(
    ()=>persistDriveConsent(env,'user-B',grant({refresh_token:undefined,scope:DRIVE_SCOPE}),identity,driveOK()),
    e=>e.code==='offline_access_unavailable'
  );
  assert.equal(writes.length,1);
});

test('revocation-pending connection never silently reuses a refresh token',async()=>{
  const {env,writes}=makeEnv({status:'revocation_pending',encrypted_refresh_token:'existing-ciphertext'});
  await assert.rejects(
    ()=>persistDriveConsent(env,'user-A',grant({refresh_token:undefined}),identity,driveOK()),
    e=>e.code==='offline_access_unavailable'
  );
  assert.equal(writes.length,0);
});

test('Google Drive outage or malformed response fails closed without saving refresh token',async()=>{
  const {env,writes}=makeEnv();
  for(const response of [
    async()=>Response.json({error:'unavailable'},{status:503}),
    async()=>Response.json({irrelevant:true}),
    async()=>{throw new Error('timeout');},
  ]){
    await assert.rejects(
      ()=>persistDriveConsent(env,'user-A',grant(),identity,response),
      e=>e.code==='drive_verification_unavailable'
    );
  }
  assert.equal(writes.length,0);
});
