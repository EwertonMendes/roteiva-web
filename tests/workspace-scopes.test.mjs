import {test} from "node:test";
import assert from "node:assert/strict";
import {domainsForRoute} from "../src/lib/workspace-scopes.ts";

test("each route loads all domains required by its current UI and mutations",()=>{
  const settings=domainsForRoute({view:"settings"});
  const overview=domainsForRoute({view:"overview"});
  const list=domainsForRoute({view:"projects"});
  const detail=domainsForRoute({view:"projects",projectId:42});
  const clients=domainsForRoute({view:"clients"});
  const clientDetail=domainsForRoute({view:"clients",clientId:11});
  assert.deepEqual(settings,[]);
  assert.ok(overview.includes("financeEntries"));
  assert.ok(overview.includes("tasks"));
  assert.ok(!overview.includes("deliveries"));
  assert.ok(list.includes("clients"));
  assert.ok(!list.includes("financeEntries"));
  assert.ok(detail.includes("financeEntries")&&detail.includes("events"));
  assert.ok(clients.includes("financeEntries"));
  assert.ok(clientDetail.includes("deliveries"));
  assert.deepEqual(domainsForRoute({view:"library"}),[]);
  assert.ok(domainsForRoute({view:"calendar"}).includes("events"));
});
