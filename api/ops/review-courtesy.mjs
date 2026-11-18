import assert from 'node:assert/strict';

// Operator-only orchestration. Never import this module into the public Worker.
// The adapter owns authenticated transport, environment seals and CAS writes.
export function validateReviewRequest(request, now = Date.now()) {
  const {uid, operation, until, operator} = request;
  assert.match(uid, /^[A-Za-z0-9_-]{1,128}$/);
  assert.match(operation, /^dropbox-review-[a-z0-9-]{8,64}$/);
  assert.match(operator, /^[A-Za-z0-9@._:/ -]{3,160}$/);
  const end = Date.parse(until);
  assert.ok(Number.isSafeInteger(end) && end > now && end <= now + 90 * 86400000,
    'Review courtesy must expire within 90 days');
  return end;
}
export async function grantReviewCourtesy(adapter, request, now = Date.now()) {
  const {uid, operation, until, operator} = request;
  const end=validateReviewRequest(request,now);
  await adapter.verifyIdentity(uid);
  const id = operation + ':' + uid;
  const reason = 'Dropbox production evaluation; ' + operation + '; operator ' + operator;
  const previous = await adapter.readGrant(id);
  if (previous) {
    assert.equal(previous.owner_uid, uid);
    assert.equal(previous.grant_kind, 'complimentary');
    assert.equal(previous.ends_at, end);
    assert.equal(previous.reason, reason);
    assert.equal(previous.revoked_at, null);
    if(request.recoveryFingerprint){
      // Explicit operator reconciliation of a previously recorded grant only.
      // A fingerprint must seal the exact fenced D1/Firestore state inspected.
      await adapter.verifyRecoveryPermit(uid,request.recoveryFingerprint);
      await adapter.publishFromAuthoritativeState(uid);
      await adapter.verifyPublished(uid,end,{fenced:true});
      assert.equal(await adapter.releaseFence(uid),1,'Recovery release not confirmed');
      await adapter.verifyPublished(uid,end);
      return {status:'reconciled',expiresAt:new Date(end).toISOString()};
    }
    await adapter.verifyPublished(uid, end);
    return {status: 'already-applied', expiresAt: new Date(end).toISOString()};
  }
  assert.ok(!request.recoveryFingerprint,'Recovery requires the exact existing grant');
  // Acquisition must be conditional. Never steal another maintenance fence.
  assert.equal(await adapter.acquireFence(uid), 1, 'Account unavailable or maintenance already pending');
  // Any subsequent failure intentionally retains the fence. Do not automatically
  // release it, undo grants, replay writes, or mask a partial maintenance result.
  await adapter.denyProjection(uid);
  await adapter.verifyDenied(uid);
  await adapter.insertGrant({id, uid, startsAt: now, endsAt: end, reason});
  const saved = await adapter.readGrant(id);
  assert.equal(saved?.owner_uid, uid);
  assert.equal(saved?.grant_kind, 'complimentary');
  assert.equal(saved?.ends_at, end);
  assert.equal(saved?.reason, reason);
  assert.equal(saved?.revoked_at, null);
  await adapter.publishFromAuthoritativeState(uid);
  await adapter.verifyPublished(uid, end, {fenced: true});
  assert.equal(await adapter.releaseFence(uid), 1, 'Fence release not confirmed');
  await adapter.verifyPublished(uid, end);
  return {status: 'applied', expiresAt: new Date(end).toISOString()};
}
