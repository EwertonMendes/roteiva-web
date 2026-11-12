import test from 'node:test';
import assert from 'node:assert/strict';
import {folderPlanFromPaths} from '../src/features/drive/library-structure-plan.ts';
import {importLibraryBatch} from '../src/features/drive/library-import.ts';
test('virtual paths share parents, reject ambiguous/deep paths and never become physical operations',()=>{
 const plan=folderPlanFromPaths('Vídeos/Originais\nVídeos/Edição\nVídeos/Originais');
 assert.deepEqual(plan.map(x=>x.name),['Vídeos','Originais','Edição']);
 assert.equal(plan[1].parentKey,plan[0].key);assert.equal(plan[2].parentKey,plan[0].key);
 for(const path of ['../arquivo','Pasta//Filho','Pasta\\Filho',Array(17).fill('Pasta').join('/')])assert.throws(()=>folderPlanFromPaths(path));
});
test('batch import preserves confirmed items and retains the uncertain remainder after quota/transport failure',async()=>{
 const items=Array.from({length:23},(_,i)=>({provider:'google_drive',connectionId:'account',fileId:'file-'+i,name:'File '+i})),calls=[];
 const call=async(_path,_method,body)=>{
  calls.push(body.items);
  if(calls.length===2)throw Object.assign(new Error('Quota'),{code:'provider_rate_limited'});
  return {results:body.items.map((x,i)=>({fileId:x.fileId,status:i===3?'failed':'added',code:i===3?'source_unavailable':undefined}))};
 };
 const failed=await importLibraryBatch(call,'/imports','root',items,new AbortController().signal,()=>{});
 assert.equal(calls.length,2);assert.equal(failed.length,14);assert.equal(failed[0].fileId,'file-3');
 assert.deepEqual(failed.slice(1).map(x=>x.fileId),items.slice(10).map(x=>x.fileId));
 assert.ok(failed.slice(1).every(x=>x.code==='provider_rate_limited'));
});
