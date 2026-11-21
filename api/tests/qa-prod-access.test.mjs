import test from 'node:test';
import assert from 'node:assert/strict';
import {expiredTrial,assertSafeAccount,projectedAccess} from '../scripts/qa-prod-access.mjs';

const now=Date.parse('2026-11-21T20:00:00Z');
const week=7*24*60*60*1000;
function cleanRow() {
  return {
    owner_uid:'firebaseAuthTestUid-123',
    trial_started_at:now-week/2,
    trial_ends_at:now+week/2,
    suspended_at:null,sync_pending:0,
    subscriptions:0,contracts:0,checkouts:0,payments:0,grants:0,pending_projections:0,
  };
}

test('QA expiry preserves the database-enforced 7-day trial invariant and is already expired',()=>{
  const {start,end}=expiredTrial(now);
  assert.equal(end-start,week);
  assert.equal(end,now-120000);
  assert.ok(end<now);
});

test('QA expiry cannot alter paid users, complimentary users, open checkouts or unsettled projections',()=>{
  assert.doesNotThrow(()=>assertSafeAccount(cleanRow(),now));
  for(const [field,value] of [
    ['subscriptions',1],['contracts',1],['checkouts',1],['payments',1],
    ['grants',1],['pending_projections',1],['sync_pending',1],
    ['suspended_at',now],['trial_ends_at',now+5],
  ]) {
    const row={...cleanRow(),[field]:value};
    assert.throws(()=>assertSafeAccount(row,now),field+' must block QA mutation');
  }
  assert.throws(()=>assertSafeAccount({...cleanRow(),owner_uid:'unsafe UID'},now));
});

test('Firestore test projection is expired with no fake suspension and accurate trial date',()=>{
  const end=now-120000;
  const f=projectedAccess('firebaseAuthTestUid-123',end,now);
  assert.equal(f.source.stringValue,'none');
  assert.equal(f.trialEndsAt.timestampValue,new Date(end).toISOString());
  assert.equal(f.accessUntil.timestampValue,new Date(end).toISOString());
  assert.equal(f.suspended.booleanValue,false);
  assert.equal(f.unlimited.booleanValue,false);
  assert.equal(f.ownerUid.stringValue,'firebaseAuthTestUid-123');
});
