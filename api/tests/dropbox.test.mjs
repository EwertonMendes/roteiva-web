import test from 'node:test';
import assert from 'node:assert/strict';
import {database} from './helpers/database.mjs';
import {encrypt,context,base64url} from '../src/crypto.ts';
import {dropboxAccess,dropboxConnection,dropboxList,dropboxStart} from '../src/dropbox.ts';
import {startDropboxUpload,appendDropboxUpload,finishDropboxUpload} from '../src/dropbox-uploads.ts';
import {issueDropboxPreview,streamDropboxPreview} from '../src/dropbox-preview.ts';

const uid='alice', conn='ffffffff-ffff-4fff-8fff-ffffffffffff';
const folder='root', id='id:a4ayc_80_OEAAAAAAAAAXw', root=uid;
const projectId=17,attemptId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const API='https://roteiva-api-dev.ewertonmendes9.workers.dev';
async function fixture(t) {
 const f=database();t.after(f.close);
 const env={DB:f.DB,ENVIRONMENT:'dev',FIREBASE_PROJECT_ID:'roteiva-web-dev',
   TOKEN_KEY_VERSION:'v1',TOKEN_KEYS:JSON.stringify({v1:base64url(crypto.getRandomValues(new Uint8Array(32)))}),
   FRONTEND_ORIGIN:'https://roteiva-web-dev.web.app',DROPBOX_ENABLED:'true',
   DROPBOX_APP_KEY:'synthetic-key',DROPBOX_APP_SECRET:'synthetic-secret',
   DROPBOX_OAUTH_REDIRECT_URI:API+'/oauth/dropbox/callback'};
 const refresh=await encrypt(env,'demo-refresh',context(env,uid,'dbid:someaccount','dropbox-refresh'));
 const access=await encrypt(env,'demo-token',context(env,uid,'dbid:someaccount','dropbox-access:'+conn+':1'));
 const now=Date.now();
 f.sql.prepare("INSERT INTO dropbox_connections(id,owner_uid,dropbox_account_id,dropbox_email,encrypted_refresh_token,encrypted_access_token,access_token_expires_at,status,scopes,revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'connected',?,1,?,?)")
  .run(conn,uid,'dbid:someaccount','alice@example.com',refresh,access,now+3600000,
    'account_info.read files.metadata.read files.content.read files.content.write sharing.read sharing.write',now,now);
 return {...f,env};
}
function fetchStub(log=[]){
 return async function stub(url,init={}){
  const path=new URL(url).pathname;
  log.push({path,method:init.method||'GET',args:init.headers?.['Dropbox-API-Arg'],authorization:init.headers?.Authorization});
  if(path.includes('/dropboxFolders/')){
    return Response.json({fields:{
      ownerUid:{stringValue:uid},connectionId:{stringValue:conn},projectId:{integerValue:String(projectId)},
      folderId:{stringValue:folder}
    }});
  }
  if(path.includes('/projects/17'))return Response.json({fields:{ownerUid:{stringValue:uid}}});
  if(path.endsWith('files/get_metadata'))return Response.json({
    '.tag':'file',id,name:'Review.mp4',path_lower:'/review.mp4',path_display:'/Review.mp4',
    is_downloadable:true,size:5*1024*1024
  });
  if(path.endsWith('files/upload_session/start'))return Response.json({session_id:'synthetic-session'});
  if(path.endsWith('files/upload_session/append_v2'))return Response.json({});
  if(path.endsWith('files/upload_session/finish'))return Response.json({
    id,name:'Review.mp4',size:5*1024*1024,path_lower:'/review.mp4'
  });
  if(path.endsWith('files/list_folder'))return Response.json({entries:[{
    '.tag':'file',id,name:'Review.mp4',size:5*1024*1024,path_lower:'/review.mp4',server_modified:'2026-10-24T10:00:00Z'
  }],has_more:false});
  if(path.endsWith('files/download'))return new Response('mock',{status:206,headers:{
    'Content-Type':'application/octet-stream','Content-Range':'bytes 0-3/5242880','Content-Length':'4'
  }});
  throw new Error('Unexpected external HTTP: '+path);
 };
}
function request(body){return new Request(API+'/api',{method:'POST',headers:{Authorization:'Bearer fake-firebase-token',
  Origin:'https://roteiva-web-dev.web.app','Content-Type':'application/json'},body:JSON.stringify(body)});}
test('Dropbox connection requires matching owner and encrypted token cache',async t=>{
 const f=await fixture(t);
 const row=await dropboxConnection(f.env,uid,conn);
 assert.equal(await dropboxAccess(f.env,row,async()=>{throw Error('network must not be called')}),'demo-token');
 await assert.rejects(()=>dropboxConnection(f.env,'other-user',conn),e=>e.status===404);
 f.sql.prepare("UPDATE dropbox_connections SET status='reconnect_required' WHERE id=?").run(conn);
 await assert.rejects(()=>dropboxAccess(f.env,row),e=>e.code==='dropbox_reconnect_required');
});
test('Dropbox list preserves provider opaque ids and normalizes metadata',async t=>{
 const f=await fixture(t);const old=global.fetch;const log=[];global.fetch=fetchStub(log);
 t.after(()=>{global.fetch=old});
 const response=await dropboxList(f.env,uid,conn,'root',null,null);
 const body=await response.json();assert.equal(body.files[0].id,id);
 assert.equal(body.files[0].mimeType,'video/mp4');assert.equal(body.nextPageToken,null);
 assert.equal(log[0].authorization,'Bearer demo-token');
});
test('Dropbox resumable upload validates immutable linked project and avoids a second commit',async t=>{
 const f=await fixture(t);const old=global.fetch;const log=[];global.fetch=fetchStub(log);
 t.after(()=>{global.fetch=old});
 const size=5*1024*1024,chunkSize=4*1024*1024;
 const upload={attemptId,projectId,linkedFolderId:folder,targetFolderId:folder,name:'Review.mp4',size,mimeType:'video/mp4'};
 let result=await (await startDropboxUpload(f.env,uid,conn,request(upload))).json();
 assert.equal(result.chunkSize,chunkSize);assert.equal(result.offset,0);
 const post=(offset,length)=>new Request(API+'/integrations/dropbox/'+conn+'/uploads/'+attemptId+'/chunk?offset='+offset,{
  method:'POST',headers:{Authorization:'Bearer fake-firebase-token'},body:new Uint8Array(length)});
 result=await (await appendDropboxUpload(f.env,uid,conn,attemptId,post(0,chunkSize))).json();
 assert.equal(result.offset,chunkSize);
 result=await (await appendDropboxUpload(f.env,uid,conn,attemptId,post(chunkSize,size-chunkSize))).json();
 assert.equal(result.offset,size);
 result=await (await finishDropboxUpload(f.env,uid,conn,attemptId,request({}))).json();
 assert.equal(result.fileId,id);
 result=await (await finishDropboxUpload(f.env,uid,conn,attemptId,request({}))).json();
 assert.equal(result.fileId,id);
 assert.equal(log.filter(x=>x.path.endsWith('upload_session/finish')).length,1);
 const row=f.sql.prepare('SELECT * FROM dropbox_upload_attempts WHERE id=?').get(attemptId);
 assert.equal(row.status,'completed');assert.equal(row.committed_offset,size);assert.equal(row.encrypted_session,null);
});
test('signed library media tickets reject tampering and account reconnection',async t=>{
 const f=await fixture(t);const old=global.fetch;global.fetch=fetchStub();t.after(()=>{global.fetch=old});
 const response=await issueDropboxPreview(f.env,uid,conn,request({
  projectId,linkedFolderId:folder,fileId:id
 }));
 const {url}=await response.json();
 const altered=url.slice(0,-1)+(url.endsWith('A')?'B':'A');
 await assert.rejects(()=>streamDropboxPreview(f.env,new Request(altered),new URL(altered)),e=>e.status===404);
 const media=await streamDropboxPreview(f.env,new Request(url,{headers:{Range:'bytes=0-3'}}),new URL(url));
 assert.equal(media.status,206);assert.equal(media.headers.get('Content-Type'),'video/mp4');
 f.sql.prepare('UPDATE dropbox_connections SET revision=revision+1 WHERE id=?').run(conn);
 await assert.rejects(()=>streamDropboxPreview(f.env,new Request(url),new URL(url)),e=>e.status===404);
});

test('Dropbox OAuth launch is one-use, short-lived and never returns credentials',async t=>{
 const f=await fixture(t);
 const launch=await (await dropboxStart(f.env,uid)).json();
 assert.match(launch.launchUrl,/^https:\/\/roteiva-api-dev\.ewertonmendes9\.workers\.dev\/oauth\/dropbox\/launch\?ticket=/);
 assert.doesNotMatch(JSON.stringify(launch),/demo-token|demo-refresh|synthetic-secret/);
 const records=f.sql.prepare('SELECT * FROM dropbox_oauth_transactions').all();
 assert.equal(records.length,1);
 assert.notEqual(records[0].encrypted_verifier,'');
 assert.equal(records[0].owner_uid,uid);
 assert.ok(records[0].expires_at>Date.now());
 assert.ok(records[0].expires_at<=Date.now()+600000);
 for(let i=0;i<4;i++)await dropboxStart(f.env,uid);
 await assert.rejects(()=>dropboxStart(f.env,uid),e=>e.status===429&&e.code==='oauth_rate_limited');
 const other=await (await dropboxStart(f.env,'another-user')).json();
 assert.match(other.launchUrl,/\/oauth\/dropbox\/launch\?ticket=/);
});
test('Fail closed: malformed uploads, reconnects and different owners never start a Dropbox transfer',async t=>{
 const f=await fixture(t);
 const raw={attemptId,projectId,linkedFolderId:'root',targetFolderId:'root',
  name:'Video.mp4',size:4194304,mimeType:'video/mp4'};
 const bad=(data)=>startDropboxUpload(f.env,uid,conn,request(data));
 for(const [patch,code] of [
   [{name:'../unsafe.mp4'},'dropbox_invalid_upload'],
   [{size:0},'dropbox_invalid_upload'],
   [{linkedFolderId:'../../secret'},'dropbox_invalid_upload'],
   [{attemptId:'not-a-uuid'},'dropbox_invalid_upload']
 ]){
  await assert.rejects(()=>bad({...raw,...patch}),e=>e.status===400&&e.code===code);
 }
 assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM dropbox_upload_attempts').get().n,0);
 await assert.rejects(()=>startDropboxUpload(f.env,'not-owner',conn,request(raw)),e=>e.status===404);
 f.sql.prepare("UPDATE dropbox_connections SET status='reconnect_required' WHERE id=?").run(conn);
 await assert.rejects(()=>dropboxAccess(f.env,await dropboxConnection(f.env,uid,conn)),
   e=>e.code==='dropbox_reconnect_required');
});
