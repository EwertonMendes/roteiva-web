import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';

export function database(...rows) {
  const sql = new DatabaseSync(':memory:');
  for (const migration of ['0001_oauth.sql','0002_oauth_launch.sql','0003_access_token_cache.sql','0004_account_deletion.sql','0005_deletion_fences.sql','0006_deletion_recovery.sql','0007_access.sql','0008_access_rollout.sql','0009_access_sync_fence.sql','0010_trial_identity_claims.sql']) {
    sql.exec(readFileSync(new URL('../../migrations/'+migration,import.meta.url),'utf8'));
  }
  sql.exec(readFileSync(new URL('../../migrations/0011_trial_identity_atomic.sql',import.meta.url),'utf8'));
  sql.exec(readFileSync(new URL('../../migrations/0012_drive_uploads.sql',import.meta.url),'utf8'));
  sql.exec(readFileSync(new URL('../../migrations/0013_reviews.sql',import.meta.url),'utf8'));
  for (const row of rows) {
    sql.prepare('INSERT INTO drive_connections(id,owner_uid,google_account_id,google_email,encrypted_refresh_token,status,scopes,revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(row.id,row.owner_uid,row.google_account_id,row.google_email||'test@example.com',
        row.encrypted_refresh_token,row.status,row.scopes||'',row.revision,Date.now(),Date.now());
  }
  const DB = {async batch(statements) {
    sql.exec('BEGIN');
    try {
      // Execute synchronously as D1 does: no interleaving inside a transaction.
      const results=statements.map(statement=>statement.execute());
      sql.exec('COMMIT');return results;
    } catch(error) {sql.exec('ROLLBACK');throw error;}
  },prepare(query) {
    const statement=sql.prepare(query);
    const bound=(args)=>({
      execute(){const results=statement.all(...args);return {results,success:true,
        meta:{changes:Number(sql.prepare('SELECT changes() AS n').get().n)}};},
      async first(){return statement.get(...args)||null;},
      async all(){return {results:statement.all(...args),success:true,meta:{}};},
      async run(){const result=statement.run(...args);return {success:true,meta:{changes:Number(result.changes)}};},
    });
    return {bind(...args){return bound(args);},...bound([])};
  }};
  return {DB,sql,close:()=>sql.close()};
}
