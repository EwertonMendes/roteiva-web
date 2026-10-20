// Integration: the production eligibility function against Miniflare's real
// D1 binding (workerd). No Google OAuth or published DEV Worker is exercised.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {retainTrialIdentity} from '../src/trial-identity.ts';
const key=Buffer.alloc(32,19).toString('base64url');
const p=(uid,email='one@gmail.com',googleSubject='google-one')=>({uid,verifiedEmail:email,googleSubject});
test('D1 runtime: concurrent claims, rollback, immutable constraints and deletion persistence',async t=>{
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:'export default {fetch(){return new Response("isolated");}}',compatibilityDate:'2026-10-17',d1Databases:{DB:'trial-test-isolated'},d1Persist:false}));
 t.after(()=>mf.dispose());
 const DB=await mf.getD1Database('DB');
 for(const file of readdirSync(new URL('../migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort()){
   const sql=readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8').replace(/--[^\n]*/g,'').replace(/\r?\n/g,' ');
   await DB.exec(sql);
 }
 const env={DB,TRIAL_IDENTITY_HMAC_KEY:key};
 const outcomes=await Promise.all(Array.from({length:12},(_,i)=>retainTrialIdentity(env,p('A'+i,'o.n.e+'+i+'@googlemail.com'))));
 assert.equal(outcomes.filter(Boolean).length,1);
 const winner='A'+outcomes.indexOf(true);
 const now=Date.now();
 await DB.prepare('INSERT INTO access_accounts(owner_uid,trial_started_at,trial_ends_at,created_at,updated_at) VALUES(?,?,?,?,?)').bind(winner,now,now+604800000,now,now).run();
 await DB.prepare('DELETE FROM access_accounts WHERE owner_uid=?').bind(winner).run();
 assert.equal(await retainTrialIdentity(env,p('recreated')),false);
 assert.equal(await retainTrialIdentity(env,p('independent','two@gmail.com','google-two')),true);
 await assert.rejects(()=>DB.prepare('UPDATE trial_identity_claims SET first_owner_tag=?').bind('v1_'+'a'.repeat(64)).run(),/trial_identity_claims_immutable/);
 const before=(await DB.prepare('SELECT COUNT(*) n FROM trial_identity_claims').first()).n;
 await DB.exec(`CREATE TRIGGER injected_failure BEFORE INSERT ON trial_identity_claims WHEN (SELECT COUNT(*) FROM trial_identity_claims)=${before+1} BEGIN SELECT RAISE(ABORT,'injected_failure'); END;`);
 await assert.rejects(()=>retainTrialIdentity(env,p('failing','fail@gmail.com','google-fail')),/injected_failure/);
 assert.equal((await DB.prepare('SELECT COUNT(*) n FROM trial_identity_claims').first()).n,before);
 assert.deepEqual((await DB.prepare('PRAGMA quick_check').all()).results.map(r=>r.quick_check),['ok']);
 assert.equal((await DB.prepare('PRAGMA foreign_key_check').all()).results.length,0);
});
