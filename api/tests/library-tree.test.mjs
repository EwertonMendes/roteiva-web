import test from 'node:test';
import assert from 'node:assert/strict';
import {database} from './helpers/database.mjs';
function fixture(t){const f=database();t.after(f.close);
 for(const id of ['a','b']){f.sql.prepare('INSERT INTO libraries(id,owner_uid,project_id,created_at) VALUES(?,?,1,0)').run(id,id);
 f.sql.prepare("INSERT INTO library_nodes(library_id,id,parent_id,kind,name) VALUES(?,'root',NULL,'folder','Root')").run(id);}
 return f.sql;
}
function add(sql,id,parent='root',kind='folder'){sql.prepare('INSERT INTO library_nodes(library_id,id,parent_id,kind,name) VALUES(?,?,?,?,?)').run('a',id,parent,kind,id);}
test('tree constraints reject cycles, foreign parents, nonfolder parents and mutable roots',t=>{
 const sql=fixture(t);add(sql,'videos');add(sql,'raw','videos');add(sql,'clip','raw','asset');
 assert.throws(()=>sql.prepare("UPDATE library_nodes SET parent_id='raw' WHERE library_id='a' AND id='videos'").run(),/library_cycle/);
 assert.throws(()=>add(sql,'invalid','clip'),/library_parent_denied/);
 sql.prepare("INSERT INTO library_nodes VALUES('b','other','root','folder','Other','active',1)").run();
 assert.throws(()=>add(sql,'foreign','other'),/library_parent_denied/);
 assert.throws(()=>sql.prepare("UPDATE library_nodes SET state='trashed' WHERE id='root'").run(),/library_root_immutable/);
 assert.throws(()=>sql.prepare("UPDATE library_nodes SET id='changed' WHERE id='raw'").run(),/library_identity_immutable/);
 assert.throws(()=>sql.prepare("DELETE FROM library_nodes WHERE library_id='b' AND id='root'").run(),/library_root_immutable/);
 assert.throws(()=>sql.prepare("UPDATE libraries SET owner_uid='mallory' WHERE id='a'").run(),/library_identity_immutable/);
});
test('depth checked for whole moved subtree and maximum insert depth',t=>{
 const sql=fixture(t);let parent='root';for(let i=1;i<=16;i++){add(sql,'d'+i,parent);parent='d'+i;}
 assert.throws(()=>add(sql,'too-deep',parent),/library_depth_exceeded/);
 add(sql,'branch');add(sql,'leaf','branch');
 assert.throws(()=>sql.prepare("UPDATE library_nodes SET parent_id='d15' WHERE library_id='a' AND id='branch'").run(),/library_depth_exceeded/);
 assert.equal(sql.prepare("SELECT parent_id FROM library_nodes WHERE id='branch'").get().parent_id,'root');
});
test('sequential competing moves cannot form a cycle',t=>{
 const sql=fixture(t);add(sql,'left');add(sql,'right');
 sql.prepare("UPDATE library_nodes SET parent_id='right' WHERE library_id='a' AND id='left'").run();
 assert.throws(()=>sql.prepare("UPDATE library_nodes SET parent_id='left' WHERE library_id='a' AND id='right'").run(),/library_cycle/);
});
