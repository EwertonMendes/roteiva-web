// Runs only in the protected official DEV pipeline. Never selects customer data.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
const query=sql=>{
 const child=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','execute','DB','--env','dev','--remote','--json','--command',sql],{
  encoding:'utf8',env:{...process.env,WRANGLER_WRITE_LOGS:'false',WRANGLER_SEND_METRICS:'false'},maxBuffer:1024*1024
 });
 if(child.status!==0)throw Error('DEV migration audit query failed; inspect protected deployment credentials');
 const data=JSON.parse(child.stdout);
 assert.ok(data.every(result=>result.success));
 return data.flatMap(result=>result.results);
};
const priorTotals=query('SELECT (SELECT COUNT(*) FROM drive_connections) AS drive_connections,(SELECT COUNT(*) FROM oauth_transactions) AS oauth_transactions,(SELECT COUNT(*) FROM account_deletions) AS account_deletions,(SELECT COUNT(*) FROM oauth_exchange_guards) AS oauth_exchange_guards');
const snapshot='.access-migration-counts.json';
if(process.argv.includes('--before')){
 writeFileSync(snapshot,JSON.stringify(priorTotals));
 console.log(JSON.stringify({phase:'before',environment:'dev',totals:priorTotals}));
 process.exit(0);
}
assert.deepEqual(priorTotals,JSON.parse(readFileSync(snapshot,'utf8')),'Existing row counts changed during migration; investigate concurrent activity before deploy');
const migrations=query('SELECT name FROM d1_migrations ORDER BY id').map(r=>r.name);
assert.ok(migrations.includes('0007_access.sql'),'access migration is not applied');
assert.equal(query('PRAGMA foreign_key_check').length,0,'foreign key integrity failed');
const schema=query("SELECT name,type FROM sqlite_master WHERE name IN ('access_accounts','access_grants','access_subscriptions','access_grants_owner','access_subscriptions_owner','access_trial_immutable') ORDER BY name");
assert.equal(schema.length,6,'access schema incomplete');
const totals=query('SELECT (SELECT COUNT(*) FROM drive_connections) AS drive_connections,(SELECT COUNT(*) FROM oauth_transactions) AS oauth_transactions,(SELECT COUNT(*) FROM account_deletions) AS account_deletions,(SELECT COUNT(*) FROM oauth_exchange_guards) AS oauth_exchange_guards,(SELECT COUNT(*) FROM access_accounts) AS access_accounts');
console.log(JSON.stringify({environment:'dev',migrations,schema,foreignKeyViolations:0,totals}));
