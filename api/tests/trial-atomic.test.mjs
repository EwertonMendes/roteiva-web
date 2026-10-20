import {test} from 'node:test';
import assert from 'node:assert/strict';
import {database} from './helpers/database.mjs';
import {retainTrialIdentity,assertTrialIdentityRetained} from '../src/trial-identity.ts';
const key=Buffer.alloc(32,61).toString('base64url');
const p=(uid,email=uid+'@example.com',googleSubject='google-'+uid)=>({uid,verifiedEmail:email,googleSubject});
const setup=t=>{const db=database();t.after(db.close);return {...db,env:{DB:db.DB,TRIAL_IDENTITY_HMAC_KEY:key}};};

test('simultaneous same Gmail registrations have exactly one eligible UID',async t=>{
 const s=setup(t);
 const result=await Promise.all(Array.from({length:20},(_,i)=>retainTrialIdentity(s.env,p('uid'+i,'s.a.m.e+'+i+'@googlemail.com','google'+i))));
 assert.equal(result.filter(Boolean).length,1);
 const winner=result.indexOf(true);
 assert.equal(await retainTrialIdentity(s.env,p('uid'+winner,'same@gmail.com','google'+winner)),true);
});
test('failed transaction rolls back every marker and key pin, then retry succeeds',async t=>{
 const s=setup(t);
 s.sql.exec(`CREATE TRIGGER fail_trial BEFORE INSERT ON trial_identity_claims WHEN (SELECT COUNT(*) FROM trial_identity_claims)=1 BEGIN SELECT RAISE(ABORT,'injected_failure'); END;`);
 await assert.rejects(()=>retainTrialIdentity(s.env,p('A')),/injected_failure/);
 assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM trial_identity_claims').get().n,0);
 assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM trial_identity_key').get().n,0);
 // Remove only the test's injected failure; application migrations never drop tables.
 s.sql.exec('DROP TRIGGER fail_trial');
 assert.equal(await retainTrialIdentity(s.env,p('A')),true);
});
test('rejected UID and new aliases can never become eligible on retry after email changes',async t=>{
 const s=setup(t);
 assert.equal(await retainTrialIdentity(s.env,p('A','old@example.com','old-google')),true);
 assert.equal(await retainTrialIdentity(s.env,p('B','old@example.com','new-google')),false);
 assert.equal(await retainTrialIdentity(s.env,p('B','new@example.com','new-google')),false);
 assert.equal(await retainTrialIdentity(s.env,p('C','new@example.com','third-google')),false);
 assert.equal(await retainTrialIdentity(s.env,p('D')),true);
});
test('corporate dots and plus are not collapsed',async t=>{
 const s=setup(t);
 for(const [i,email] of ['user.name@company.com','username@company.com','user.name+tag@company.com'].entries())
   assert.equal(await retainTrialIdentity(s.env,p('corp'+i,email)),true);
});
test('accidental key replacement fails closed and does not add new fingerprints',async t=>{
 const s=setup(t);await retainTrialIdentity(s.env,p('A'));
 const prior=s.sql.prepare('SELECT * FROM trial_identity_claims ORDER BY fingerprint').all();
 const replaced={...s.env,TRIAL_IDENTITY_HMAC_KEY:Buffer.alloc(32,62).toString('base64url')};
 await assert.rejects(()=>retainTrialIdentity(replaced,p('B')),e=>e.code==='trial_identity_key_mismatch');
 await assert.rejects(()=>assertTrialIdentityRetained(replaced,'A'),e=>e.code==='trial_identity_retention_required');
 assert.deepEqual(s.sql.prepare('SELECT * FROM trial_identity_claims ORDER BY fingerprint').all(),prior);
 assert.equal(await retainTrialIdentity(s.env,p('A')),true);
});
test('D1 outage never produces an eligibility decision',async()=>{
 await assert.rejects(()=>retainTrialIdentity({TRIAL_IDENTITY_HMAC_KEY:key,DB:{prepare(){throw Error('D1 unavailable');}}},p('A')),/D1 unavailable/);
});
test('database fence rejects a late access insert after deletion starts, other UID unaffected',async t=>{
 const s=setup(t);const now=Date.now();
 s.sql.prepare("INSERT INTO account_deletions(owner_uid,operation_id,phase,next_attempt_at,created_at,updated_at) VALUES('A','op','locking',?,?,?)").run(now,now,now);
 const insert=s.sql.prepare('INSERT INTO access_accounts(owner_uid,trial_started_at,trial_ends_at,created_at,updated_at) VALUES(?,?,?,?,?)');
 assert.throws(()=>insert.run('A',now,now+604800000,now,now),/account_deleting/);
 insert.run('B',now,now+604800000,now,now);
 assert.equal(s.sql.prepare('PRAGMA foreign_key_check').all().length,0);
});
test('retention guard stops a pre-rollout saga before destructive dependency calls',async t=>{
 const s=setup(t);
 await assert.rejects(()=>assertTrialIdentityRetained(s.env,'legacy'),e=>e.status===503);
 await retainTrialIdentity(s.env,p('legacy'));
 await assert.doesNotReject(()=>assertTrialIdentityRetained(s.env,'legacy'));
});
