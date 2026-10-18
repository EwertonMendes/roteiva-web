import test from "node:test";
import assert from "node:assert/strict";
import {validateOperation} from "../scripts/firebase-ops.mjs";

test("only private user reads and bounded collection counts are permitted", () => {
  assert.equal(validateOperation("read","users/uid123/clients/123").path,"users/uid123/clients/123");
  assert.equal(validateOperation("count","users/uid123/clients").operation,"count");
  assert.throws(()=>validateOperation("count","users"),/denied/);
  assert.throws(()=>validateOperation("read","accountDeletionFences/uid123"),/denied/);
  assert.throws(()=>validateOperation("read","users/uid123/clients"),/denied/);
});

test("fixtures cannot bypass the approval contract or mutate business documents", () => {
  assert.throws(()=>validateOperation("delete-fixture","opsFixtures/probe"),/denied/);
  assert.equal(validateOperation("delete-fixture","opsFixtures/probe","DELETE-DEV-FIXTURE").operation,"delete-fixture");
  assert.throws(()=>validateOperation("create-fixture","users/uid123/clients/123"),/denied/);
  assert.throws(()=>validateOperation("patch","users/uid123/clients/123"),/denied/);
  assert.throws(()=>validateOperation("read","users/uid123/../other"),/Invalid/);
  assert.throws(()=>validateOperation("read","users/uid123?mask=all"),/Invalid/);
});
