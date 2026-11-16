import test from "node:test";
import assert from "node:assert/strict";
import {retryVerifiedInitialRead} from "../src/data/firestore-recovery.ts";

const denied=()=>Object.assign(new Error("Firestore Rules rejected the read"),{code:"permission-denied"});

test("successful initial read never performs redundant entitlement verification",async()=>{
  let checks=0;
  const result=await retryVerifiedInitialRead(async()=>"workspace",async()=>{checks++;return true;});
  assert.equal(result,"workspace");
  assert.equal(checks,0);
});

test("transient denied initial read retries exactly once after fresh server verification",async()=>{
  let reads=0,checks=0;
  const result=await retryVerifiedInitialRead(async()=>{
    if(++reads===1)throw denied();
    return "verified workspace";
  },async()=>{checks++;return true;},{delaysMs:[0,0,0]});
  assert.equal(result,"verified workspace");
  assert.equal(reads,2);
  assert.equal(checks,1);
});

test("revoked or absent entitlement never retries Firestore or opens workspace",async()=>{
  let reads=0;
  await assert.rejects(retryVerifiedInitialRead(async()=>{reads++;throw denied();},async()=>false),/Firestore Rules rejected/);
  assert.equal(reads,1);
});

test("failed server verification denies, not retries, initial workspace loading",async()=>{
  let reads=0;
  await assert.rejects(retryVerifiedInitialRead(async()=>{reads++;throw denied();},async()=>{throw new Error("HTTP 403");}),/HTTP 403/);
  assert.equal(reads,1);
});

test("repeated permission denial exhausts a finite budget and remains blocked",async()=>{
  let reads=0,checks=0;
  await assert.rejects(retryVerifiedInitialRead(async()=>{reads++;throw denied();},async()=>{checks++;return true;},{delaysMs:[0,0,0]}),/Firestore Rules rejected/);
  assert.equal(reads,4);
  assert.equal(checks,3);
});

test("other authorization errors are never masked by the retry path",async()=>{
  let checks=0;
  await assert.rejects(retryVerifiedInitialRead(async()=>{throw Object.assign(new Error("expired token"),{code:"unauthenticated"});},async()=>{checks++;return true;}),/expired token/);
  assert.equal(checks,0);
});

test("unmounted identity stops the verified retry before it executes",async()=>{
  let reads=0,current=true;
  await assert.rejects(retryVerifiedInitialRead(async()=>{reads++;current=false;throw denied();},async()=>true,{isCurrent:()=>current}),/cancelada/);
  assert.equal(reads,1);
});
