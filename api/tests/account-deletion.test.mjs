import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPair,exportPKCS8} from 'jose';
import {database} from './helpers/database.mjs';
import {deletionConfigured,deleteFirestoreChunk} from '../src/firebase-admin.ts';
import {advanceDeletion,assertNotDeleting,requestDeletion,runPendingDeletions,deletionStatus} from '../src/account-deletion.ts';
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
 await runPendingDeletions(env); // identity, root marker, completed
 assert.equal(db.sql.prepare('SELECT phase FROM account_deletions WHERE owner_uid=?').get('user-A').phase,'completed');
 assert.equal(db.sql.prepare('SELECT count(*) AS n FROM drive_connections WHERE owner_uid=?').get('other-user').n,1);
 const accountDeletion=calls.findIndex(x=>x.url.includes('identitytoolkit.googleapis.com'));
 const firestoreRootDeletion=calls.findIndex(x=>x.url.endsWith('/users/user-A') && x.method==='DELETE');
 assert.ok(accountDeletion!==-1 && firestoreRootDeletion>accountDeletion,'Auth is deleted before the final marker');
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
 await assert.rejects(()=>requestDeletion(request,config,'owner-a'),e=>e.code==='deletion_not_locked');
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
