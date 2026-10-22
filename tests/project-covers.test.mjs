import test from 'node:test';
import assert from 'node:assert/strict';
import {coverGeometry,dragCover} from '../src/features/projects/cover-geometry.ts';
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
