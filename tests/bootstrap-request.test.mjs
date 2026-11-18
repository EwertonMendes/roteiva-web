import test from 'node:test';
import assert from 'node:assert/strict';
import {EntryError,entryDeadline,entryRequest,entryToken} from '../src/data/bootstrap-request.ts';

test('transport rejection is redacted and an uncertain POST is attempted only once',async()=>{
 let calls=0;
 await assert.rejects(entryRequest('https://example.test/access',{method:'POST'},'access-ensure',50,async()=>{
  calls++;throw new TypeError('NetworkError https://private.test/?token=secret');
 }),error=>error instanceof EntryError&&error.stage==='access-ensure'&&error.category==='transport'&&!JSON.stringify(error).includes('secret'));
 assert.equal(calls,1);
});
test('deadline bounds both pending fetch and pending response body and aborts transport',async()=>{
 for(const bodyPending of [false,true]){
  let signal,calls=0;
  await assert.rejects(entryRequest('https://example.test',{method:'POST'},'access-ensure',8,async(_url,init)=>{
   calls++;signal=init.signal;
   return bodyPending?{ok:true,json:()=>new Promise(()=>{})}:new Promise(()=>{});
  }),error=>error.code==='deadline-exceeded'&&error.stage==='access-ensure');
  assert.equal(signal.aborted,true);assert.equal(calls,1);
 }
});
test('HTTP statuses retain safe correlation without trusting provider bodies',async()=>{
 const id='01010101-0101-4101-8101-010101010101';
 for(const [status,category]of [[401,'authentication'],[403,'authorization'],[408,'timeout'],[429,'quota'],[503,'server']]){
  await assert.rejects(entryRequest('https://example.test',{},'access-ensure',50,async()=>Response.json({error:{code:'access_sync_pending',requestId:id}},{status})),
   e=>e.category===category&&e.status===status&&e.requestId===id&&e.serviceCode==='access_sync_pending');
 }
 const redacted=new EntryError('profile-server','server',{requestId:'user@example.test',serviceCode:'https://private.test?token=secret'});
 assert.equal(redacted.requestId,undefined);assert.equal(redacted.serviceCode,undefined);assert.doesNotMatch(redacted.message,/secret|user@/);
});
test('HTML errors are classified by status and non-JSON success cannot become trusted data',async()=>{
 await assert.rejects(entryRequest('https://example.test',{},'account-status',50,async()=>new Response('<html>challenge</html>',{status:403})),e=>e.category==='authorization');
 await assert.rejects(entryRequest('https://example.test',{},'account-status',50,async()=>new Response('<html>unexpected</html>')),e=>e.category==='invalid-response');
});
test('token errors are distinct from API transport and late SDK completion cannot undo timeout',async()=>{
 await assert.rejects(entryToken(async()=>{throw{code:'auth/network-request-failed'}}),e=>e.stage==='access-token'&&e.category==='transport');
 let complete;const pending=entryDeadline(()=>new Promise(resolve=>{complete=resolve}),'profile-sdk',5);
 await assert.rejects(pending,e=>e.category==='timeout');complete('late');
 await assert.rejects(pending,e=>e.category==='timeout');
});
