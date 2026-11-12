import test from 'node:test';
import assert from 'node:assert/strict';
import {database} from './helpers/database.mjs';
import {libraryFor,mutateLibrary} from '../src/library.ts';
import {eraseOwnerLibraryChunk} from '../src/library-deletion.ts';
test('account cleanup erases only that owner tree, including nested and trashed nodes',async t=>{
 const f=database();t.after(f.close);const env={DB:f.DB};
 const a=await libraryFor(env,'alice',1),b=await libraryFor(env,'bob',1);
 const one=await (await mutateLibrary(env,a,null,{name:'one'})).json();
 await mutateLibrary(env,a,null,{name:'two',parentId:one.id});
 await mutateLibrary(env,a,one.id,{action:'trash',revision:1});
 assert.equal(await eraseOwnerLibraryChunk(env,'alice'),false);
 assert.equal(await eraseOwnerLibraryChunk(env,'alice'),true);
 assert.equal(f.sql.prepare('SELECT count(*) n FROM libraries WHERE id=?').get(b.id).n,1);
 assert.equal(f.sql.prepare('SELECT count(*) n FROM library_nodes WHERE library_id=?').get(a.id).n,0);
});
