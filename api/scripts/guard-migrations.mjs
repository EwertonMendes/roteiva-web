import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {query,remoteMetadata,target} from './environment.mjs';
import {isReviewedAdditiveMigration} from './reviewed-additive-migrations.mjs';
await remoteMetadata();
const applied=new Set(query('SELECT name FROM d1_migrations').map(row=>row.name));
const pending=readdirSync('migrations').filter(name=>/^\d+_[\w-]+\.sql$/.test(name)&&!applied.has(name)).sort();
const devOnlyBilling = new Set([
 '0035_billing_foundation.sql',
 '0036_billing_webhook_events.sql',
 '0037_billing_payment_ledger.sql',
 '0038_billing_reconciliation.sql',
 '0039_billing_plan_changes.sql',
]);
if(target==='prod'){
 if(process.argv.includes('--domain-cutover')){
  assert.ok(pending.every(name=>devOnlyBilling.has(name)),
   'Domain cutover requires the current PROD schema; unexpected pending migrations: '+pending.join(', '));
 }else{
  assert.ok(!pending.some(name=>devOnlyBilling.has(name)),
   'Billing migrations are DEV-only until an approved billing release.');
 }
}
const reviewed=pending.filter(name=>isReviewedAdditiveMigration(name,readFileSync('migrations/'+name,'utf8'),target));
const destructive=pending.filter(name=>{
 const original=readFileSync('migrations/'+name,'utf8');
 if(isReviewedAdditiveMigration(name,original,target))return false;
 const sql=original.replace(/--[^\n]*/g,'').replace(/\/\*[\s\S]*?\*\//g,'');
 return /\b(?:DROP\s+(?:TABLE|INDEX|TRIGGER|VIEW)|ALTER\s+TABLE|TRUNCATE|DELETE\s+FROM|UPDATE\s+[\w"`]|INSERT\s+OR\s+REPLACE|REPLACE\s+INTO)/i.test(sql);
});
if(destructive.length){
 // Empty schema bootstrap is permitted; populated environments require a separate
 // reviewed maintenance operation and explicit authorization, never a CI flag.
 const tables=query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'")
  .map(row=>row.name).filter(name=>!['d1_migrations','access_rollout','deployment_identity'].includes(name));
 for(const name of tables){
  assert.match(name,/^[a-zA-Z_][a-zA-Z0-9_]*$/);
  assert.equal(query(`SELECT count(*) AS total FROM "${name}"`)[0].total,0,
   'Pending migrations can change existing data; explicit reviewed maintenance is required: '+destructive.join(', '));
 }
}
console.log(JSON.stringify({environment:target,pendingMigrations:pending,reviewedAdditiveMigrations:reviewed,guard:'passed'}));
