import test from 'node:test';
import assert from 'node:assert/strict';
import {database} from './helpers/database.mjs';
import {monitorDeletionBacklog} from '../src/deletion-monitor.ts';

test('native Worker monitor detects overdue deletion/OAuth records without mutating D1 or leaking identities',async t=>{
  const db=database();t.after(db.close);
  const now=Date.now(),old=now-3*60*60*1000,recent=now-60*1000;
  const insert=db.sql.prepare('INSERT INTO account_deletions (owner_uid,operation_id,phase,next_attempt_at,created_at,updated_at) VALUES (?,?,?,?,?,?)');
  insert.run('owner-manual','op-manual','manual_review',old,old,old);
  insert.run('owner-stalled','op-stalled','firestore',old,old,old);
  insert.run('owner-recent','op-recent','revoking',recent,recent,recent);
  const grant=db.sql.prepare('INSERT INTO oauth_exchange_guards (exchange_id,owner_uid,started_at,encrypted_token) VALUES (?,?,?,?)');
  grant.run('old-no-token','owner-confidential',old,null);
  grant.run('old-with-token','owner-other',old,'encrypted-secret-value');
  grant.run('recent','owner-third',recent,null);
  const before=[db.sql.prepare('SELECT COUNT(*) AS n FROM account_deletions').get().n,
    db.sql.prepare('SELECT COUNT(*) AS n FROM oauth_exchange_guards').get().n];
  const events=[];
  const orig=console.error;
  console.error=(s)=>events.push(JSON.parse(s));
  try{await monitorDeletionBacklog({DB:db.DB},now);}finally{console.error=orig;}
  assert.deepEqual(events,[
    {event:'account_deletion_manual_review_pending',count:1},
    {event:'account_deletion_stalled',count:1},
    {event:'oauth_exchange_reconciliation_required',count:2,withoutToken:1,withToken:1}
  ]);
  assert.deepEqual([db.sql.prepare('SELECT COUNT(*) AS n FROM account_deletions').get().n,
    db.sql.prepare('SELECT COUNT(*) AS n FROM oauth_exchange_guards').get().n],before);
  assert.ok(!JSON.stringify(events).includes('owner-'));
  assert.ok(!JSON.stringify(events).includes('encrypted-secret-value'));
});

test('healthy backlog does not emit error alarms',async t=>{
  const db=database();t.after(db.close);
  const events=[],orig=console.error;
  console.error=(s)=>events.push(s);
  try{await monitorDeletionBacklog({DB:db.DB});}finally{console.error=orig;}
  assert.deepEqual(events,[]);
});

test('monitor D1 failure propagates for scheduled handler to log an operational error',async()=>{
  await assert.rejects(()=>monitorDeletionBacklog({DB:{prepare(){throw Error('D1 offline');}}}),/D1 offline/);
});
