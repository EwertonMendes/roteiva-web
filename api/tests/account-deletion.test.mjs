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
 const {privateKey}=await generateKeyPair('RS256');
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
 assert.equal(await deleteFirestoreChunk('user-A','synthetic',5,fetcher),false);
 const removed=calls.filter(c=>c.method==='DELETE').map(c=>c.url);
 assert.ok(removed[0].endsWith('/users/user-A/projects/p1/notes/n1'));
 assert.ok(removed[1].endsWith('/users/user-A/projects/p1'));
 assert.ok(!removed.some(x=>x.endsWith('/users/user-A')));
 assert.ok(calls.every(x=>x.url.startsWith(origin)));
});
