import test from 'node:test';
import assert from 'node:assert/strict';
import {readConfirmedProfile} from '../src/data/profile-read.ts';
const profile={displayName:'Synthetic',studioName:'',professionalType:'freelancer',revision:1,legacy:false};
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
