import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPair,exportPKCS8} from 'jose';
import {database} from './helpers/database.mjs';
import {requestDeletion} from '../src/account-deletion.ts';
const {privateKey}=await generateKeyPair('RS256',{extractable:true});
const credentials=JSON.stringify({type:'service_account',project_id:'roteiva-web-dev',client_email:'test@roteiva-web-dev.iam.gserviceaccount.com',private_key:await exportPKCS8(privateKey),token_uri:'https://oauth2.googleapis.com/token'});
const principal={uid:'A',verifiedEmail:'disposable@example.com',googleSubject:'fixture-google'};
const request=()=>new Request('https://isolated.test',{method:'POST',body:JSON.stringify({phrase:'EXCLUIR MINHA CONTA',acknowledged:true,active:true})});
function setup(t){const db=database();t.after(db.close);return {...db,env:{DB:db.DB,ENVIRONMENT:'dev',FIREBASE_PROJECT_ID:'roteiva-web-dev',ACCOUNT_DELETION_ENABLED:'true',TRIAL_IDENTITY_HMAC_KEY:Buffer.alloc(32,44).toString('base64url'),FIREBASE_ADMIN_CREDENTIALS_JSON:credentials}};}
function account(s,{expired=false,suspended=false,pending=false}={}){
 const stamp=Date.now(),start=expired?0:stamp;
 s.sql.prepare('INSERT INTO access_accounts(owner_uid,trial_started_at,trial_ends_at,suspended_at,created_at,updated_at,sync_pending) VALUES(?,?,?,?,?,?,?)').run('A',start,start+604800000,suspended?stamp:null,stamp,stamp,pending?1:0);
}
for(const [name,options,code] of [['unprovisioned',null,'access_expired'],['expired',{expired:true},'access_expired'],['suspended',{suspended:true},'access_expired'],['unverified commercial sync',{pending:true},'access_sync_pending']]){
 test('new deletion denied for '+name+' account, ignoring client active flag',async t=>{
   const s=setup(t);if(options)account(s,options);
   t.mock.method(globalThis,'fetch',async()=>{throw Error('No external mutation is allowed');});
   await assert.rejects(()=>requestDeletion(request(),s.env,'A',principal),e=>e.code===code);
   assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM account_deletions').get().n,0);
   assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM trial_identity_claims').get().n,0);
 });
}
test('active account may delete and its existing operation remains idempotent after access is removed',async t=>{
 const s=setup(t);account(s);
 t.mock.method(globalThis,'fetch',async url=>{
   if(String(url)==='https://oauth2.googleapis.com/token')return Response.json({access_token:'synthetic-admin'});
   if(String(url).startsWith('https://firestore.googleapis.com/'))return Response.json({});
   throw Error('Unexpected dependency');
 });
 const first=await requestDeletion(request(),s.env,'A',principal);assert.equal(first.status,202);
 const accepted=await first.json();
 s.sql.prepare('DELETE FROM access_accounts WHERE owner_uid=?').run('A');
 const retry=await requestDeletion(request(),s.env,'A',principal);assert.equal(retry.status,202);
 assert.equal((await retry.json()).operationId,accepted.operationId);
 assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM account_deletions').get().n,1);
});
