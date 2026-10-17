import { test } from "node:test";
import assert from "node:assert/strict";
import { FirestoreQueryGate } from "../src/data/firestore-query-gate.ts";
import { emptyNumbers, parseSync, recordCounts } from "../src/data/firestore-sync.ts";

test("query gate coalesces concurrent requests and retries after failure", async () => {
  const gate=new FirestoreQueryGate();
  let calls=0;
  const first=()=>gate.run("projects",async()=>{calls++;await Promise.resolve();return 12;});
  const [a,b]=await Promise.all([first(),first()]);
  assert.equal(a,12); assert.equal(b,12); assert.equal(calls,1);
  assert.equal(await first(),12); assert.equal(calls,2);
  await assert.rejects(()=>gate.run("failed",async()=>{throw Error("offline");}),/offline/);
  assert.equal(await gate.run("failed",async()=>9),9);
});
test("cache revisions and counts reject malformed snapshots", () => {
  const records=new Map([["clients/1",{}],["clients/2",{}],["projects/1",{}]]);
  const counts=recordCounts(records);
  assert.equal(counts.clients,2); assert.equal(counts.projects,1);
  assert.equal(counts.tasks,0);
  assert.deepEqual(emptyNumbers().events,0);
  assert.deepEqual(parseSync({revision:1,domains:emptyNumbers(),counts}),{revision:1,domains:emptyNumbers(),counts});
  assert.equal(parseSync({revision:1,domains:{...emptyNumbers(),clients:-1},counts}),null);
  assert.equal(parseSync({revision:0,domains:emptyNumbers(),counts}),null);
});
