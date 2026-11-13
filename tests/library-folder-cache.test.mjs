import test from 'node:test';
import assert from 'node:assert/strict';
import {libraryFolderKey,getLibraryFolder,setLibraryFolder,libraryFolderFlight,invalidateLibraryFolders,clearLibraryFolders} from '../src/features/drive/library-folder-cache.ts';
const a=libraryFolderKey('alice',1,'root',false,'',true),b=libraryFolderKey('bob',1,'root',false,'',true);
test('private library folder snapshots isolate UID and project and invalidate explicitly',()=>{
 setLibraryFolder(a,{scope:a,nodes:[{id:'a'}],trail:[],nextPage:null});
 setLibraryFolder(b,{scope:b,nodes:[{id:'b'}],trail:[],nextPage:null});
 assert.deepEqual(getLibraryFolder(a)?.data.nodes,[{id:'a'}]);
 invalidateLibraryFolders('alice',1);
 assert.equal(getLibraryFolder(a),null);
 assert.deepEqual(getLibraryFolder(b)?.data.nodes,[{id:'b'}]);
 clearLibraryFolders('bob');assert.equal(getLibraryFolder(b),null);
});
test('concurrent identical folder reads share one promise',async()=>{
 let n=0;const key=libraryFolderKey('alice',2,'root',false,'',true);
 const job=()=>libraryFolderFlight(key,async()=>{n++;await Promise.resolve();return {value:1};});
 const [x,y]=await Promise.all([job(),job()]);
 assert.equal(n,1);assert.deepEqual(x,y);
});
