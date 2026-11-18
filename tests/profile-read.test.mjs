import test from 'node:test';
import assert from 'node:assert/strict';
import {readConfirmedProfile} from '../src/data/profile-read.ts';
const profile={displayName:'Synthetic',studioName:'',professionalType:'freelancer',revision:1,legacy:false};

test('silent SDK falls back once to authenticated server, without waiting for SDK completion',async()=>{
 let finish,reads=0;
 const result=await readConfirmedProfile(()=>new Promise(resolve=>{finish=resolve}),async()=>{reads++;return profile;},{sdkTimeoutMs:5});
 assert.equal(result,profile);assert.equal(reads,1);finish(null);
});
test('silent SDK plus a denied or silent server cannot open the workspace',async()=>{
 await assert.rejects(readConfirmedProfile(()=>new Promise(()=>{}),async()=>{throw{code:'permission-denied'}},{sdkTimeoutMs:5}),e=>e.code==='permission-denied');
 await assert.rejects(readConfirmedProfile(()=>new Promise(()=>{}),()=>new Promise(()=>{}),{sdkTimeoutMs:5,serverTimeoutMs:5}),e=>e.code==='deadline-exceeded');
});
test('valid initial profile does not perform recovery reads',async()=>{
 let reads=0;assert.equal(await readConfirmedProfile(async()=>profile,async()=>{reads++;return null;}),profile);assert.equal(reads,0);
});
test('restored-session SDK denial is confirmed with fresh server credentials',async()=>{
 for(const code of ['permission-denied','firestore/unauthenticated']){
  assert.equal(await readConfirmedProfile(async()=>{throw {code};},async()=>profile),profile);
 }
});
test('missing SDK profile cannot show registration when the real profile exists',async()=>{
 assert.equal(await readConfirmedProfile(async()=>null,async()=>profile),profile);
 assert.equal(await readConfirmedProfile(async()=>null,async()=>null),null);
});
test('real permission denial and server failure remain denied',async()=>{
 for(const status of [403,503])await assert.rejects(readConfirmedProfile(async()=>{throw {code:'permission-denied'};},async()=>{throw new Error('HTTP '+status);}));
});
test('unrelated failures do not trigger authentication recovery or repeat writes',async()=>{
 let reads=0;await assert.rejects(readConfirmedProfile(async()=>{throw new Error('unexpected');},async()=>{reads++;return profile;}));assert.equal(reads,0);
});

test('persistent-cache and transient SDK failures recover through authenticated server read',async()=>{
 for(const code of ['failed-precondition','firestore/unimplemented','internal','unavailable','deadline-exceeded','aborted']){
  let reads=0;
  assert.equal(await readConfirmedProfile(async()=>{throw {code};},async()=>{reads++;return profile;}),profile);
  assert.equal(reads,1,code);
 }
});
test('server recovery cannot convert a real denial into a profile',async()=>{
 for(const code of ['unavailable','failed-precondition','permission-denied'])
  await assert.rejects(readConfirmedProfile(async()=>{throw {code};},async()=>{
    throw Object.assign(new Error('Server denied'),{code:'permission-denied'});
  }),error=>error.code==='permission-denied');
});
