import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPair,exportPKCS8} from 'jose';
import {database} from './helpers/database.mjs';
import {projectDeletionStatus,drainProjectDeletion,runPendingProjectDeletions} from '../src/project-deletion.ts';
import {fenceProject,eraseProjectFirestoreChunk} from '../src/project-deletion-firestore.ts';

/** Deterministic REST emulator: checks actual Firestore document paths,
 * updateTime preconditions, atomic multi-document commits and sync counters.
 * No network access, real user data or Cloudflare credentials are used.
 */
const ROOT='projects/roteiva-web-dev/databases/(default)/documents';
const BASE='https://firestore.googleapis.com/v1/'+ROOT;
const alice=ROOT+'/users/alice';
const bob=ROOT+'/users/bob';
const vi=(value)=>({integerValue:String(value)});
const vs=(value)=>({stringValue:String(value)});
const NAMES=['clients','projects','tasks','deliveries','events','financeEntries','activities'];
const counts={clients:0,projects:1,tasks:32,deliveries:0,events:1,financeEntries:1,activities:0};
const fields=(projectId,id,extra={})=>({ownerUid:vs('alice'),projectId:vi(projectId),id:vi(id),revision:vi(1),...extra});
function initial(){
 const docs=new Map();let revision=0;
 function put(path,value){const name=path.startsWith(ROOT)?path:alice+'/'+path;
  docs.set(name,{name,updateTime:'2026-11-17T00:00:'+String(++revision).padStart(2,'0')+'Z',fields:value});
 }
 put('projects/11',{...fields(11,11),name:vs('To remove')});
 put(bob+'/projects/11',{ownerUid:vs('bob'),name:vs('Foreign owner')});
 for(let i=1;i<=31;i++)put('tasks/'+i,fields(11,i));
 put('tasks/99',fields(12,99));
 put('events/41',fields(11,41));
 put('financeEntries/51',fields(11,51,{amountCents:vi(35200),clientId:vi(2),project:vs('Old project')}));
 put('driveFolders/11_connection_folder',fields(11,11));
 put('dropboxFolders/11_other_folder',fields(11,11));
 put('sync/state',{ownerUid:vs('alice'),revision:vi(1),
  domains:{mapValue:{fields:Object.fromEntries(NAMES.map(n=>[n,vi(1)]))}},
  counts:{mapValue:{fields:Object.fromEntries(NAMES.map(n=>[n,vi(counts[n])]))}}});
 return docs;
}
function mockFirestore(docs,{conflictOnce=false}={}){
 let commits=0,queries=0,conflicts=0;
 return {
  get commits(){return commits;},get queries(){return queries;},get conflicts(){return conflicts;},
  async fetch(input,init={}){
   const url=String(input);
   if(url==='https://oauth2.googleapis.com/token')return Response.json({access_token:'test-admin-token'});
   if(url.includes('/projectDeletionFences/')&&init.method==='PATCH')
     return Response.json({fields:{ownerUid:vs('alice'),projectId:vi(11)}});
   if(url.endsWith(':runQuery')&&init.method==='POST'){
     queries++;
     const query=JSON.parse(init.body).structuredQuery;
     const collection=query.from[0].collectionId;
     const id=Number(query.where.fieldFilter.value.integerValue);
     const matches=[...docs.values()].filter(doc=>doc.name.startsWith(alice+'/'+collection+'/') &&
       Number(doc.fields.projectId?.integerValue)===id).slice(0,query.limit);
     return Response.json(matches.map(document=>({document})));
   }
   if(url.endsWith(':commit')&&init.method==='POST'){
     if(conflictOnce&&conflicts++===0)return Response.json({error:'Conflict'},{status:409});
     const data=JSON.parse(init.body);
     const writes=data.writes;
     const checks=writes.every(write=>{
       const name=write.delete||write.update?.name;
       return docs.get(name)?.updateTime===write.currentDocument.updateTime;
     });
     if(!checks)return Response.json({error:'Write precondition failed'},{status:409});
     // Firestore commit is atomic: all preconditions were checked before mutation.
     for(const write of writes){
       const name=write.delete||write.update?.name;
       if(write.delete){docs.delete(name);continue;}
       const previous=docs.get(name);
       const nextFields={...previous.fields,...write.update.fields};
       docs.set(name,{name,updateTime:'2026-11-17T01:00:'+String(++commits).padStart(2,'0')+'Z',
         fields:nextFields});
     }
     commits++;
     return Response.json({writeResults:writes.map(()=>({}))});
   }
   if(init.method==='GET'&&url.startsWith(BASE+'/')){
     const key=url.slice('https://firestore.googleapis.com/v1/'.length);
     const document=docs.get(key);
     return document?Response.json(document):Response.json({error:'Not found'},{status:404});
   }
   throw Error('Unexpected Firestore request: '+(init.method||'GET')+' '+url);
  }
 };
}
async function adminEnv(){
 const {privateKey}=await generateKeyPair('RS256',{extractable:true});
 return {ENVIRONMENT:'dev',ACCOUNT_DELETION_ENABLED:'true',FIREBASE_PROJECT_ID:'roteiva-web-dev',
   FIREBASE_ADMIN_CREDENTIALS_JSON:JSON.stringify({
     type:'service_account',project_id:'roteiva-web-dev',
     client_email:'test@roteiva-web-dev.iam.gserviceaccount.com',
     private_key:await exportPKCS8(privateKey),token_uri:'https://oauth2.googleapis.com/token'
   })};
}
test('project cleanup paginates every dependency, updates sync atomically, retains finance and isolates other owner',async t=>{
 const docs=initial(),remote=mockFirestore(docs),env=await adminEnv();
 t.mock.method(globalThis,'fetch',remote.fetch);
 await fenceProject(env,'alice',11);
 let finished=false;
 for(let attempt=0;attempt<20;attempt++){
   finished=await eraseProjectFirestoreChunk(env,'alice',11);
   if(finished)break;
 }
 assert.equal(finished,true,'all documents including the project must be fully removed');
 assert.equal(docs.has(alice+'/projects/11'),false);
 assert.equal(docs.has(bob+'/projects/11'),true);
 assert.equal(docs.has(alice+'/tasks/99'),true,'unrelated task survives');
 for(const name of ['tasks','events','driveFolders','dropboxFolders'])
   assert.equal([...docs.keys()].filter(k=>k.startsWith(alice+'/'+name+'/') &&
     Number(docs.get(k).fields.projectId?.integerValue)===11).length,0);
 const invoice=docs.get(alice+'/financeEntries/51');
 assert.equal(invoice.fields.projectId.integerValue,'0');
 assert.equal(invoice.fields.amountCents.integerValue,'35200');
 assert.equal(invoice.fields.project.stringValue,'Old project');
 const sync=docs.get(alice+'/sync/state').fields;
 assert.equal(Number(sync.counts.mapValue.fields.projects.integerValue),0);
 assert.equal(Number(sync.counts.mapValue.fields.tasks.integerValue),1);
 assert.equal(Number(sync.counts.mapValue.fields.events.integerValue),0);
 assert.equal(Number(sync.counts.mapValue.fields.financeEntries.integerValue),1);
 assert.ok(Number(sync.revision.integerValue)>1);
 assert.ok(remote.commits>4&&remote.queries>4,'large cleanup requires multiple bounded commits');
 assert.equal(await eraseProjectFirestoreChunk(env,'alice',11),true,'retry after completion is idempotent');
});
test('a transient Firestore conflict fails closed and resuming deletes no unrelated records',async t=>{
 const docs=initial(),remote=mockFirestore(docs,{conflictOnce:true}),env=await adminEnv();
 t.mock.method(globalThis,'fetch',remote.fetch);
 await assert.rejects(()=>eraseProjectFirestoreChunk(env,'alice',11),error=>error.code==='project_firestore_conflict');
 assert.equal(docs.has(alice+'/tasks/1'),true,'conflict must not create a partial commit');
 assert.equal(docs.get(alice+'/sync/state').fields.revision.integerValue,'1');
 assert.equal(await eraseProjectFirestoreChunk(env,'alice',11),false);
 assert.equal(docs.has(alice+'/tasks/1'),false);
 assert.equal(docs.has(alice+'/tasks/99'),true);
});

test('GET remains read-only; one background drain completes every Firestore batch without browser polling',async t=>{
  const db=database();t.after(db.close);
  const docs=initial(),remote=mockFirestore(docs);
  const env={...await adminEnv(),DB:db.DB};
  t.mock.method(globalThis,'fetch',remote.fetch);
  const now=Date.now();
  db.sql.prepare("INSERT INTO project_deletions(owner_uid,project_id,operation_id,phase,next_attempt_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?)")
    .run('alice',11,'op-isolated','firestore',now,now,now);
  const result=await projectDeletionStatus(env,'alice',11);
  assert.deepEqual(await result.json(),{status:'processing',phase:'firestore',operationId:'op-isolated'});
  assert.equal(remote.commits,0,'a status GET must not mutate Firestore');
  assert.equal(db.sql.prepare("SELECT phase FROM project_deletions WHERE owner_uid='alice' AND project_id=11").get().phase,'firestore');
  // This models the Worker's ctx.waitUntil() after the POST response has been
  // sent, with no status requests from a mounted page.
  await drainProjectDeletion(env,'alice',11,36,20000);
  assert.equal(db.sql.prepare("SELECT phase FROM project_deletions WHERE owner_uid='alice' AND project_id=11").get().phase,'completed');
  assert.equal(docs.has(alice+'/projects/11'),false);
  assert.equal(docs.has(bob+'/projects/11'),true);
  assert.equal(docs.has(alice+'/tasks/99'),true);
  assert.equal(docs.get(alice+'/financeEntries/51').fields.projectId.integerValue,'0');
  const sync=docs.get(alice+'/sync/state').fields;
  assert.equal(sync.counts.mapValue.fields.projects.integerValue,'0');
  assert.equal(sync.counts.mapValue.fields.tasks.integerValue,'1');
  assert.equal((await (await projectDeletionStatus(env,'alice',11)).json()).status,'completed');
});
test('cron independently resumes a paused project deletion without a browser connection',async t=>{
  const db=database();t.after(db.close);
  const docs=initial(),remote=mockFirestore(docs);
  const env={...await adminEnv(),DB:db.DB};
  t.mock.method(globalThis,'fetch',remote.fetch);
  const now=Date.now();
  db.sql.prepare("INSERT INTO project_deletions(owner_uid,project_id,operation_id,phase,next_attempt_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?)")
    .run('alice',11,'op-cron','firestore',now,now,now);
  await runPendingProjectDeletions(env);
  assert.equal(db.sql.prepare("SELECT phase FROM project_deletions WHERE owner_uid='alice' AND project_id=11").get().phase,'completed');
  assert.equal(docs.has(alice+'/projects/11'),false);
});
