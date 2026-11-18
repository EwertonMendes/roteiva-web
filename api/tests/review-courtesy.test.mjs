import test from 'node:test';
import assert from 'node:assert/strict';
import {grantReviewCourtesy} from '../ops/review-courtesy.mjs';

const now = Date.parse('2026-11-17T00:00:00Z');
const request = {uid:'qa_owner', operation:'dropbox-review-20261117',
  until:'2027-01-15T00:00:00Z', operator:'owner-authorized-session'};
function fixture(fail) {
  const calls=[]; let fence=0, grant=null, denied=false, published=false;
  const adapter={
    async verifyIdentity(){calls.push('identity');if(fail==='identity')throw Error('identity rejected');},
    async readGrant(){return grant;},
    async acquireFence(){calls.push('fence');if(fail==='fence')return 0;fence=1;return 1;},
    async denyProjection(){calls.push('deny');if(fail==='deny')throw Error('CAS failed');denied=true;},
    async verifyDenied(){assert.equal(fence,1);assert.ok(denied);},
    async insertGrant(g){calls.push('grant');assert.ok(denied);assert.equal(fence,1);
      if(fail==='grant')throw Error('uncertain write');
      grant={owner_uid:g.uid,grant_kind:'complimentary',ends_at:g.endsAt,reason:g.reason,revoked_at:null};},
    async publishFromAuthoritativeState(){calls.push('publish');assert.ok(grant);if(fail==='publish')throw Error('projection failed');published=true;},
    async verifyPublished(_uid,_end,options){assert.ok(published);assert.equal(fence,options?.fenced?1:0);},
    async releaseFence(){calls.push('release');assert.ok(published);if(fail==='release')return 0;fence=0;return 1;},
  };
  return {adapter,calls,state:()=>({fence,grant,published})};
}
test('courtesy denies before grant, verifies projection before releasing, and is idempotent',async()=>{
  const f=fixture();assert.equal((await grantReviewCourtesy(f.adapter,request,now)).status,'applied');
  assert.deepEqual(f.calls,['identity','fence','deny','grant','publish','release']);
  assert.equal((await grantReviewCourtesy(f.adapter,request,now)).status,'already-applied');
  assert.equal(f.calls.filter(x=>x==='grant').length,1);
});
for(const failure of ['deny','grant','publish','release'])test('failure '+failure+' preserves the maintenance fence',async()=>{
  const f=fixture(failure);await assert.rejects(grantReviewCourtesy(f.adapter,request,now));
  assert.equal(f.state().fence,1);
  if(failure!=='release')assert.ok(!f.calls.includes('release'));
});
test('foreign identity or pre-existing maintenance cannot mutate access',async()=>{
  for(const failure of ['identity','fence']){const f=fixture(failure);
    await assert.rejects(grantReviewCourtesy(f.adapter,request,now));assert.equal(f.state().grant,null);
    assert.ok(!f.calls.includes('deny'));}
});
test('rejects indefinite, expired, overlong or invalid operator requests before transport',async()=>{
  for(const patch of [{until:'never'},{until:'2026-11-16T00:00:00Z'},
    {until:'2027-11-17T00:00:00Z'},{uid:"other' OR 1=1"},{operation:'generic-admin'}]){
    const f=fixture();await assert.rejects(grantReviewCourtesy(f.adapter,{...request,...patch},now));
    assert.deepEqual(f.calls,[]);
  }
});
test('idempotent replay rejects a changed deadline instead of extending it',async()=>{
  const f=fixture();await grantReviewCourtesy(f.adapter,request,now);
  await assert.rejects(grantReviewCourtesy(f.adapter,{...request,until:'2027-01-16T00:00:00Z'},now));
  assert.equal(f.calls.filter(x=>x==='grant').length,1);
});
