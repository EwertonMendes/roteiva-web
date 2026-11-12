import test from 'node:test';
import assert from 'node:assert/strict';
import {database} from './helpers/database.mjs';
import {createLibraryStructure} from '../src/library-structure.ts';
import {libraryFor,mutateLibrary} from '../src/library-core.ts';
test('structure creation is atomic, owner-scoped and retrying the same request never duplicates folders',async t=>{
 const f=database();t.after(f.close);const env={DB:f.DB},input={attemptId:crypto.randomUUID(),parentId:'root',folders:[{key:'child',parentKey:'parent',name:'Originais'},{key:'parent',parentKey:null,name:'Vídeos'}]};
 const first=await (await createLibraryStructure(env,'alice',17,input)).json();
 const second=await (await createLibraryStructure(env,'alice',17,input)).json();assert.deepEqual(first,second);
 assert.equal(f.sql.prepare("SELECT count(*) n FROM library_nodes WHERE kind='folder'").get().n,3);
 await assert.rejects(createLibraryStructure(env,'alice',17,{...input,folders:[{key:'different',parentKey:null,name:'Other'}]}),e=>e.code==='library_structure_mismatch');
 const lib=await libraryFor(env,'alice',17),foreign=await libraryFor(env,'bob',17);
 await assert.rejects(createLibraryStructure(env,'bob',17,{...input,attemptId:crypto.randomUUID(),parentId:first.created[0].id}),e=>e.code==='library_node_unavailable');
 assert.notEqual(lib.id,foreign.id);
});
test('cycles, missing parents and excessive resulting depth cannot leave a partial structure',async t=>{
 const f=database();t.after(f.close);const env={DB:f.DB},lib=await libraryFor(env,'alice',17);
 for(const folders of [[{key:'self',parentKey:'self',name:'Cycle'}],[{key:'child',parentKey:'missing',name:'Child'}]])
  await assert.rejects(createLibraryStructure(env,'alice',17,{attemptId:crypto.randomUUID(),parentId:'root',folders}),e=>e.code==='invalid_library_structure');
 let parent='root';for(let i=0;i<15;i++)parent=(await (await mutateLibrary(env,lib,null,{name:'Depth '+i,parentId:parent})).json()).id;
 const before=f.sql.prepare('SELECT count(*) n FROM library_nodes').get().n;
 await assert.rejects(createLibraryStructure(env,'alice',17,{attemptId:crypto.randomUUID(),parentId:parent,folders:[{key:'one',parentKey:null,name:'One'},{key:'two',parentKey:'one',name:'Two'}]}),e=>e.code==='library_depth_exceeded');
 assert.equal(f.sql.prepare('SELECT count(*) n FROM library_nodes').get().n,before);
});
test('assisted structures reuse unambiguous active folders and never merge a stale renamed folder',async t=>{
 const f=database();t.after(f.close);const env={DB:f.DB},folders=[{key:'one',parentKey:null,name:'Vídeos'},{key:'two',parentKey:'one',name:'Originais'}];
 const initial=await (await createLibraryStructure(env,'alice',17,{attemptId:crypto.randomUUID(),parentId:'root',folders,reuseExisting:true})).json();
 const repeated=await (await createLibraryStructure(env,'alice',17,{attemptId:crypto.randomUUID(),parentId:'root',folders,reuseExisting:true})).json();
 assert.deepEqual(repeated.created,initial.created);assert.equal(f.sql.prepare('SELECT count(*) n FROM library_nodes').get().n,3);
 const lib=await libraryFor(env,'alice',17);await mutateLibrary(env,lib,null,{name:'Vídeos'});
 await assert.rejects(createLibraryStructure(env,'alice',17,{attemptId:crypto.randomUUID(),parentId:'root',folders,reuseExisting:true}),e=>e.code==='library_structure_ambiguous');
 const isolated=await libraryFor(env,'alice',18),node=await (await mutateLibrary(env,isolated,null,{name:'Vídeos'})).json();
 const batch=f.DB.batch.bind(f.DB);let renamed=false;
 f.DB.batch=async statements=>{if(!renamed&&statements.length>1){renamed=true;f.sql.prepare("UPDATE library_nodes SET name='Alterada',revision=revision+1 WHERE id=?").run(node.id);}return batch(statements);};
 await assert.rejects(createLibraryStructure(env,'alice',18,{attemptId:crypto.randomUUID(),parentId:'root',folders,reuseExisting:true}),e=>e.code==='library_changed');
 assert.equal(f.sql.prepare('SELECT count(*) n FROM library_nodes WHERE library_id=?').get(isolated.id).n,2);
});
