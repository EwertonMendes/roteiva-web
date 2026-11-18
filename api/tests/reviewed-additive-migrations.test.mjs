import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {reviewedAdditiveMigrations,isReviewedAdditiveMigration} from '../scripts/reviewed-additive-migrations.mjs';

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
