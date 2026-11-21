import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {reviewedAdditiveMigrations,reviewedBillingMigrations,isReviewedAdditiveMigration} from '../scripts/reviewed-additive-migrations.mjs';

test('only an explicit billing promotion admits exact billing migration blobs into PROD',()=>{
 assert.equal(Object.keys(reviewedBillingMigrations).length,7);
 for(const name of Object.keys(reviewedBillingMigrations)){
  const sql=readFileSync('migrations/'+name,'utf8');
  assert.equal(isReviewedAdditiveMigration(name,sql,'dev'),true);
  assert.equal(isReviewedAdditiveMigration(name,sql,'prod'),false);
  assert.equal(isReviewedAdditiveMigration(name,sql,'prod',true),true);
  assert.equal(isReviewedAdditiveMigration(name,sql+'\n-- Changed','prod',true),false);
  assert.equal(isReviewedAdditiveMigration(name,sql+'\n-- Changed','dev'),false);
 }
});

test('billing schema can be applied over a populated PROD account without changing access',t=>{
 const db=new DatabaseSync(':memory:');
 t.after(()=>db.close());
 const base=readdirSync('migrations').filter(name=>/^\d{4}_.+\.sql$/.test(name)&&Number(name.slice(0,4))<=34).sort();
 for(const name of base)db.exec(readFileSync('migrations/'+name,'utf8'));
 db.exec("INSERT INTO deployment_identity VALUES(1,'prod'); "+
  "INSERT INTO access_accounts(owner_uid,trial_started_at,trial_ends_at,created_at,updated_at) VALUES('existing',1,604800001,1,1)");
 const account=()=>db.prepare("SELECT * FROM access_accounts WHERE owner_uid='existing'").get();
 const before=account();
 for(const name of Object.keys(reviewedBillingMigrations))db.exec(readFileSync('migrations/'+name,'utf8'));
 assert.deepEqual(account(),before);
 assert.equal(db.prepare('SELECT environment FROM deployment_identity').get().environment,'prod');
 assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 assert.equal(db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});

test('approved PROD virtual-library migrations are exact immutable additive blobs',()=>{
 const names=Object.keys(reviewedAdditiveMigrations);
 assert.equal(names.length,12);
 assert.ok(names.includes('0033_feedback_retry_safety.sql'));
 assert.ok(names.includes('0034_project_deletions.sql'));

 for(const name of names){
  const sql=readFileSync('migrations/'+name,'utf8');
  assert.equal(isReviewedAdditiveMigration(name,sql),true,name+' must match its reviewed Git blob');
  assert.equal(isReviewedAdditiveMigration(name,sql+'\n-- Changed'),false,name+' must reject modifications');
 }
 assert.equal(isReviewedAdditiveMigration('0001_unknown.sql','CREATE TABLE foo (id TEXT);'),false);
 assert.equal(isReviewedAdditiveMigration('0022_library_assets.sql','DROP TABLE users;'),false);
});
