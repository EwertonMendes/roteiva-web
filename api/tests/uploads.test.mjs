import test from 'node:test';
import assert from 'node:assert/strict';
import {database} from './helpers/database.mjs';
import {encrypt,base64url,context} from '../src/crypto.ts';
import {startUpload,completeUpload} from '../src/uploads.ts';
import {DRIVE_SCOPE,DRIVE_READ_SCOPE} from '../src/google.ts';

const account='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const root='ROOT_FOLDER_123456789';
const child='CHILD_FOLDER_123456789';
const fileId='FILE_UPLOAD_123456789';
const uid='alice';
const fname='Video final.mp4';
function req(values) {
  return new Request('https://example.com/api',{method:'POST',headers:{
    Authorization:'Bearer fake-firebase-jwt','Content-Type':'application/json'},
    body:JSON.stringify(values)});
}
const upload={projectId:17,linkedFolderId:root,name:fname,size:1234567,mimeType:'video/mp4'};
async function setup({linked=true,parent=root,grant=true,location='https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=opaque',fileParent=child,fileSize=1234567}={}){
  const env={ENVIRONMENT:'dev',FIREBASE_PROJECT_ID:'roteiva-web-dev',TOKEN_KEY_VERSION:'v1',
    TOKEN_KEYS:JSON.stringify({v1:base64url(crypto.getRandomValues(new Uint8Array(32)))}),
    GOOGLE_CLIENT_ID:'demo-client',GOOGLE_CLIENT_SECRET:'demo-secret'};
  const credential=await encrypt(env,'refresh',context(env,uid,'google-alice'));
  const db=database({id:account,owner_uid:uid,google_account_id:'google-alice',status:'connected',
    revision:1,scopes:DRIVE_SCOPE+' '+DRIVE_READ_SCOPE,encrypted_refresh_token:credential});
  env.DB=db.DB;
  const log=[];
  const fetcher=async(url,init)=>{
    const u=new URL(url);
    log.push({url:u.href,method:init.method||'GET',headers:init.headers,body:init.body});
    if(u.hostname==='firestore.googleapis.com'){
      assert.equal(init.headers.Authorization,'Bearer fake-firebase-jwt');
      if(!linked)return Response.json({error:{code:404}},{status:404});
      return Response.json({fields:{ownerUid:{stringValue:uid},connectionId:{stringValue:account},
        projectId:{integerValue:'17'},folderId:{stringValue:root}}});
    }
    if(u.hostname==='oauth2.googleapis.com'){
      assert.equal(init.body.get('refresh_token'),'refresh');
      return Response.json({access_token:'ephemeral',token_type:'Bearer',expires_in:3600});
    }
    assert.equal(init.headers.Authorization,'Bearer ephemeral');
    if(u.pathname.startsWith('/upload/')){
      assert.equal(init.method,'POST');
      const payload=JSON.parse(init.body);
      assert.deepEqual(payload.parents,[child]);
      assert.equal(payload.name,fname);
      assert.equal(init.headers['X-Upload-Content-Length'],'1234567');
      return new Response(null,{status:grant?200:403,headers:{Location:location}});
    }
    if(u.pathname.endsWith('/'+root)){
      return Response.json({id:root,mimeType:'application/vnd.google-apps.folder',trashed:false,
        capabilities:{canAddChildren:true},parents:['root']});
    }
    if(u.pathname.endsWith('/'+child)){
      return Response.json({id:child,mimeType:'application/vnd.google-apps.folder',trashed:false,
        capabilities:{canAddChildren:true},parents:[parent]});
    }
    if(u.pathname.endsWith('/'+fileId)){
      return Response.json({id:fileId,name:fname,mimeType:'video/mp4',size:String(fileSize),
        parents:[fileParent],webViewLink:'https://drive.google.com/file/d/'+fileId+'/view'});
    }
    throw Error('Unexpected external call '+u.href);
  };
  return {env,db,fetcher,log,close:db.close};
}

test('starts resumable upload only for a linked folder descendant; no file bytes reach Worker',async t=>{
  const fixture=await setup();t.after(fixture.close);
  const response=await startUpload(fixture.env,uid,account,child,req(upload),fixture.fetcher);
  assert.equal(response.status,200);
  const json=await response.json();
  assert.match(json.sessionUrl,/^https:\/\/www.googleapis.com\/upload\/drive\/v3\/files/);
  assert.equal(json.chunkSize,8*1024*1024);
  assert.equal(response.headers.get('Cache-Control'),'no-store');
  assert.equal(fixture.log.filter(x=>x.method==='POST'&&x.url.includes('/upload/')).length,1);
  assert.ok(fixture.log.some(x=>x.url.includes('/driveFolders/17_')));
});
test('rejects an unlinked folder, another UID and a child outside the linked root',async t=>{
  const missing=await setup({linked:false});t.after(missing.close);
  await assert.rejects(()=>startUpload(missing.env,uid,account,child,req(upload),missing.fetcher),
    e=>e.code==='upload_folder_not_linked');
  assert.equal(missing.log.some(x=>x.url.includes('/upload/')),false);
  const owned=await setup();t.after(owned.close);
  await assert.rejects(()=>startUpload(owned.env,'bob',account,child,req(upload),owned.fetcher),
    e=>e.status===404);
  const outside=await setup({parent:'OTHER_FOLDER_12345678'});t.after(outside.close);
  // The foreign parent lookup never reaches the chosen project folder.
  await assert.rejects(()=>startUpload(outside.env,uid,account,child,req(upload),outside.fetcher));
  assert.equal(outside.log.some(x=>x.url.includes('/upload/')),false);
});
test('rejects malformed metadata and untrusted upload locations',async t=>{
  const fixture=await setup();t.after(fixture.close);
  for(const bad of [{...upload,size:0},{...upload,name:'bad\nname'},{...upload,linkedFolderId:'../x'},
      {...upload,size:6_000_000_000_000}]){
    await assert.rejects(()=>startUpload(fixture.env,uid,account,child,req(bad),fixture.fetcher),
      e=>e.code==='invalid_upload');
  }
  const hostile=await setup({location:'https://attacker.example/upload/drive/v3/files?upload_id=foo'});t.after(hostile.close);
  await assert.rejects(()=>startUpload(hostile.env,uid,account,child,req(upload),hostile.fetcher),
    e=>e.code==='upload_session_invalid');
  const denied=await setup({grant:false});t.after(denied.close);
  await assert.rejects(()=>startUpload(denied.env,uid,account,child,req(upload),denied.fetcher),
    e=>e.code==='drive_upload_permission_missing');
});
test('final confirmation is Drive-authoritative for parent, size and ownership',async t=>{
  const fixture=await setup();t.after(fixture.close);
  const payload={projectId:17,linkedFolderId:root,fileId,size:upload.size};
  const response=await completeUpload(fixture.env,uid,account,child,req(payload),fixture.fetcher);
  const data=await response.json();
  assert.equal(data.file.id,fileId);
  const wrongSize=await setup({fileSize:42});t.after(wrongSize.close);
  await assert.rejects(()=>completeUpload(wrongSize.env,uid,account,child,req(payload),wrongSize.fetcher),
    e=>e.code==='drive_upload_not_confirmed');
  const wrongParent=await setup({fileParent:root});t.after(wrongParent.close);
  await assert.rejects(()=>completeUpload(wrongParent.env,uid,account,child,req(payload),wrongParent.fetcher),
    e=>e.code==='drive_upload_not_confirmed');
});
