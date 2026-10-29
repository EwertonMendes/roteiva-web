import test from 'node:test';
import assert from 'node:assert/strict';
import {coverGeometry,dragCover,transformCover,coverGesture} from '../src/features/projects/cover-geometry.ts';
import {emptyWorkspace} from '../src/domain/workspace.ts';
import {encodeWorkspace,decodeWorkspace} from '../src/data/workspace-codec.ts';
const cover={connectionId:'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',fileId:'photo_123456789',name:'Capa.jpg',x:50,y:50,zoom:1};
test('landscape/portrait crops fill the frame, drag clamps and zoom preserves focal coordinates',()=>{
 for(const [iw,ih] of [[1600,900],[900,1600],[1000,1000]]){
  const g=coverGeometry(500,200,iw,ih,cover);assert.ok(g.width>=500&&g.height>=200);assert.ok(g.left<=0&&g.top<=0);
  const moved=dragCover(cover,10000,-10000,g.overflowX,g.overflowY);assert.ok(moved.x>=0&&moved.x<=100&&moved.y>=0&&moved.y<=100);
  const zoomed=coverGeometry(500,200,iw,ih,{...cover,zoom:3});assert.ok(zoomed.width>=g.width*3-.01);
 }
 assert.deepEqual(dragCover(cover,30,30,0,0),cover);
});
test('project covers round trip through the revisioned codec, legacy projects remain compatible and removal omits all fields',()=>{
 const workspace=emptyWorkspace();workspace.projects=[{id:2,name:'Project',client:'',status:'Em produção',due:'',progress:0,files:0,color:'blue',initials:'PR',cover}];
 const records=encodeWorkspace(workspace);const restored=decodeWorkspace(records);assert.deepEqual(restored.projects[0].cover,cover);assert.ok(!('cover' in records.get('projects/2')));
 delete workspace.projects[0].cover;const legacy=encodeWorkspace(workspace);assert.ok(!('coverFileId' in legacy.get('projects/2')));assert.equal(decodeWorkspace(legacy).projects[0].cover,undefined);
});

test('gesture zoom keeps its image anchor fixed and clamps every edge without blank space',()=>{
 const from={x:170,y:70};
 const start={...cover,zoom:1.4,x:40,y:60};
 const before=coverGeometry(500,200,1600,900,start);
 const afterCover=transformCover(start,500,200,1600,900,2,from);
 const after=coverGeometry(500,200,1600,900,afterCover);
 assert.ok(Math.abs((from.x-before.left)/before.width-(from.x-after.left)/after.width)<1e-9);
 assert.ok(Math.abs((from.y-before.top)/before.height-(from.y-after.top)/after.height)<1e-9);
 for(const zoom of [-10,1,2,20])for(const to of [{x:-10000,y:10000},{x:10000,y:-10000}]){
  const c=transformCover(start,500,200,900,1600,zoom,from,to),g=coverGeometry(500,200,900,1600,c);
  assert.ok(c.zoom>=1&&c.zoom<=3&&c.x>=0&&c.x<=100&&c.y>=0&&c.y<=100);
  assert.ok(g.left<=0&&g.top<=0&&g.left+g.width>=500-.001&&g.top+g.height>=200-.001);
 }
 assert.deepEqual(coverGesture([{x:20,y:40},{x:80,y:40}]),{center:{x:50,y:40},distance:60});
 assert.deepEqual(transformCover(cover,0,0,100,100,2,from),cover);
});

test('client profile photo round-trips for both storage providers without exposing a URL',()=>{
 const workspace=emptyWorkspace();
 const base={id:33,name:'Cliente',contact:'Contato',email:'',phone:'',projects:0,active:0,color:'blue',initials:'CL',type:'Recorrente',since:'out 2026'};
 for(const provider of ['google_drive','dropbox']){
  const photo={provider,connectionId:cover.connectionId,fileId:provider==='dropbox'?'id:abcdefghijk':cover.fileId,name:'Retrato.jpg',x:34,y:59,zoom:2.1};
  workspace.clients=[{...base,photo}];
  const records=encodeWorkspace(workspace),stored=records.get('clients/33');
  assert.equal(stored.photoProvider,provider);
  assert.equal(stored.photoFileId,photo.fileId);
  assert.ok(!Object.keys(stored).some(key=>/url|token|byte/i.test(key)));
  assert.deepEqual(decodeWorkspace(records).clients[0].photo,photo);
 }
 delete workspace.clients[0].photo;
 const bare=encodeWorkspace(workspace);
 assert.equal(bare.get('clients/33').photoFileId,undefined);
 assert.equal(decodeWorkspace(bare).clients[0].photo,undefined);
});
