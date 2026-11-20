import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
const read=name=>readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8');
test('payment ledger is additive, idempotent, owner-bound and has no access side effects',()=>{
 const db=new DatabaseSync(':memory:');
 try{
   db.exec(read('0007_access.sql'));
   const now=Date.UTC(2026,10,20);
   const addAccount=db.prepare('INSERT INTO access_accounts(owner_uid,trial_started_at,trial_ends_at,created_at,updated_at) VALUES(?,?,?,?,?)');
   addAccount.run('alice',now,now+604800000,now,now);
   addAccount.run('bob',now,now+604800000,now,now);
   const addSubscription=db.prepare("INSERT INTO access_subscriptions(id,owner_uid,provider,provider_reference,cadence,status,paid_until,updated_at) VALUES(?,?,?,?,?,'active',?,?)");
   addSubscription.run('sub-a','alice','asaas','asaas-a','monthly',now+604800000,now);
   addSubscription.run('sub-b','bob','asaas','asaas-b','yearly',now+604800000,now);
   const before=db.prepare('SELECT * FROM access_subscriptions ORDER BY id').all();
   db.exec(read('0035_billing_foundation.sql'));
   db.exec(read('0036_billing_webhook_events.sql'));
   db.exec(read('0037_billing_payment_ledger.sql'));
   assert.deepEqual(db.prepare('SELECT * FROM access_subscriptions ORDER BY id').all(),before);
   db.exec('PRAGMA foreign_keys=ON');
   const insert=db.prepare("INSERT INTO billing_payment_records (id,owner_uid,subscription_id,provider,provider_payment_ref,state,amount_cents,currency,due_on,verified_at,created_at,updated_at) VALUES(?,?,?,?,?,'confirmed',?,'BRL',?,?,?,?)");
   insert.run('evt-1','alice','sub-a','asaas','pay-1',3990,'2026-11-20',now,now,now);
   assert.throws(()=>insert.run('evt-2','alice','sub-a','asaas','pay-1',3990,'2026-11-20',now,now,now));
   assert.throws(()=>insert.run('evt-3','bob','sub-a','asaas','pay-3',3990,'2026-11-20',now,now,now));
   assert.throws(()=>insert.run('evt-4','alice','sub-b','asaas','pay-4',3990,'2026-11-20',now,now,now));
   assert.equal(db.prepare('SELECT COUNT(*) AS n FROM billing_payment_records').get().n,1);
   assert.equal(db.prepare('SELECT COUNT(*) AS n FROM access_grants').get().n,0);
   assert.deepEqual(db.prepare('SELECT * FROM access_subscriptions ORDER BY id').all(),before);
   assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
 }finally{db.close();}
});
