import test from 'node:test';
import assert from 'node:assert/strict';
import {ServiceCallError,uidFromVerifiedEmail,safeGoogleErrorCategory} from '../scripts/qa-prod-access.mjs';

const email='qa-exact@domain.example';
const uid='FAKE_firebase_Uid_1234';

test('Firebase Auth exact-match project-scoped response produces only verified UID',async()=>{
  const calls=[];
  const result=await uidFromVerifiedEmail('secret-token',email,async(token,url,method,body)=>{
    calls.push({token,url,method,body});
    return {users:[{localId:uid,email,disabled:false}]};
  });
  assert.equal(result,uid);
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,'https://identitytoolkit.googleapis.com/v1/projects/roteiva-web-prod/accounts:lookup');
  assert.equal(calls[0].method,'POST');
  assert.deepEqual(calls[0].body,{email:[email]});
});
test('documented alternative route keeps explicit project and verified email when project-scoped returns 400',async()=>{
  const calls=[];
  const result=await uidFromVerifiedEmail('token',email,async(_token,url,method,body)=>{
    calls.push({url,method,body});
    if(calls.length===1)throw new ServiceCallError('Firebase auth',400,'INVALID_ARGUMENT');
    return {users:[{localId:uid,email,disabled:false}]};
  });
  assert.equal(result,uid);
  assert.equal(calls.length,2);
  assert.equal(calls[1].url,'https://identitytoolkit.googleapis.com/v1/accounts:lookup');
  assert.deepEqual(calls[1].body,{email:[email],targetProjectId:'roteiva-web-prod'});
});
test('the fallback must not hide exact email mismatch or 403 permissions',async()=>{
  await assert.rejects(
    uidFromVerifiedEmail('token',email,async()=>({users:[{localId:uid,email:'other@domain.example'}]})),
    /different email/
  );
  await assert.rejects(
    uidFromVerifiedEmail('token',email,async()=>({users:[]})),
    /resolve exactly one/
  );
  await assert.rejects(
    uidFromVerifiedEmail('token',email,async()=>({users:[{localId:uid,email,disabled:true}]})),
    /disabled/
  );
  let requests=0;
  await assert.rejects(uidFromVerifiedEmail('token',email,async()=>{
    requests++;
    throw new ServiceCallError('Firebase auth',403,'PERMISSION_DENIED');
  }),/PERMISSION_DENIED/);
  assert.equal(requests,1);
});
test('Google API errors can be logged without any customer email or error body',()=>{
  assert.equal(safeGoogleErrorCategory({error:{status:'INVALID_ARGUMENT',message:'bad ewerton@example.com'}}),'INVALID_ARGUMENT');
  assert.equal(safeGoogleErrorCategory({error:{message:'INVALID_EMAIL : email ewerton@example.com'}}),'INVALID_EMAIL');
  assert.equal(safeGoogleErrorCategory({error:{message:'user ewerton@example.com was not found'}}),'unclassified');
});
