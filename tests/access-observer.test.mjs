import test from 'node:test';
import assert from 'node:assert/strict';
import {observeAccess} from '../src/data/access-observer.ts';
import {parseAccessRest} from '../src/data/access-state.ts';
const active={source:'trial',unlimited:false,suspended:false,accessUntil:new Date('2099-01-01'),trialEndsAt:new Date('2099-01-01')};
const settle=()=>new Promise(resolve=>setImmediate(resolve));

test('cache-only listener recovers from the server and ignores the superseded subscription',async(t)=>{
 const callbacks=[],values=[],errors=[];let reads=0;
 const stop=observeAccess(next=>{callbacks.push(next);return()=>{}},async()=>{reads++;return active},v=>values.push(v),e=>errors.push(e),{firstSnapshotMs:15});t.after(stop);
 callbacks[0]({fromCache:true,value:active});
 await new Promise(resolve=>setTimeout(resolve,22));
 assert.equal(reads,1);assert.deepEqual(values,[active]);assert.equal(callbacks.length,2);
 callbacks[1]({fromCache:false,value:{...active,suspended:true}});
 callbacks[0]({fromCache:false,value:active});
 assert.equal(values.length,2);assert.equal(values.at(-1).suspended,true);assert.deepEqual(errors,[]);
});
test('silent listener with a hanging server read fails closed within the read deadline',async(t)=>{
 const values=[],errors=[];
 const stop=observeAccess(()=>()=>{},()=>new Promise(()=>{}),v=>values.push(v),e=>errors.push(e),{firstSnapshotMs:5,serverTimeoutMs:5});t.after(stop);
 await new Promise(resolve=>setTimeout(resolve,25));
 assert.deepEqual(values,[]);assert.equal(errors.length,1);assert.equal(errors[0].code,'deadline-exceeded');
});
test('silent listener restart budget is finite and logout cancels the watchdog',async(t)=>{
 t.mock.timers.enable({apis:['setTimeout']});let reads=0;const errors=[];
 const stop=observeAccess(()=>()=>{},async()=>{reads++;return active},()=>{},e=>errors.push(e),{firstSnapshotMs:8});t.after(stop);
 for(let i=0;i<20;i++){t.mock.timers.tick(2000);await settle();}
 assert.equal(reads,8);assert.equal(errors.length,1);
 stop();let canceledReads=0;
 const cancel=observeAccess(()=>()=>{},async()=>{canceledReads++;return active},()=>{},()=>{}, {firstSnapshotMs:8});cancel();
 t.mock.timers.tick(2000);await settle();assert.equal(canceledReads,0);
});
function harness(readServer){
 let next,fail,unsubscribed=false;
 const values=[],errors=[];
 const stop=observeAccess((onNext,onError)=>{next=onNext;fail=onError;return()=>{unsubscribed=true;};},readServer,v=>values.push(v),e=>errors.push(e));
 return {next,fail,stop,values,errors,get unsubscribed(){return unsubscribed;}};
}
test('cached snapshots cannot authorize or deny access and do not cause server reads',async()=>{
 let reads=0;const h=harness(async()=>{reads++;return active;});
 h.next({fromCache:true,value:active});h.next({fromCache:true,value:null});await settle();
 assert.equal(reads,0);assert.deepEqual(h.values,[]);assert.deepEqual(h.errors,[]);h.stop();
});
test('missing listener document is reconciled with a real server value before any error',async()=>{
 let resolve;const h=harness(()=>new Promise(r=>{resolve=r;}));h.next({fromCache:false,value:null});await settle();
 assert.deepEqual(h.values,[]);assert.deepEqual(h.errors,[]);
 resolve(active);await settle();assert.deepEqual(h.values,[active]);assert.deepEqual(h.errors,[]);h.stop();
});
test('genuinely absent projection remains denied, and subsequent restoration works',async()=>{
 const h=harness(async()=>null);h.next({fromCache:false,value:null});await settle();
 assert.equal(h.errors.length,1);assert.deepEqual(h.values,[]);
 h.next({fromCache:false,value:active});assert.deepEqual(h.values,[active]);h.stop();
});
test('permission/network failures cannot open the workspace',async()=>{
 for(const status of [401,403,503]){
  const h=harness(async()=>{throw new Error('HTTP '+status);});h.next({fromCache:false,value:null});await settle();
  assert.equal(h.errors.length,1);assert.deepEqual(h.values,[]);h.stop();
 }
});
test('newer suspension or expiration wins over a delayed active server response',async()=>{
 for(const state of [{...active,suspended:true},{...active,accessUntil:new Date('2000-01-01'),source:'none'}]){
  let resolve;const h=harness(()=>new Promise(r=>{resolve=r;}));h.next({fromCache:false,value:null});await settle();
  h.next({fromCache:false,value:state});resolve(active);await settle();
  assert.deepEqual(h.values,[state]);assert.deepEqual(h.errors,[]);h.stop();
 }
});
test('listener denial invalidates any pending recovery result',async()=>{
 let resolve,reads=0;const h=harness(()=>++reads===1?new Promise(r=>{resolve=r;}):Promise.reject(new Error('denied')));h.next({fromCache:false,value:null});await settle();
 h.fail();resolve(active);await settle();assert.equal(h.errors.length,1);assert.deepEqual(h.values,[]);h.stop();
});
test('logout/account switch ignores late responses and cancels reads not started yet',async()=>{
 let reads=0;const first=harness(async()=>{reads++;return active;});first.next({fromCache:false,value:null});first.stop();await settle();
 assert.equal(reads,0);assert.equal(first.unsubscribed,true);assert.deepEqual(first.values,[]);
 let resolve;const second=harness(()=>new Promise(r=>{resolve=r;}));second.next({fromCache:false,value:null});await settle();second.stop();resolve(active);await settle();
 assert.deepEqual(second.values,[]);assert.deepEqual(second.errors,[]);
});
const name='projects/test-project/databases/(default)/documents/users/alice/access/current';
const document=()=>({name,fields:{ownerUid:{stringValue:'alice'},schemaVersion:{integerValue:'1'},source:{stringValue:'trial'},
 unlimited:{booleanValue:false},suspended:{booleanValue:false},accessUntil:{timestampValue:'2099-01-01T00:00:00Z'},trialEndsAt:{timestampValue:'2099-01-01T00:00:00Z'}}});
test('REST recovery requires exact project/path, owner and validated entitlement fields',()=>{
 assert.equal(parseAccessRest(document(),name,'alice').source,'trial');
 for(const change of [d=>d.name=name.replace('test-project','other-project'),d=>d.fields.ownerUid.stringValue='bob',
  d=>d.fields.unlimited.booleanValue='true',d=>d.fields.source.stringValue='admin',d=>d.fields.accessUntil.timestampValue='invalid',
  d=>d.fields.schemaVersion.integerValue='2',d=>delete d.fields.suspended]){
  const d=document();change(d);assert.throws(()=>parseAccessRest(d,name,'alice'));
 }
});

test('multiple listener terminations recheck the server and restore monitoring without losing the session',async()=>{
 let next,fail,subscriptions=0,reads=0;const values=[],errors=[];
 const stop=observeAccess((n,e)=>{next=n;fail=e;subscriptions++;return()=>{};},async()=>{reads++;return active;},v=>values.push(v),e=>errors.push(e));
 fail();await settle();assert.equal(subscriptions,2);assert.equal(reads,1);
 fail();await settle();assert.equal(subscriptions,3);assert.equal(reads,2);
 // Consecutive failures back off, but never count as evidence of revocation.
 fail();await new Promise(resolve=>setTimeout(resolve,150));
 assert.equal(subscriptions,4);assert.equal(reads,3);assert.deepEqual(errors,[]);
 assert.equal(values.length,3);
 next({fromCache:false,value:{...active,suspended:true}});
 assert.equal(values.at(-1).suspended,true);
 // A healthy authoritative snapshot resets the bounded restart budget.
 fail();await settle();assert.equal(subscriptions,5);assert.equal(reads,4);
 assert.deepEqual(errors,[]);stop();
});
test('a failed access verification during repeated termination fails closed',async()=>{
 let next,fail,reads=0;const values=[],errors=[];
 const stop=observeAccess((n,e)=>{next=n;fail=e;return()=>{};},
   async()=>{reads++;return reads===1?active:null;},v=>values.push(v),e=>errors.push(e));
 fail();await settle();assert.equal(values.length,1);
 fail();await settle();assert.equal(reads,2);assert.equal(errors.length,1);
 assert.match(errors[0].message,/confirmar seu acesso/);
 stop();
});
test('closing a tab cancels a pending listener-restart timer',async()=>{
 let fail,subscriptions=0,reads=0;const errors=[];
 const stop=observeAccess((_n,e)=>{fail=e;subscriptions++;return()=>{};},
   async()=>{reads++;return active;},()=>{},e=>errors.push(e));
 fail();await settle();fail();await settle();fail();await settle();
 assert.equal(reads,3);assert.equal(subscriptions,3);
 stop();
 await new Promise(resolve=>setTimeout(resolve,170));
 assert.equal(subscriptions,3);assert.deepEqual(errors,[]);
});

