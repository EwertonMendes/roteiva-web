import {test} from "node:test";
import assert from "node:assert/strict";
import {firestoreCode,missingQueryIndex,transientFirestoreRead,retryFirestoreRead,retryVerifiedBootstrapRead} from "../src/data/firestore-recovery.ts";

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

test("bootstrap refreshes the same identity only before retrying an actual secured read",async()=>{
  let reads=0,refreshes=0;
  const result=await retryVerifiedBootstrapRead(async()=>{
    if(++reads<3)throw {code:"permission-denied"};
    return "confirmed private records";
  },async()=>{refreshes++;},{denialDelaysMs:[0,0]});
  assert.equal(result,"confirmed private records");
  assert.equal(reads,3);assert.equal(refreshes,2);
});
test("permanent permission denial stays denied after bounded reauthentication",async()=>{
  let reads=0,refreshes=0;
  await assert.rejects(()=>retryVerifiedBootstrapRead(async()=>{
    reads++;throw {code:"permission-denied"};
  },async()=>{refreshes++;},{denialDelaysMs:[0,0]}),e=>e.code==="permission-denied");
  assert.equal(reads,3);assert.equal(refreshes,2);
});
test("bootstrap never refreshes on unrelated errors or continues after account change",async()=>{
  let refreshed=0;
  await assert.rejects(()=>retryVerifiedBootstrapRead(async()=>{throw {code:"failed-precondition"};},
    async()=>{refreshed++;},{denialDelaysMs:[0,0]}),e=>e.code==="failed-precondition");
  assert.equal(refreshed,0);
  let active=true,reads=0;
  await assert.rejects(()=>retryVerifiedBootstrapRead(async()=>{
    reads++;throw {code:"permission-denied"};
  },async()=>{active=false;refreshed++;},{isCurrent:()=>active,denialDelaysMs:[0,0]}),/Leitura cancelada/);
  assert.equal(reads,1);assert.equal(refreshed,1);
});
