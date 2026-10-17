import {test} from "node:test";
import assert from "node:assert/strict";
import {firestoreCode,missingQueryIndex,transientFirestoreRead,retryFirestoreRead} from "../src/data/firestore-recovery.ts";

test("recognize missing indexes without retrying permanent security failures",()=>{
  assert.equal(missingQueryIndex({code:"failed-precondition",message:"The query requires an index."}),true);
  assert.equal(missingQueryIndex({code:"firestore/failed-precondition",message:"index is building"}),true);
  assert.equal(missingQueryIndex({code:"invalid-argument",message:"unsupported query"}),true);
  assert.equal(missingQueryIndex({code:"permission-denied",message:"no access"}),false);
  assert.equal(transientFirestoreRead({code:"unavailable"}),true);
  assert.equal(transientFirestoreRead({code:"permission-denied"}),false);
  assert.equal(firestoreCode({code:"firestore/unavailable"}),"unavailable");
});
test("automatically retry read after temporary outages",async()=>{
  let calls=0;
  const result=await retryFirestoreRead(async()=>{
    if(++calls<3)throw {code:"unavailable"};
    return "records";
  },{attempts:3,delaysMs:[0,0]});
  assert.equal(result,"records");
  assert.equal(calls,3);
});
test("never retry permission failures or exhausted outages indefinitely",async()=>{
  let calls=0;
  await assert.rejects(()=>retryFirestoreRead(async()=>{
    calls++;throw {code:"permission-denied"};
  },{delaysMs:[0,0]}),e=>e.code==="permission-denied");
  assert.equal(calls,1);
  await assert.rejects(()=>retryFirestoreRead(async()=>{
    calls++;throw {code:"unavailable"};
  },{attempts:2,delaysMs:[0]}));
  assert.equal(calls,3);
});
