import test from 'node:test';
import assert from 'node:assert/strict';
import {database} from './helpers/database.mjs';
import {libraryFor,mutateLibrary} from '../src/library.ts';
import {closeProjectReviews} from '../src/reviews.ts';
import {eraseProjectLibraryChunk} from '../src/library-deletion.ts';
import {assertProjectNotDeleting,advanceProjectDeletion} from '../src/project-deletion.ts';

const addJob=(db,owner,id,phase='reviews')=>{
  const timestamp=Date.now();
  db.sql.prepare("INSERT INTO project_deletions(owner_uid,project_id,operation_id,phase,next_attempt_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?)")
    .run(owner,id,crypto.randomUUID(),phase,timestamp,timestamp,timestamp);
};
const review=(db,owner,project)=>{
  const id=crypto.randomUUID(),timestamp=Date.now();
  db.sql.prepare(`INSERT INTO review_requests
    (id,owner_uid,client_id,project_id,client_name,project_name,studio_name,title,message,recipient_email,
     access_mode,status,current_version,expires_at,token_hash,encrypted_token,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id,owner,1,project,'Client','Project','Studio','Review','','',
      'link','draft',1,timestamp+3600000,'hash-'+id,'encrypted',timestamp,timestamp);
  return id;
};
test('project tombstone fences one project but not other projects or other owners',async t=>{
  const db=database();t.after(db.close);
  const env={DB:db.DB};
  const a=await libraryFor(env,'alice',11);
  const other=await libraryFor(env,'alice',12);
  const bob=await libraryFor(env,'bob',11);
  addJob(db,'alice',11);
  await assert.rejects(()=>assertProjectNotDeleting(env,'alice',11),e=>e.code==='project_deleting');
  await assert.doesNotReject(()=>assertProjectNotDeleting(env,'alice',12));
  await assert.doesNotReject(()=>assertProjectNotDeleting(env,'bob',11));
  await assert.rejects(()=>mutateLibrary(env,a,null,{name:'Late'}),/project_deleting/);
  await mutateLibrary(env,other,null,{name:'Safe'});
  await mutateLibrary(env,bob,null,{name:'Safe'});
  assert.throws(()=>db.sql.prepare("INSERT INTO libraries(id,owner_uid,project_id,created_at) VALUES('late','alice',11,0)").run(),/project_deleting/);
  assert.throws(()=>db.sql.prepare(`INSERT INTO review_requests
    (id,owner_uid,client_id,project_id,client_name,project_name,studio_name,title,message,recipient_email,
     access_mode,status,current_version,expires_at,token_hash,encrypted_token,created_at,updated_at)
    VALUES('late','alice',1,11,'Client','Project','Studio','New','','','link','draft',1,1,'latehash','sealed',0,0)`).run(),/project_deleting/);
});
test('deletion revokes only project reviews and cleans up its library subtree',async t=>{
  const db=database();t.after(db.close);
  const env={DB:db.DB,VIRTUAL_LIBRARY_ENABLED:'true'};
  const target=await libraryFor(env,'alice',11);
  const sibling=await libraryFor(env,'alice',12);
  const foreign=await libraryFor(env,'bob',11);
  await mutateLibrary(env,target,null,{name:'target'});
  await mutateLibrary(env,sibling,null,{name:'keep'});
  await mutateLibrary(env,foreign,null,{name:'foreign'});
  const doomed=review(db,'alice',11),saved=review(db,'alice',12),other=review(db,'bob',11);
  addJob(db,'alice',11);
  assert.equal(await closeProjectReviews(env,'alice',11),false);
  assert.equal(db.sql.prepare('SELECT status FROM review_requests WHERE id=?').get(doomed).status,'closed');
  assert.equal(await closeProjectReviews(env,'alice',11),false);
  assert.equal(await closeProjectReviews(env,'alice',11),true);
  assert.equal(db.sql.prepare('SELECT count(*) AS n FROM review_requests WHERE id=?').get(doomed).n,0);
  assert.equal(db.sql.prepare('SELECT status FROM review_requests WHERE id=?').get(saved).status,'draft');
  assert.equal(db.sql.prepare('SELECT status FROM review_requests WHERE id=?').get(other).status,'draft');
  assert.equal(await eraseProjectLibraryChunk(env,'alice',11),false);
  assert.equal(await eraseProjectLibraryChunk(env,'alice',11),true);
  assert.equal(db.sql.prepare('SELECT count(*) AS n FROM libraries WHERE id=?').get(target.id).n,0);
  assert.equal(db.sql.prepare('SELECT count(*) AS n FROM library_nodes WHERE library_id=?').get(target.id).n,0);
  assert.equal(db.sql.prepare('SELECT count(*) AS n FROM libraries WHERE id=?').get(sibling.id).n,1);
  assert.equal(db.sql.prepare('SELECT count(*) AS n FROM libraries WHERE id=?').get(foreign.id).n,1);
});
test('each cleanup step is resumable, leased, and retains a deletion tombstone',async t=>{
  const db=database();t.after(db.close);
  const env={DB:db.DB,VIRTUAL_LIBRARY_ENABLED:'true'};
  db.sql.prepare(`INSERT INTO drive_connections
    (id,owner_uid,google_account_id,google_email,status,scopes,created_at,updated_at)
    VALUES('drive','alice','google','a@example.com','connected','drive.file',1,1)`).run();
  db.sql.prepare(`INSERT INTO drive_upload_attempts
    (id,owner_uid,connection_id,connection_revision,project_id,linked_folder_id,target_folder_id,file_id,name,mime_type,size,status,expires_at)
    VALUES('one','alice','drive',1,11,'folder','folder','file','name','image/png',1,'completed',1000)`).run();
  addJob(db,'alice',11,'uploads');
  await advanceProjectDeletion(env,'alice',11);
  let row=db.sql.prepare("SELECT phase,lease_id FROM project_deletions WHERE owner_uid='alice' AND project_id=11").get();
  assert.equal(row.phase,'library');assert.equal(row.lease_id,null);
  assert.equal(db.sql.prepare("SELECT count(*) AS n FROM drive_upload_attempts WHERE owner_uid='alice' AND project_id=11").get().n,0);
  await advanceProjectDeletion(env,'alice',11);
  row=db.sql.prepare("SELECT phase FROM project_deletions WHERE owner_uid='alice' AND project_id=11").get();
  assert.equal(row.phase,'previews');
  await advanceProjectDeletion(env,'alice',11);
  row=db.sql.prepare("SELECT phase FROM project_deletions WHERE owner_uid='alice' AND project_id=11").get();
  assert.equal(row.phase,'firestore');
  await assert.rejects(()=>assertProjectNotDeleting(env,'alice',11),e=>e.code==='project_deleting');
});
