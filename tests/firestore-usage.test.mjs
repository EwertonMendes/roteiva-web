import {test} from "node:test";
import assert from "node:assert/strict";
import {clearUsage,trackPage,trackAggregation,trackRevision,trackMutation,usageSnapshot} from "../src/data/firestore-usage.ts";

test("usage counters distinguish cache, server and estimates without storing user data",()=>{
  clearUsage("sample");clearUsage("other");
  trackPage("sample","server",12);trackPage("sample","cache",20);
  trackAggregation("sample");trackRevision("sample");trackMutation("sample",2);
  assert.deepEqual(usageSnapshot("sample"),{
    serverQueries:1,serverDocumentsReturned:12,cacheQueries:1,cacheDocumentsReturned:20,
    aggregationQueries:1,revisionReads:1,mutationDocuments:2,mutationRevisions:1,
  });
  assert.equal(usageSnapshot("other").serverQueries,0);
  clearUsage("sample");
  assert.equal(usageSnapshot("sample").mutationDocuments,0);
});
