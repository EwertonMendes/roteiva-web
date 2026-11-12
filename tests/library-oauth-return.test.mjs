import test from 'node:test';
import assert from 'node:assert/strict';
import {rememberLibraryOAuthReturn,readLibraryOAuthReturn,forgetLibraryOAuthReturn}
 from '../src/features/drive/library-oauth-return.ts';

function store(){
 const values=new Map();
 return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key),values};
}
const folder='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';

test('OAuth navigation intent restores only the same UID within a short TTL',()=>{
 const s=store();
 assert.equal(rememberLibraryOAuthReturn('uid-a',42,folder,s,1000),true);
 assert.deepEqual(readLibraryOAuthReturn('uid-a',s,1001),{projectId:42,parentId:folder});
 assert.deepEqual(readLibraryOAuthReturn('uid-a',s,600_999),{projectId:42,parentId:folder});
 assert.equal(readLibraryOAuthReturn('uid-a',s,601_000),null);
 assert.equal(s.values.size,0);
});
test('OAuth navigation intent is never shared across identities',()=>{
 const s=store();
 rememberLibraryOAuthReturn('uid-a',42,'root',s,1000);
 assert.equal(readLibraryOAuthReturn('uid-b',s,1001),null);
 assert.equal(readLibraryOAuthReturn('uid-a',s,1001),null);
});
test('rejects invalid projects, paths and malformed or future-dated intents',()=>{
 const s=store();
 for(const [projectId,parentId] of [[0,'root'],[-1,'root'],[42,'../other'],[42,'not-a-folder'],[Number.MAX_SAFE_INTEGER+1,'root']])
  assert.equal(rememberLibraryOAuthReturn('uid',projectId,parentId,s,1000),false);
 assert.equal(s.values.size,0);
 rememberLibraryOAuthReturn('uid',42,'root',s,1000);
 const [key]=s.values.keys();
 s.values.set(key,'{not-json');
 assert.equal(readLibraryOAuthReturn('uid',s,1001),null);
 s.values.set(key,JSON.stringify({uid:'uid',projectId:42,parentId:'root',expiresAt:90000000}));
 assert.equal(readLibraryOAuthReturn('uid',s,1001),null);
});
test('storage errors never break the provider redirect',()=>{
 const noStore={getItem(){throw Error('denied');},setItem(){throw Error('denied');},removeItem(){throw Error('denied');}};
 assert.equal(rememberLibraryOAuthReturn('uid',42,'root',noStore),false);
 assert.equal(readLibraryOAuthReturn('uid',noStore),null);
 assert.doesNotThrow(()=>forgetLibraryOAuthReturn(noStore));
});
