import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPair,exportPKCS8} from 'jose';
import {database} from './helpers/database.mjs';
import {deletionConfigured,deleteFirestoreChunk,deleteIdentity} from '../src/firebase-admin.ts';
import {advanceDeletion,assertNotDeleting,requestDeletion,runPendingDeletions,deletionStatus} from '../src/account-deletion.ts';
import {beginExchange,rememberGrant,revokeGuard,finishExchange} from '../src/oauth-guard.ts';
import {base64url} from '../src/crypto.ts';
const now=()=>Date.now();

test('disabled-by-default deletion cannot accept an irreversible operation',async t=>{
 const db=database();t.after(db.close);
 const env={DB:db.DB,ENVIRONMENT:'dev',FIREBASE_PROJECT_ID:'roteiva-web-dev'};
 assert.equal(deletionConfigured(env),false);
 await assert.rejects(()=>requestDeletion(new Request('https://example.test',{method:'POST',body:JSON.stringify({phrase:'EXCLUIR MINHA CONTA',acknowledged:true})}),env,'ownerA'),e=>e.code==='deletion_unavailable');
 assert.equal(db.sql.prepare('SELECT count(*) AS n FROM account_deletions').get().n,0);
 assert.equal((await (await deletionStatus(env,'ownerA')).json()).available,false);
});
test('D1 account-delete fence prevents OAuth grants and refresh writes after a request',async t=>{
 const db=database();t.after(db.close);
 const stamp=now();
 db.sql.prepare("INSERT INTO account_deletions(owner_uid,operation_id,phase,next_attempt_at,created_at,updated_at) VALUES (?,?,'revoking',?,?,?)")
 .run('owner-A','operation-A',stamp,stamp,stamp);
 const insert=db.sql.prepare("INSERT INTO drive_connections(id,owner_uid,google_account_id,google_email,status,scopes,created_at,updated_at) VALUES(?,?,?,?,'connected','readonly',?,?)");
 assert.throws(()=>insert.run('connection-A','owner-A','google-A','a@example.com',stamp,stamp),/account_deleting/);
 insert.run('connection-B','owner-B','google-B','b@example.com',stamp,stamp);
 db.sql.prepare("UPDATE drive_connections SET status='revocation_pending' WHERE id='connection-B'").run();
 await assert.rejects(()=>assertNotDeleting({...{DB:db.DB}},'owner-A'),e=>e.code==='account_deleting');
 await assert.doesNotReject(()=>assertNotDeleting({DB:db.DB},'owner-B'));
});
test('real SQL lease accepts exactly one concurrent executor',async t=>{
 const db=database();t.after(db.close);
 const stamp=now();
 db.sql.prepare("INSERT INTO account_deletions(owner_uid,operation_id,phase,next_attempt_at,created_at,updated_at) VALUES (?,?,'locking',?,?,?)")
 .run('owner-A','operation-A',stamp,stamp,stamp);
 const attempt=()=>db.DB.prepare("UPDATE account_deletions SET lease_id=?,lease_until=? WHERE owner_uid=? AND phase NOT IN ('completed','manual_review') AND lease_until<? AND next_attempt_at<=?")
 .bind(crypto.randomUUID(),stamp+60000,'owner-A',stamp,stamp).run();
 const results=await Promise.all([attempt(),attempt()]);
 assert.equal(results.reduce((s,x)=>s+x.meta.changes,0),1);
});
test('strict confirmation does not generate jobs from a wrong phrase',async t=>{
 const db=database();t.after(db.close);
 const {privateKey}=await generateKeyPair('RS256',{extractable:true});
 const env={DB:db.DB,ENVIRONMENT:'dev',FIREBASE_PROJECT_ID:'roteiva-web-dev',ACCOUNT_DELETION_ENABLED:'true',
 FIREBASE_ADMIN_CREDENTIALS_JSON:JSON.stringify({type:'service_account',project_id:'roteiva-web-dev',
   client_email:'test@roteiva-web-dev.iam.gserviceaccount.com',private_key:await exportPKCS8(privateKey),
   token_uri:'https://oauth2.googleapis.com/token'})};
 await assert.rejects(()=>requestDeletion(new Request('https://example.test',{method:'POST',body:JSON.stringify({phrase:'EXCLUIR',acknowledged:true})}),env,'owner-A'),e=>e.code==='invalid_confirmation');
 assert.equal(db.sql.prepare('SELECT count(*) n FROM account_deletions').get().n,0);
});
test('Firestore recursive deletion preserves root while deleting nested descendants',async()=>{
 const calls=[];const prefix='projects/roteiva-web-dev/databases/(default)/documents';
 const origin='https://firestore.googleapis.com/v1/';
 const fetcher=async (url,init)=>{
  const text=String(url);calls.push({url:text,method:init.method||'GET'});
  if(text.endsWith(':listCollectionIds')){
    if(text.includes('/users/user-A/projects/p1'))return Response.json({collectionIds:['notes']});
    if(text.endsWith('/users/user-A:listCollectionIds'))return Response.json({collectionIds:['projects']});
    return Response.json({collectionIds:[]});
  }
  if(text.includes('/users/user-A/projects?'))return Response.json({documents:[{name:prefix+'/users/user-A/projects/p1'}]});
  if(text.includes('/users/user-A/projects/p1/notes?'))return Response.json({documents:[{name:prefix+'/users/user-A/projects/p1/notes/n1'}]});
  if(init.method==='DELETE')return Response.json({});
  return Response.json({});
 };
 assert.equal(await deleteFirestoreChunk({FIREBASE_PROJECT_ID:'roteiva-web-dev'},'user-A','synthetic',5,fetcher),false);
 const removed=calls.filter(c=>c.method==='DELETE').map(c=>c.url);
 assert.ok(removed[0].endsWith('/users/user-A/projects/p1/notes/n1'));
 assert.ok(removed[1].endsWith('/users/user-A/projects/p1'));
 assert.ok(!removed.some(x=>x.endsWith('/users/user-A')));
 assert.ok(calls.every(x=>x.url.startsWith(origin)));
});


test("full deletion saga is resumable, verifies service calls and leaves another user's records untouched",async t=>{
 const {privateKey}=await generateKeyPair('RS256',{extractable:true});
 const db=database();t.after(db.close);
 const stamp=Date.now();
 db.sql.prepare("INSERT INTO drive_connections(id,owner_uid,google_account_id,google_email,status,scopes,created_at,updated_at) VALUES(?,?,?,?,'connected','readonly',?,?)")
  .run('account-B-connection','other-user','other-google','b@example.com',stamp,stamp);
 const env={DB:db.DB,ENVIRONMENT:'dev',FIREBASE_PROJECT_ID:'roteiva-web-dev',
   ACCOUNT_DELETION_ENABLED:'true',
   FIREBASE_ADMIN_CREDENTIALS_JSON:JSON.stringify({type:'service_account',project_id:'roteiva-web-dev',
     client_email:'test@roteiva-web-dev.iam.gserviceaccount.com',private_key:await exportPKCS8(privateKey),
     token_uri:'https://oauth2.googleapis.com/token'})};
 const orig=globalThis.fetch;
 const calls=[];
 globalThis.fetch=async(input,init={})=>{
   const url=String(input);calls.push({url,method:init.method||'GET'});
   if(url==='https://oauth2.googleapis.com/token')return Response.json({access_token:'synthetic-admin-token'});
   if(url.includes('firestore.googleapis.com')){
     if(url.endsWith(':listCollectionIds'))return Response.json({collectionIds:[]});
     return Response.json({});
   }
   if(url.includes('identitytoolkit.googleapis.com'))return Response.json({});
   throw new Error('Unexpected external endpoint');
 };
 t.after(()=>{globalThis.fetch=orig;});
 const req=new Request('https://example.test',{method:'POST',body:JSON.stringify({phrase:'EXCLUIR MINHA CONTA',acknowledged:true})});
 const accepted=await requestDeletion(req,env,'user-A');
 assert.equal(accepted.status,202);
 assert.equal(db.sql.prepare('SELECT phase FROM account_deletions WHERE owner_uid=?').get('user-A').phase,'revoking');
 await assert.rejects(()=>assertNotDeleting(env,'user-A'),e=>e.code==='account_deleting');
 await runPendingDeletions(env); // revocation
 assert.equal(db.sql.prepare('SELECT phase FROM account_deletions WHERE owner_uid=?').get('user-A').phase,'firestore');
 await runPendingDeletions(env); // verify empty and advance
 assert.equal(db.sql.prepare('SELECT phase FROM account_deletions WHERE owner_uid=?').get('user-A').phase,'identity');
 await runPendingDeletions(env); // root, identity last, completed
 assert.equal(db.sql.prepare('SELECT phase FROM account_deletions WHERE owner_uid=?').get('user-A').phase,'completed');
 assert.equal(db.sql.prepare('SELECT count(*) AS n FROM drive_connections WHERE owner_uid=?').get('other-user').n,1);
 const accountDeletion=calls.findIndex(x=>x.url.includes('identitytoolkit.googleapis.com'));
 const firestoreRootDeletion=calls.findIndex(x=>x.url.endsWith('/users/user-A') && x.method==='DELETE');
 assert.ok(firestoreRootDeletion!==-1 && accountDeletion>firestoreRootDeletion,'Auth is the final remote deletion');
 assert.equal((await (await deletionStatus(env,'user-A')).json()).operation.status,'completed');
});


test('failed admin lock preserves durable job and schedules retry without deleting identity',async t=>{
 const {privateKey}=await generateKeyPair('RS256',{extractable:true});
 const db=database();t.after(db.close);
 const account={type:'service_account',project_id:'roteiva-web-dev',client_email:'unit@roteiva-web-dev.iam.gserviceaccount.com',
 private_key:await exportPKCS8(privateKey),token_uri:'https://oauth2.googleapis.com/token'};
 const config={ENVIRONMENT:'dev',FIREBASE_PROJECT_ID:'roteiva-web-dev',ACCOUNT_DELETION_ENABLED:'true',
   FIREBASE_ADMIN_CREDENTIALS_JSON:JSON.stringify(account),DB:db.DB};
 const original=globalThis.fetch;
 let rootWrites=0,identityDeletes=0;
 globalThis.fetch=async(url)=>{
   if(String(url)==='https://oauth2.googleapis.com/token')return Response.json({access_token:'admin-test'});
   if(String(url).includes('firestore.googleapis.com')){rootWrites++;return Response.json({error:{status:'UNAVAILABLE'}},{status:503});}
   if(String(url).includes('identitytoolkit.googleapis.com')){identityDeletes++;return Response.json({});}
   throw Error('Unexpected URL');
 };
 t.after(()=>{globalThis.fetch=original;});
 const request=new Request('https://test.local',{method:'POST',
   body:JSON.stringify({phrase:'EXCLUIR MINHA CONTA',acknowledged:true})});
 const accepted=await requestDeletion(request,config,'owner-a');
 assert.equal(accepted.status,202);
 assert.equal((await accepted.json()).status,'processing');
 const job=db.sql.prepare('SELECT phase,attempts,next_attempt_at FROM account_deletions WHERE owner_uid=?').get('owner-a');
 assert.equal(job.phase,'locking');assert.equal(job.attempts,1);
 assert.ok(job.next_attempt_at>Date.now());
 assert.equal(rootWrites,1);assert.equal(identityDeletes,0);
 await runPendingDeletions(config);
 assert.equal(rootWrites,1,'retry waits until next_attempt_at');
});


test('Firestore deletion visits paginated subcollection IDs before reporting completion',async()=>{
  let collectionPage=0,folderCount=0;
  const fetcher=async (url,init={})=>{
    const target=String(url);
    if(target.endsWith(':listCollectionIds')){
      if(target.includes('pageToken=second'))throw new Error('Token must be sent in POST JSON, not URL');
      const body=JSON.parse(init.body);
      if(!body.pageToken){collectionPage++;return Response.json({collectionIds:['first'],nextPageToken:'second'});}
      assert.equal(body.pageToken,'second');
      return Response.json({collectionIds:['second']});
    }
    if(target.includes('/first?')||target.includes('/second?')){
      folderCount++;return Response.json({documents:[]});
    }
    throw Error('unexpected Firestore request '+target);
  };
  const empty=await deleteFirestoreChunk({FIREBASE_PROJECT_ID:'roteiva-web-dev'},'user-A','dummy',20,fetcher);
  assert.equal(empty,false,'collection IDs exist even when the first page is empty');
  assert.equal(folderCount,2);
  assert.equal(collectionPage,2,'IDs are enumerated in every verification pass');
});
test('Firestore deletion percent-encodes paths with reserved characters and cannot access other users',async()=>{
  const prefix='projects/roteiva-web-dev/databases/(default)/documents';
  const urls=[];
  const fetcher=async (url,init={})=>{
    const str=String(url);urls.push(str);
    if(str.includes('/a%231:listCollectionIds'))return Response.json({collectionIds:[]});
    if(str.endsWith(':listCollectionIds'))return Response.json({collectionIds:['projects']});
    if(str.includes('/projects?pageSize='))return Response.json({documents:[{name:prefix+'/users/user-A/projects/a#1'}]});
    if(str.endsWith('/a%231')&&init.method==='DELETE')return Response.json({});
    throw Error('unexpected URL '+str);
  };
  const done=await deleteFirestoreChunk({FIREBASE_PROJECT_ID:'roteiva-web-dev'},'user-A','dummy',1,fetcher);
  assert.equal(done,false);
  assert.ok(urls.some(x=>x.endsWith('/a%231')),'reserved character is encoded as URL path, not fragment');
});

test('Firebase administrative delete uses the official project endpoint and only USER_NOT_FOUND is idempotent',async()=>{
 const env={FIREBASE_PROJECT_ID:'roteiva-web-dev'};
 const call=async(url,init)=>{
   assert.equal(url,'https://identitytoolkit.googleapis.com/v1/projects/roteiva-web-dev/accounts:delete');
   assert.equal(init.method,'POST');
   assert.deepEqual(JSON.parse(init.body),{localId:'disposable'});
   assert.equal(init.headers.Authorization,'Bearer synthetic');
   return Response.json({error:{message:'USER_NOT_FOUND'}},{status:400});
 };
 await deleteIdentity(env,'disposable','synthetic',call);
 for(const status of [400,403,404,500])await assert.rejects(()=>deleteIdentity(env,'disposable','synthetic',
   async()=>Response.json({error:{message:'OTHER_ERROR'}},{status})));
});

test('Firestore database 404 cannot be interpreted as an empty user tree',async()=>{
 await assert.rejects(()=>deleteFirestoreChunk({FIREBASE_PROJECT_ID:'roteiva-web-dev'},'owner-A','synthetic',20,
   async()=>Response.json({error:{status:'NOT_FOUND'}},{status:404})),e=>e.code==='admin_service_unavailable');
});

test('Firestore drains multiple document pages, missing parents and thousands of records across bounded chunks',async()=>{
 const prefix='projects/roteiva-web-dev/databases/(default)/documents/users/owner-A';
 const docs=new Set(Array.from({length:1001},(_,n)=>prefix+'/projects/p'+String(n).padStart(4,'0')));
 docs.add(prefix+'/orphan/missing/notes/n1');
 let invocationFetches=0,maxInvocationFetches=0;
 const fetcher=async(url,init={})=>{
   invocationFetches++;maxInvocationFetches=Math.max(maxInvocationFetches,invocationFetches);
   if(invocationFetches>50)throw Error('Cloudflare Free external subrequest limit');
   const target=String(url).replace('https://firestore.googleapis.com/v1/','').split('?')[0];
   if(target.endsWith(':listCollectionIds')){
     const parent=target.slice(0,-':listCollectionIds'.length);
     const ids=new Set([...docs].filter(d=>d.startsWith(parent+'/')).map(d=>d.slice(parent.length+1).split('/')[0]));
     return Response.json({collectionIds:[...ids]});
   }
   if(init.method==='DELETE'){docs.delete(target);return Response.json({});}
   const children=[...new Set([...docs].filter(d=>d.startsWith(target+'/')).map(d=>target+'/'+d.slice(target.length+1).split('/')[0]))].sort();
   return Response.json({documents:children.slice(0,30).map(name=>({name})),...(children.length>30?{nextPageToken:'more'}:{})});
 };
 let done=false,chunks=0;
 while(!done&&chunks++<100){
   invocationFetches=0;
   done=await deleteFirestoreChunk({FIREBASE_PROJECT_ID:'roteiva-web-dev'},'owner-A','synthetic',20,fetcher);
 }
 assert.equal(done,true);assert.equal(docs.size,0);assert.ok(chunks>50);
 assert.ok(maxInvocationFetches<=40,'reserve external calls for admin token and other cron maintenance');
});

test('cron budgets one account per invocation and rotates after partial progress',async t=>{
 const db=database();t.after(db.close);
 const {privateKey}=await generateKeyPair('RS256',{extractable:true});
 const env={DB:db.DB,ENVIRONMENT:'dev',FIREBASE_PROJECT_ID:'roteiva-web-dev',ACCOUNT_DELETION_ENABLED:'true',
   FIREBASE_ADMIN_CREDENTIALS_JSON:JSON.stringify({type:'service_account',project_id:'roteiva-web-dev',
     client_email:'test@roteiva-web-dev.iam.gserviceaccount.com',private_key:await exportPKCS8(privateKey),
     token_uri:'https://oauth2.googleapis.com/token'})};
 const stamp=Date.now()-10000;
 for(const owner of ['owner-A','owner-B'])db.sql.prepare("INSERT INTO account_deletions(owner_uid,operation_id,phase,attempts,failed_phase,error_code,next_attempt_at,created_at,updated_at) VALUES(?,?,'firestore',3,'firestore','admin_service_unavailable',?,?,?)")
   .run(owner,'operation-'+owner,stamp,stamp,stamp);
 const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
 let calls=0;const visited=new Set();
 globalThis.fetch=async(url,init={})=>{
   assert.ok(++calls<=50,'entire cron invocation stays within Free quota');
   const target=String(url);
   if(target==='https://oauth2.googleapis.com/token')return Response.json({access_token:'synthetic'});
   const owner=target.includes('/owner-A')?'owner-A':'owner-B';visited.add(owner);
   if(target.endsWith(':listCollectionIds'))return Response.json({collectionIds:/\/users\/owner-[AB]\/projects\//.test(target)?[]:['projects']});
   if(init.method==='DELETE')return Response.json({});
   return Response.json({documents:Array.from({length:30},(_,n)=>({name:'projects/roteiva-web-dev/databases/(default)/documents/users/'+owner+'/projects/p'+n}))});
 };
 await runPendingDeletions(env);
 assert.equal(visited.size,1);
 const first=[...visited][0];
 assert.deepEqual({...db.sql.prepare('SELECT phase,attempts,failed_phase,error_code FROM account_deletions WHERE owner_uid=?').get(first)},
   {phase:'firestore',attempts:0,failed_phase:null,error_code:null});
 calls=0;await runPendingDeletions(env);
 assert.equal(visited.size,2,'a large account does not starve the next due account');
});

test('last allowed request failure is not hidden as a cooperative yield',async()=>{
 let calls=0;
 const prefix='projects/roteiva-web-dev/databases/(default)/documents/users/owner-A';
 await assert.rejects(()=>deleteFirestoreChunk({FIREBASE_PROJECT_ID:'roteiva-web-dev'},'owner-A','synthetic',20,
   async(url,init={})=>{
     if(++calls===30)return Response.json({error:{status:'PERMISSION_DENIED'}},{status:403});
     if(String(url).endsWith(':listCollectionIds'))return Response.json({collectionIds:String(url).includes('/projects/p')?[]:['projects']});
     if(init.method==='DELETE')return Response.json({});
     return Response.json({documents:Array.from({length:30},(_,n)=>({name:prefix+'/projects/p'+n}))});
   }),error=>error.code==='admin_permission_denied');
 assert.equal(calls,30);
});

test('final profile failure preserves Auth and retries the identity phase',async t=>{
 const db=database();t.after(db.close);
 const {privateKey}=await generateKeyPair('RS256',{extractable:true});
 const env={DB:db.DB,ENVIRONMENT:'dev',FIREBASE_PROJECT_ID:'roteiva-web-dev',ACCOUNT_DELETION_ENABLED:'true',
   FIREBASE_ADMIN_CREDENTIALS_JSON:JSON.stringify({type:'service_account',project_id:'roteiva-web-dev',
     client_email:'test@roteiva-web-dev.iam.gserviceaccount.com',private_key:await exportPKCS8(privateKey),
     token_uri:'https://oauth2.googleapis.com/token'})};
 const stamp=Date.now()-1000;
 db.sql.prepare("INSERT INTO account_deletions(owner_uid,operation_id,phase,next_attempt_at,created_at,updated_at) VALUES('owner-A','operation-A','identity',?,?,?)").run(stamp,stamp,stamp);
 const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
 let identityCalls=0;
 globalThis.fetch=async(url,init={})=>{
   if(String(url)==='https://oauth2.googleapis.com/token')return Response.json({access_token:'synthetic'});
   if(String(url).includes('identitytoolkit')){identityCalls++;return Response.json({});}
   if(init.method==='DELETE')return Response.json({error:{status:'UNAVAILABLE'}},{status:503});
   return Response.json({collectionIds:[]});
 };
 await advanceDeletion(env,'owner-A');
 assert.equal(identityCalls,0);
 const job=db.sql.prepare('SELECT phase,failed_phase,attempts FROM account_deletions').get();
 assert.equal(job.phase,'identity');assert.equal(job.failed_phase,'identity');assert.equal(job.attempts,1);
});

test('manual review retains failed stage, releases lease and cannot be retried automatically',async t=>{
 const db=database();t.after(db.close);
 const {privateKey}=await generateKeyPair('RS256',{extractable:true});
 const env={DB:db.DB,ENVIRONMENT:'dev',FIREBASE_PROJECT_ID:'roteiva-web-dev',ACCOUNT_DELETION_ENABLED:'true',
   FIREBASE_ADMIN_CREDENTIALS_JSON:JSON.stringify({type:'service_account',project_id:'roteiva-web-dev',client_email:'test@roteiva-web-dev.iam.gserviceaccount.com',
     private_key:await exportPKCS8(privateKey),token_uri:'https://oauth2.googleapis.com/token'})};
 const stamp=Date.now();
 db.sql.prepare("INSERT INTO account_deletions(owner_uid,operation_id,phase,attempts,next_attempt_at,created_at,updated_at) VALUES('owner-A','op-A','locking',9,?,?,?)").run(stamp,stamp,stamp);
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;return Response.json({},{status:503});};t.after(()=>{globalThis.fetch=original;});
 await advanceDeletion(env,'owner-A');
 const job=db.sql.prepare('SELECT phase,failed_phase,lease_id,attempts FROM account_deletions').get();
 assert.equal(job.phase,'manual_review');assert.equal(job.failed_phase,'locking');assert.equal(job.lease_id,null);assert.equal(job.attempts,10);
 await runPendingDeletions(env);assert.equal(calls,1);
 assert.throws(()=>db.sql.prepare("INSERT INTO oauth_transactions(state_hash,owner_uid,browser_hash,encrypted_verifier,nonce,expires_at,created_at) VALUES('late','owner-A','','','',0,0)").run(),/account_deleting/);
});

test('in-flight Google grant is fenced, encrypted and retained on temporary revocation failure',async t=>{
 const db=database();t.after(db.close);
 const env={DB:db.DB,ENVIRONMENT:'dev',TOKEN_KEY_VERSION:'v1',TOKEN_KEYS:JSON.stringify({v1:base64url(crypto.getRandomValues(new Uint8Array(32)))})};
 const exchange=await beginExchange(env,'owner-A');
 assert.equal(await revokeGuard(env,'owner-A'),false,'live exchange blocks progress');
 await rememberGrant(env,'owner-A',exchange,'synthetic-refresh-secret');
 assert.ok(!db.sql.prepare('SELECT encrypted_token FROM oauth_exchange_guards').get().encrypted_token.includes('synthetic-refresh-secret'));
 const stamp=Date.now();
 db.sql.prepare("INSERT INTO account_deletions(owner_uid,operation_id,phase,next_attempt_at,created_at,updated_at) VALUES('owner-A','op-A','revoking',?,?,?)").run(stamp,stamp,stamp);
 await assert.rejects(()=>beginExchange(env,'owner-A'),/account_deleting/);
 const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
 globalThis.fetch=async(url,init)=>{
   assert.equal(url,'https://oauth2.googleapis.com/revoke');assert.equal(init.redirect,'manual');
   assert.equal(init.body.get('token'),'synthetic-refresh-secret');
   return Response.json({error:'temporarily_unavailable'},{status:503});
 };
 await assert.rejects(()=>revokeGuard(env,'owner-A'),e=>e.code==='google_revocation_unavailable');
 assert.equal(db.sql.prepare('SELECT COUNT(*) n FROM oauth_exchange_guards').get().n,1);
 globalThis.fetch=async()=>new Response(null,{status:200});
 assert.equal(await revokeGuard(env,'owner-A'),false);
 assert.equal(await revokeGuard(env,'owner-A'),true);
 const other=await beginExchange(env,'owner-B');
 db.sql.prepare('UPDATE oauth_exchange_guards SET started_at=0 WHERE exchange_id=?').run(other);
 await assert.rejects(()=>revokeGuard(env,'owner-B'),e=>e.code==='oauth_exchange_unresolved');
 await finishExchange(env,'owner-B',other);
});
