import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPair,exportPKCS8} from 'jose';
import {database} from './helpers/database.mjs';
import {ensureAccess,assertActiveAccess,TRIAL_MS} from '../src/access.ts';
import {backfillAccess} from '../src/access-backfill.ts';
import {adminToken} from '../src/firebase-admin.ts';

const {privateKey}=await generateKeyPair('RS256',{extractable:true});
const trialIdentity={uid:'A',verifiedEmail:'unit-test@example.com',googleSubject:'unit-google-subject'};
const trialKey=Buffer.from(new Uint8Array(32).fill(23)).toString('base64url');
const credentials={type:'service_account',project_id:'roteiva-web-dev',client_email:'synthetic@roteiva-web-dev.iam.gserviceaccount.com',private_key:await exportPKCS8(privateKey),token_uri:'https://oauth2.googleapis.com/token'};
function setup(t,{existing=true,failPatch=false,conflict=false,missing=false}={}){
 const db=database();t.after(db.close);
 const env={DB:db.DB,ENVIRONMENT:'dev',FIREBASE_PROJECT_ID:'roteiva-web-dev',ACCOUNT_DELETION_ENABLED:'true',FIREBASE_ADMIN_CREDENTIALS_JSON:JSON.stringify(credentials),TRIAL_IDENTITY_HMAC_KEY:trialKey};
 const cutoff=db.sql.prepare('SELECT cutoff_at FROM access_rollout').get().cutoff_at;
 const projection=new Map();let writes=0,requests=0;
 t.mock.method(globalThis,'fetch',async(url,options={})=>{
   requests++;
   assert.equal(options.redirect,'manual','Workers only supports manual/follow; administrative redirects must never be followed');
   if(url==='https://oauth2.googleapis.com/token')return Response.json({access_token:'synthetic-admin'});
   if(String(url).includes('/documents/users?'))return Response.json({documents:[{name:'projects/roteiva-web-dev/databases/(default)/documents/users/A',fields:{ownerUid:{stringValue:'A'}}}]});
   const path=new URL(url).pathname;
   if(path.endsWith('/users/A'))return missing?new Response('',{status:404}):Response.json({createTime:new Date(cutoff+(existing?-10000:10000)).toISOString(),updateTime:'2026-10-19T00:00:00Z',fields:{ownerUid:{stringValue:'A'}}});
   if(path.endsWith('/documents:commit')){
     assert.equal(options.method,'POST');
     if(failPatch)return new Response('',{status:503});
     if(conflict)return new Response('',{status:409});
     const body=JSON.parse(options.body);
     assert.equal(body.writes.length,2);
     assert.equal(body.writes[0].currentDocument.updateTime,'2026-10-19T00:00:00Z');
     assert.deepEqual(body.writes[0].updateMask.fieldPaths,['ownerUid']);
     assert.ok(body.writes[1].currentDocument);
     const value=body.writes[1].update;value.updateTime=new Date().toISOString();projection.set('A',value);writes++;return Response.json({});
   }
   if(path.endsWith('/users/A/access/current')){
     return projection.has('A')?Response.json(projection.get('A')):new Response('',{status:404});
   }
   throw Error('Unexpected request');
 });
 return {...db,env,cutoff,projection,stats:()=>({writes,requests})};
}
test('existing account receives one fixed 30-day beta grant without restarting seven-day trial',async t=>{
 const s=setup(t);
 const first=await (await ensureAccess(s.env,'A',undefined,trialIdentity)).json();
 const row=s.sql.prepare('SELECT * FROM access_accounts').get();
 assert.equal(row.trial_ends_at-row.trial_started_at,TRIAL_MS);
 assert.equal(Date.parse(first.accessUntil),s.cutoff+30*86400000);
 await ensureAccess(s.env,'A',undefined,trialIdentity);
 assert.deepEqual(s.sql.prepare('SELECT * FROM access_accounts').get(),row);
 assert.equal(s.sql.prepare('SELECT COUNT(*) AS n FROM access_grants').get().n,1);
 assert.equal(s.stats().writes,1,'same state must not create extra Firestore writes');
});
test('new account receives exactly seven days, no beta grant',async t=>{
 const s=setup(t,{existing:false});
 const state=await (await ensureAccess(s.env,'A',undefined,trialIdentity)).json();
 const row=s.sql.prepare('SELECT * FROM access_accounts').get();
 assert.equal(row.trial_ends_at-row.trial_started_at,TRIAL_MS);
 assert.equal(state.source,'trial');
 assert.equal(s.sql.prepare('SELECT COUNT(*) AS n FROM access_grants').get().n,0);
});
test('Drive cannot implicitly create trials and never bypasses suspension',async t=>{
 const s=setup(t);
 await assert.rejects(()=>assertActiveAccess(s.env,'A'),e=>e.status===403);
 await assert.rejects(()=>assertActiveAccess({...s.env,ACCESS_PROVISION_ON_DRIVE:'true'},'A'),e=>e.status===403);
 await ensureAccess(s.env,'A',undefined,trialIdentity);
 await assert.doesNotReject(()=>assertActiveAccess(s.env,'A'));
 s.sql.prepare('UPDATE access_accounts SET suspended_at=? WHERE owner_uid=?').run(Date.now(),'A');
 await assert.rejects(()=>assertActiveAccess(s.env,'A'),e=>e.status===403);
});
test('profile absence never creates a trial; failed projection cannot report success',async t=>{
 const s=setup(t,{missing:true});
 await assert.rejects(()=>ensureAccess(s.env,'A',undefined,trialIdentity),e=>e.status===409);
 assert.equal(s.sql.prepare('SELECT COUNT(*) AS n FROM access_accounts').get().n,0);
});
for(const mode of ['failPatch','conflict'])test('projection '+mode+' fails closed and retries preserve trial',async t=>{
 const s=setup(t,{[mode]:true});
 await assert.rejects(()=>ensureAccess(s.env,'A',undefined,trialIdentity),e=>e.status===503);
 const row=s.sql.prepare('SELECT * FROM access_accounts').get();
 await assert.rejects(()=>ensureAccess(s.env,'A',undefined,trialIdentity),e=>e.status===503);
 assert.deepEqual(s.sql.prepare('SELECT * FROM access_accounts').get(),row);
 assert.equal(s.stats().writes,0);
});
test('Cron backfill completes once and does not renew benefits or write business documents',async t=>{
 const s=setup(t);
 await backfillAccess(s.env);
 const row=s.sql.prepare('SELECT * FROM access_rollout').get();
 assert.ok(row.completed_at);assert.equal(row.processed,1);
 const stats=s.stats();
 await backfillAccess(s.env);
 assert.deepEqual(s.stats(),stats);
 assert.equal(s.sql.prepare('SELECT COUNT(*) AS n FROM access_grants').get().n,1);
});
test('failed backfill retains cursor and never announces completion',async t=>{
 const s=setup(t,{failPatch:true});
 await assert.rejects(()=>backfillAccess(s.env));
 const row=s.sql.prepare('SELECT * FROM access_rollout').get();
 assert.equal(row.completed_at,null);assert.equal(row.cursor,null);assert.equal(row.processed,0);
});
test('a pending privileged synchronization cannot re-publish or serve old rights',async t=>{
 const s=setup(t);
 await ensureAccess(s.env,'A',undefined,trialIdentity);
 const before=s.stats().writes;
 s.sql.prepare('UPDATE access_accounts SET sync_pending=1 WHERE owner_uid=?').run('A');
 await assert.rejects(()=>ensureAccess(s.env,'A',undefined,trialIdentity),e=>e.code==='access_sync_pending');
 await assert.rejects(()=>assertActiveAccess({...s.env,ACCESS_PROVISION_ON_DRIVE:'true'},'A'),e=>e.code==='access_sync_pending');
 assert.equal(s.stats().writes,before);
 s.sql.prepare('UPDATE access_accounts SET suspended_at=?,sync_pending=0 WHERE owner_uid=?').run(Date.now(),'A');
 await ensureAccess(s.env,'A',undefined,trialIdentity);
 assert.equal(s.projection.get('A').fields.suspended.booleanValue,true);
 await assert.rejects(()=>assertActiveAccess(s.env,'A'),e=>e.status===403);
});
test('token diagnostics retain only allowlisted categories, never provider descriptions',async t=>{
 const s=setup(t);
 for(const category of ['invalid_grant','invalid_scope','arbitrary-secret']){
   await assert.rejects(()=>adminToken(s.env,async()=>Response.json({error:category,error_description:'private-provider-data'},{status:400})),
     e=>e.code===(category==='arbitrary-secret'?'admin_token_unavailable':'admin_token_'+category)&&!e.message.includes('private-provider-data'));
 }
});
