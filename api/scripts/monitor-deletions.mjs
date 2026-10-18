import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const config=JSON.parse(readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8'));
assert.equal(config.env.dev.name,'roteiva-api-dev');
assert.equal(config.env.dev.vars.FIREBASE_PROJECT_ID,'roteiva-web-dev');
assert.equal(config.env.dev.d1_databases[0].database_id,'302adc88-76b2-4827-bb16-99662fa0408b');
const query="SELECT SUM(CASE WHEN phase='manual_review' THEN 1 ELSE 0 END) AS manual_review, SUM(CASE WHEN phase NOT IN ('completed','manual_review') AND updated_at < (unixepoch()*1000-7200000) THEN 1 ELSE 0 END) AS stalled FROM account_deletions";
const raw=execFileSync(process.execPath,[fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js',import.meta.url)),
  'd1','execute','DB','--env','dev','--remote','--json','--command',query],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
const result=JSON.parse(raw);
assert.ok(Array.isArray(result)&&result[0]?.success,'DEV D1 query failed');
const counts=result[0].results[0];
assert.ok(counts&&Object.hasOwn(counts,'manual_review')&&Object.hasOwn(counts,'stalled'),'Missing aggregate results');
console.log(JSON.stringify({event:'account_deletion_monitor_dev',manualReview:counts.manual_review||0,stalled:counts.stalled||0}));
assert.equal(Number(counts.manual_review||0),0,'DEV account deletion requires manual review; investigate through the runbook');
assert.equal(Number(counts.stalled||0),0,'DEV account deletion has made no progress for two hours');
