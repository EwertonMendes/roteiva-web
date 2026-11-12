import test from 'node:test';
import assert from 'node:assert/strict';
import {folderPlanFromPaths} from '../src/features/drive/library-structure-plan.ts';
import {importLibraryBatch} from '../src/features/drive/library-import.ts';
import {assistedLibraryPlan} from '../src/features/drive/assisted-library-plan.ts';
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
  return {results:body.items.map((x,i)=>({fileId:x.fileId,status:i===1?'failed':'added',code:i===1?'source_unavailable':undefined}))};
 };
 const failed=await importLibraryBatch(call,'/imports','root',items,new AbortController().signal,()=>{});
 assert.equal(calls.length,2);assert.equal(failed.length,21);assert.equal(failed[0].fileId,'file-1');
 assert.deepEqual(failed.slice(1).map(x=>x.fileId),items.slice(3).map(x=>x.fileId));
 assert.ok(failed.slice(1).every(x=>x.code==='provider_rate_limited'));
});
test('assisted organization uses only selected parents and never implies access to unselected descendants',()=>{
 const base={provider:'google_drive',connectionId:'account'},folder={...base,fileId:'folder',kind:'folder',name:'Vídeos',parentIds:['unknown']},file={...base,fileId:'file',kind:'asset',name:'Corte.mp4',parentIds:['folder']};
 const plan=assistedLibraryPlan([file,folder]);assert.equal(plan.folders.length,1);assert.equal(plan.files[0].targetKey,plan.folders[0].key);
 assert.equal(assistedLibraryPlan([folder]).files.length,0);
 const withoutParent=assistedLibraryPlan([file]);assert.equal(withoutParent.folders.length,0);assert.equal(withoutParent.files[0].targetKey,null);
 assert.throws(()=>assistedLibraryPlan([{...folder,parentIds:['other']},{...folder,fileId:'other',parentIds:['folder']}]),/inconsistente/);
 const dropbox=assistedLibraryPlan([{...folder,provider:'dropbox',path:'/videos',parentIds:[]},{...file,provider:'dropbox',path:'/videos/corte.mp4',parentIds:[]}]);assert.equal(dropbox.files[0].targetKey,dropbox.folders[0].key);
});
