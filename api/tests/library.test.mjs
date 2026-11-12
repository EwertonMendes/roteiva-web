import test from 'node:test';
import assert from 'node:assert/strict';
import {database} from './helpers/database.mjs';
import {libraryFor,libraryNode,listLibrary,listLibraryExplorer,mutateLibrary,libraryRouter} from '../src/library.ts';
test('virtual folder commands preserve isolation, CAS and ancestor visibility',async t=>{
 const f=database();t.after(f.close);const env={DB:f.DB};
 const a=await libraryFor(env,'alice',1),b=await libraryFor(env,'bob',1);
 assert.notEqual(a.id,b.id);
 const create=async(name,parentId='root')=>(await (await mutateLibrary(env,a,null,{name,parentId})).json()).id;
 const videos=await create('Vídeos'),raw=await create('Brutos',videos);
 await assert.rejects(libraryNode(env,b,videos),e=>e.status===404);
 await assert.rejects(mutateLibrary(env,a,videos,{action:'move',parentId:raw,revision:1}),e=>e.code==='library_cycle');
 await mutateLibrary(env,a,raw,{action:'rename',name:'Originais',revision:1});
 await assert.rejects(mutateLibrary(env,a,raw,{action:'rename',name:'Stale',revision:1}),e=>e.code==='library_changed');
 await mutateLibrary(env,a,videos,{action:'trash',revision:1});
 await assert.rejects(libraryNode(env,a,raw),e=>e.status===404);
 await assert.rejects(mutateLibrary(env,a,null,{name:'Hidden',parentId:raw}),e=>e.status===404);
 await mutateLibrary(env,a,videos,{action:'restore',revision:2});
 const page=await (await listLibrary(env,a,videos,null)).json();
 assert.equal(page.nodes[0].name,'Originais');assert.deepEqual(page.trail.map(x=>x.name),['Arquivos','Vídeos']);
 for(const name of ['', '/', '\\','bad\nname','a'.repeat(121)])await assert.rejects(mutateLibrary(env,a,null,{name}),e=>e.code==='invalid_library_name');
});
test('project authorization precedes library creation and uses the caller token',async t=>{
 const f=database();t.after(f.close);const env={DB:f.DB,FIREBASE_PROJECT_ID:'demo-roteiva'};
 const request=new Request('https://api.example/library/projects/17/nodes',{headers:{Authorization:'Bearer caller'}});
 let observed;
 const ok=await libraryRouter(request,env,'alice',new URL(request.url),async(url,init)=>{
 observed={url,auth:init.headers.Authorization};return Response.json({fields:{ownerUid:{stringValue:'alice'}}});});
 assert.equal(ok.status,200);assert.equal(observed.auth,'Bearer caller');assert.match(observed.url,/users\/alice\/projects\/17$/);
 for(const response of [new Response('',{status:403}),Response.json({fields:{ownerUid:{stringValue:'mallory'}}})])
 await assert.rejects(libraryRouter(request,env,'bob',new URL(request.url),async()=>response),e=>e.code==='library_project_denied');
 assert.equal(f.sql.prepare("SELECT count(*) n FROM libraries WHERE owner_uid='bob'").get().n,0);
});
test('bounded keyset pagination includes every node exactly once',async t=>{
 const f=database();t.after(f.close);const env={DB:f.DB};const lib=await libraryFor(env,'alice',1);
 for(let i=0;i<57;i++)await mutateLibrary(env,lib,null,{name:'Folder '+i});
 const p1=await (await listLibrary(env,lib,'root',null)).json();
 const p2=await (await listLibrary(env,lib,'root',p1.nextPage)).json();
 assert.equal(p1.nodes.length,50);assert.equal(p2.nodes.length,7);assert.equal(p2.nextPage,null);
 assert.equal(new Set([...p1.nodes,...p2.nodes].map(x=>x.id)).size,57);
});
test('virtual name search is literal, paginated in the authorized folder and never browses providers',async t=>{
 const f=database();t.after(f.close);const env={DB:f.DB},lib=await libraryFor(env,'alice',1);
 await mutateLibrary(env,lib,null,{name:'100% Final'});await mutateLibrary(env,lib,null,{name:'1000 Final'});
 const child=await (await mutateLibrary(env,lib,null,{name:'Nested'})).json();await mutateLibrary(env,lib,null,{name:'100% Hidden',parentId:child.id});
 const result=await (await listLibrary(env,lib,'root',null,'100%')).json();assert.deepEqual(result.nodes.map(x=>x.name),['100% Final']);
 await assert.rejects(listLibrary(env,lib,'root',null,'a'.repeat(101)),e=>e.code==='invalid_search');
});


test('explorer sorts folders first and searches within the project including descendants',async t=>{
 const f=database();t.after(f.close);const env={DB:f.DB},lib=await libraryFor(env,'alice',10),other=await libraryFor(env,'bob',10);
 const make=async(name,parentId='root')=>(await (await mutateLibrary(env,lib,null,{name,parentId})).json()).id;
 const a=await make('Zoo'),nested=await make('Subfolder',a),b=await make('alpha');
 await make('Image final',nested);await make('Image root');
 const all=await (await listLibraryExplorer(env,lib,'root',null,'image',true)).json();
 assert.deepEqual(all.nodes.map(x=>x.name),['Image final','Image root']);
 assert.equal(all.nodes[0].parent_name,'Subfolder');
 assert.deepEqual((await (await listLibraryExplorer(env,lib,'root',null,'image',false)).json()).nodes.map(x=>x.name),['Image root']);
 const root=await (await listLibraryExplorer(env,lib,'root',null)).json();
 assert.deepEqual(root.nodes.map(x=>x.name),['alpha','Zoo']);
 assert.equal((await (await listLibraryExplorer(env,other,'root',null,'Image',true)).json()).nodes.length,0);
});
test('explorer sorted pagination has stable non-overlapping pages',async t=>{
 const f=database();t.after(f.close);const env={DB:f.DB},lib=await libraryFor(env,'alice',11);
 for(let i=0;i<65;i++)await mutateLibrary(env,lib,null,{name:'Folder '+String(64-i).padStart(3,'0')});
 const page1=await (await listLibraryExplorer(env,lib,'root',null)).json();
 const page2=await (await listLibraryExplorer(env,lib,'root',page1.nextPage)).json();
 assert.equal(page1.nodes.length,50);assert.equal(page2.nodes.length,15);
 assert.equal(new Set([...page1.nodes,...page2.nodes].map(x=>x.id)).size,65);
 assert.equal(page1.nodes.at(-1).name,'Folder 049');assert.equal(page2.nodes[0].name,'Folder 050');
});
