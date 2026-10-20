// Isolated integration: actual backend functions, D1/workerd and Firebase
// Auth/Firestore emulators. Google identity/JWT signer and admin token exchange
// are synthetic; this is NOT evidence of Google OAuth or published DEV.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {generateKeyPair,exportPKCS8,exportJWK,createLocalJWKSet,SignJWT} from 'jose';
import {ensureAccess,TRIAL_MS,assertActiveAccess} from '../../src/access.ts';
import {verifiedTrialPrincipal} from '../../src/auth.ts';
import {requestDeletion,advanceDeletion} from '../../src/account-deletion.ts';
const project='demo-roteiva';
const firestore='http://127.0.0.1:8080/v1/projects/'+project+'/databases/(default)/documents';
const auth='http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';
const key=Buffer.alloc(32,82).toString('base64url');
test('isolated backend saga: first trial, retries, deletion, recreated UID denied and independent account eligible',async t=>{
 assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8080');
 assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST,'127.0.0.1:9099');
 const network=globalThis.fetch;
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:'export default {fetch(){return new Response("isolated");}}',compatibilityDate:'2026-10-17',d1Databases:{DB:'trial-e2e-isolated'},d1Persist:false}));
 t.after(()=>mf.dispose());
 const DB=await mf.getD1Database('DB');
 for(const file of readdirSync(new URL('../../migrations/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())
   await DB.exec(readFileSync(new URL('../../migrations/'+file,import.meta.url),'utf8').replace(/--[^\n]*/g,'').replace(/\r?\n/g,' '));
 const {privateKey,publicKey}=await generateKeyPair('RS256',{extractable:true});
 const jwk=await exportJWK(publicKey);jwk.kid='isolated';
 const jwks=createLocalJWKSet({keys:[jwk]});
 const env={DB,ENVIRONMENT:'dev',FIREBASE_PROJECT_ID:project,ACCOUNT_DELETION_ENABLED:'true',TRIAL_IDENTITY_HMAC_KEY:key,
   FIREBASE_ADMIN_CREDENTIALS_JSON:JSON.stringify({type:'service_account',project_id:project,client_email:'test@demo-roteiva.iam.gserviceaccount.com',private_key:await exportPKCS8(privateKey),token_uri:'https://oauth2.googleapis.com/token'})};
 const post=async(url,body)=>{const r=await network(url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer owner'},body:JSON.stringify(body)});assert.equal(r.status,200,await r.clone().text());return r.json();};
 const signup=async(email)=>{
   const account=await post(auth+'/accounts:signUp?key=isolated-fake-key',{email,password:'SyntheticFixturePassword123!',returnSecureToken:true});
   const uid=account.localId;
   const r=await network(firestore+'/users/'+uid,{method:'PATCH',headers:{Authorization:'Bearer owner','Content-Type':'application/json'},body:JSON.stringify({fields:{ownerUid:{stringValue:uid}}})});
   assert.equal(r.status,200);return uid;
 };
 const principal=async(uid,email,subject)=>{
   const now=Math.floor(Date.now()/1000);
   const token=await new SignJWT({auth_time:now,email,email_verified:true,firebase:{sign_in_provider:'google.com',identities:{'google.com':[subject]}}})
     .setSubject(uid).setIssuedAt(now).setExpirationTime(now+300).setAudience(project).setIssuer('https://securetoken.google.com/'+project).setProtectedHeader({alg:'RS256',kid:'isolated'}).sign(privateKey);
   return verifiedTrialPrincipal(new Request('https://isolated.test',{headers:{Authorization:'Bearer '+token}}),env,300,jwks);
 };
 let failLock=false,lockFailed=false;
 globalThis.fetch=async(input,init)=>{
   const url=new URL(String(input));
   if(url.href==='https://oauth2.googleapis.com/token')return Response.json({access_token:'owner'});
   assert.ok(url.pathname.includes('/projects/'+project+'/'),'never contact a real Firebase project');
   if(url.hostname==='firestore.googleapis.com'){
     if(failLock&&init?.method==='PATCH'){lockFailed=true;return new Response('',{status:503});}
     return network('http://127.0.0.1:8080'+url.pathname+url.search,init);
   }
   if(url.hostname==='identitytoolkit.googleapis.com')return network('http://127.0.0.1:9099/identitytoolkit.googleapis.com'+url.pathname+url.search,init);
   throw Error('Unexpected external dependency');
 };
 t.after(()=>{globalThis.fetch=network;});
 const suffix=Date.now();const email='trial-e2e-'+suffix+'@example.com';
 const a=await signup(email),pa=await principal(a,email,'google-original');
 const first=await (await ensureAccess(env,a,undefined,pa)).json();
 assert.equal(first.active,true);assert.equal(first.source,'trial');
 const row=await DB.prepare('SELECT trial_started_at,trial_ends_at FROM access_accounts WHERE owner_uid=?').bind(a).first();
 assert.equal(row.trial_ends_at-row.trial_started_at,TRIAL_MS);
 for(let i=0;i<3;i++)await ensureAccess(env,a,undefined,pa);
 assert.deepEqual(await DB.prepare('SELECT trial_started_at,trial_ends_at FROM access_accounts WHERE owner_uid=?').bind(a).first(),row);
 const c=await signup('control-'+suffix+'@example.com'),pc=await principal(c,'control-'+suffix+'@example.com','google-control');
 assert.equal((await (await ensureAccess(env,c,undefined,pc)).json()).active,true);
 const confirmation=()=>new Request('https://isolated.test/account/deletion',{method:'POST',body:JSON.stringify({phrase:'EXCLUIR MINHA CONTA',acknowledged:true})});
 await assert.rejects(()=>requestDeletion(confirmation(),{...env,TRIAL_IDENTITY_HMAC_KEY:undefined},a,pa),e=>e.code==='trial_identity_unavailable');
 assert.equal((await DB.prepare('SELECT COUNT(*) n FROM account_deletions WHERE owner_uid=?').bind(a).first()).n,0);
 failLock=true;assert.equal((await requestDeletion(confirmation(),env,a,pa)).status,202);assert.equal(lockFailed,true);
 const job=await DB.prepare('SELECT phase,attempts FROM account_deletions WHERE owner_uid=?').bind(a).first();
 assert.equal(job.phase,'locking');assert.equal(job.attempts,1);
 assert.equal((await network(firestore+'/users/'+a,{headers:{Authorization:'Bearer owner'}})).status,200);
 failLock=false;
 await DB.prepare('UPDATE account_deletions SET next_attempt_at=0 WHERE owner_uid=?').bind(a).run();
 for(let i=0;i<6;i++)await advanceDeletion(env,a);
 assert.equal((await DB.prepare('SELECT phase FROM account_deletions WHERE owner_uid=?').bind(a).first()).phase,'completed');
 assert.equal((await network(firestore+'/users/'+a,{headers:{Authorization:'Bearer owner'}})).status,404);
 assert.equal((await network(firestore+'/users/'+a+'/access/current',{headers:{Authorization:'Bearer owner'}})).status,404);
 const lookup=await post(auth+'/projects/'+project+'/accounts:lookup',{localId:[a]});assert.equal(lookup.users?.length||0,0);
 const b=await signup(email);assert.notEqual(b,a);
 const pb=await principal(b,email,'google-original');
 const second=await (await ensureAccess(env,b,undefined,pb)).json();
 assert.equal(second.active,false);assert.equal(second.source,'none');
 await assert.rejects(()=>assertActiveAccess(env,b),e=>e.code==='access_expired');
 await assert.rejects(()=>requestDeletion(confirmation(),env,b,pb),e=>e.code==='access_expired');
 assert.equal((await DB.prepare('SELECT COUNT(*) n FROM account_deletions WHERE owner_uid=?').bind(b).first()).n,0);
 assert.equal((await (await ensureAccess(env,c,undefined,pc)).json()).active,true);
 // A profile lock between profile read and projection commit must abort both writes.
 const d=await signup('race-'+suffix+'@example.com'),pd=await principal(d,'race-'+suffix+'@example.com','google-race');
 const routedFetch=globalThis.fetch;
 let raced=false;
 globalThis.fetch=async(input,init)=>{
   if(String(input).endsWith('/documents:commit')&&!raced){
     raced=true;
     const r=await network(firestore+'/users/'+d+'?updateMask.fieldPaths=deletionState',{method:'PATCH',headers:{Authorization:'Bearer owner','Content-Type':'application/json'},body:JSON.stringify({fields:{deletionState:{stringValue:'deleting'}}})});
     assert.equal(r.status,200);
   }
   return routedFetch(input,init);
 };
 await assert.rejects(()=>ensureAccess(env,d,undefined,pd),e=>e.code.startsWith('access_projection_write_'));
 assert.equal(raced,true);
 assert.equal((await network(firestore+'/users/'+d+'/access/current',{headers:{Authorization:'Bearer owner'}})).status,404);
 assert.equal((await DB.prepare('PRAGMA foreign_key_check').all()).results.length,0);
});
