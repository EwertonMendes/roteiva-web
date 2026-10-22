import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateAudit} from '../scripts/ci-security-audit.mjs';
test('clean audit passes',()=>{
  assert.deepEqual(evaluateAudit({status:0,stdout:JSON.stringify({metadata:{vulnerabilities:{high:0,critical:0}}})}).ok,true);
});
test('real high vulnerability blocks deployment even if npm transport status is nonzero',()=>{
  const res=evaluateAudit({status:1,stdout:JSON.stringify({metadata:{vulnerabilities:{high:1,critical:0}}})});
  assert.equal(res.ok,false);assert.equal(res.warning,false);
});
test('registry audit service timeout creates explicit warning rather than bypassing dependency validation',()=>{
  const res=evaluateAudit({status:1,stdout:'',stderr:'npm warn audit network timeout at: https://registry.npmjs.org/-/npm/v1/security/audits/quick'});
  assert.equal(res.ok,true);assert.equal(res.warning,true);
});
test('unrecognized audit failures always block',()=>{
  assert.equal(evaluateAudit({status:1,stdout:'',stderr:'Unknown local validation error'}).ok,false);
});
