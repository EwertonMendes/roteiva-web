import test from 'node:test';
import assert from 'node:assert/strict';
import {expandDropboxTree} from '../src/features/drive/expand-dropbox-tree.ts';
const id='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const folder=(fileId,name,path)=>({provider:'dropbox',connectionId:id,fileId,kind:'folder',name,parentIds:[],path});
test('selected Dropbox folder is traversed recursively and preserves parent paths',async()=>{
 const calls=[];
 const mock=async path=>{
  calls.push(path);
  if(path.includes('id%3AROOT'))return {files:[{id:'id:SUB',name:'Sub',isFolder:true,pathLower:'/originais/sub'},
   {id:'id:ONE',name:'a.png',isFolder:false,pathLower:'/originais/a.png'}],nextPageToken:null};
  if(path.includes('id%3ASUB'))return {files:[{id:'id:TWO',name:'b.mp4',isFolder:false,pathLower:'/originais/sub/b.mp4'}],nextPageToken:null};
  throw Error('Unexpected path '+path);
 };
 const results=await expandDropboxTree(mock,id,[folder('id:ROOT','Originais','/originais')],new Set(['id:ROOT']),new AbortController().signal,()=>{});
 assert.deepEqual(results.map(x=>x.fileId),['id:ROOT','id:SUB','id:ONE','id:TWO']);
 assert.deepEqual(results.filter(x=>x.kind==='asset').map(x=>x.path),['/originais/a.png','/originais/sub/b.mp4']);
 assert.equal(calls.length,2);
});
test('Dropbox scan rejects oversized trees without returning partial results',async()=>{
 const mock=async()=>({files:Array.from({length:501},(_,i)=>({id:'id:FILE_'+i,name:'File'+i,isFolder:false,pathLower:'/originais/file'+i})),nextPageToken:null});
 await assert.rejects(expandDropboxTree(mock,id,[folder('id:ROOT','Originais','/originais')],new Set(['id:ROOT']),new AbortController().signal,()=>{}),/500 arquivos/);
});
test('no folder selection leaves explicit assets unchanged without provider calls',async()=>{
 const original=[{provider:'dropbox',connectionId:id,fileId:'id:FILE',kind:'asset',name:'File',parentIds:[],path:'/file'}];
 const result=await expandDropboxTree(()=>{throw Error('unexpected');},id,original,new Set(),new AbortController().signal,()=>{});
 assert.deepEqual(result,original);
});
