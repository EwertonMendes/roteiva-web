import test from 'node:test';
import assert from 'node:assert/strict';
import {LibraryPreviewCache} from '../src/features/drive/library-preview-cache.ts';

test('a second image open reuses tab memory; concurrent requests deduplicate and owner changes purge it',async t=>{
 const cache=new LibraryPreviewCache();
 const previousCreate=URL.createObjectURL,previousRevoke=URL.revokeObjectURL;
 const revoked=[];
 let next=0;
 URL.createObjectURL=()=>('blob:preview/'+(++next));
 URL.revokeObjectURL=url=>revoked.push(url);
 t.after(()=>{URL.createObjectURL=previousCreate;URL.revokeObjectURL=previousRevoke;cache.clear();});
 cache.scope('first-owner');
 let reads=0;
 const load=async()=>{reads++;await Promise.resolve();return new Blob(['abc'],{type:'image/png'});};
 const [one,two]=await Promise.all([cache.image('project:node:rev1',load),cache.image('project:node:rev1',load)]);
 assert.equal(one,two);assert.equal(reads,1);
 assert.equal(cache.get('project:node:rev1'),one);
 cache.scope('second-owner');
 assert.equal(cache.get('project:node:rev1'),null);
 assert.ok(revoked.includes(one));
 assert.equal(await cache.image('project:node:rev1',load),'blob:preview/2');
 assert.equal(reads,2);
});

test('expired entries and in-flight responses from a previous identity are never cached',async t=>{
 const cache=new LibraryPreviewCache();
 const create=URL.createObjectURL,revoke=URL.revokeObjectURL,now=Date.now;
 let count=0;
 URL.createObjectURL=()=>('blob:'+ ++count);
 URL.revokeObjectURL=()=>{};
 t.after(()=>{URL.createObjectURL=create;URL.revokeObjectURL=revoke;Date.now=now;cache.clear();});
 const start=Date.now();Date.now=()=>start;
 cache.scope('alice');
 const url=await cache.image('a',async()=>new Blob(['ok']));
 assert.equal(cache.get('a'),url);
 Date.now=()=>start+2*60*1000+1;
 assert.equal(cache.get('a'),null);
 let resolve;
 const pending=cache.image('b',()=>new Promise(r=>{resolve=r;}));
 cache.scope('bob');
 resolve(new Blob(['other']));
 await assert.rejects(pending,/sessão mudou/);
 assert.equal(cache.get('b'),null);
});
