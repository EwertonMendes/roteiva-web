import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolveAccess,TRIAL_MS,PAYMENT_GRACE_MS} from '../src/access.ts';

const t=Date.UTC(2026,9,18);
const account={trial_started_at:t,trial_ends_at:t+TRIAL_MS,suspended_at:null};
test('seven days exactly, no reset on repeated evaluation',()=>{
  assert.equal(TRIAL_MS,604800000);
  assert.equal(resolveAccess(account,[],[],t+TRIAL_MS-1).active,true);
  assert.equal(resolveAccess(account,[],[],t+TRIAL_MS).active,false);
  assert.equal(resolveAccess(account,[],[],t+TRIAL_MS+1).source,'none');
});
test('complimentary and lifetime grants outlive trial',()=>{
  assert.equal(resolveAccess(account,[{grant_kind:'complimentary',ends_at:t+90*86400000}],[],t+15*86400000).active,true);
  const forever=resolveAccess(account,[{grant_kind:'lifetime',ends_at:null}],[],t+10000*86400000);
  assert.equal(forever.unlimited,true);
  assert.equal(forever.active,true);
});
test('a suspension overrides even a lifetime grant',()=>{
  const blocked=resolveAccess({...account,suspended_at:t},[{grant_kind:'lifetime',ends_at:null}],[],t);
  assert.equal(blocked.active,false);
});
test('past due grace only applies to past_due, cancellation never adds grace',()=>{
  assert.equal(PAYMENT_GRACE_MS,3*86400000);
  const paid=t+30*86400000,at=paid+86400000;
  assert.equal(resolveAccess(account,[],[{status:'past_due',paid_until:paid}],at).active,true);
  assert.equal(resolveAccess(account,[],[{status:'canceled',paid_until:paid}],at).active,false);
  assert.equal(resolveAccess(account,[],[{status:'expired',paid_until:paid+86400000}],at).active,false);
});
