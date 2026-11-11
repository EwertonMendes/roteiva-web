import assert from 'node:assert/strict';
import {remoteMetadata,query,target} from './environment.mjs';
await remoteMetadata();
if(process.argv.includes('--seal')){
  // Only inserts an absent identity after checking the actual account/DB metadata.
  // Existing identities cannot be replaced or deleted, including by migrations.
  query(`INSERT INTO deployment_identity(singleton,environment) VALUES(1,'${target}') ON CONFLICT(singleton) DO NOTHING`);
}
if(!process.argv.includes('--before-migrations')) {
  assert.deepEqual(query('SELECT environment FROM deployment_identity WHERE singleton=1').map(row=>row.environment),[target]);
  assert.deepEqual(query('PRAGMA quick_check').map(row=>row.quick_check),['ok']);
  assert.equal(query('PRAGMA foreign_key_check').length,0);
}
console.log('Verified '+target+' deployment identity; no customer data selected.');
