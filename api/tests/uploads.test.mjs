import test from 'node:test';
import assert from 'node:assert/strict';
import {database} from './helpers/database.mjs';
import {encrypt,base64url,context} from '../src/crypto.ts';
import {startUpload,completeUpload,authorizeUploadFolder,cleanupUploads} from '../src/uploads.ts';
import {verifyPickerToken} from '../src/picker.ts';
import {DRIVE_SCOPE,DRIVE_READ_SCOPE} from '../src/google.ts';
import {handle} from '../src/index.ts';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';

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
const upload={attemptId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',projectId:17,linkedFolderId:root,name:fname,size:1234567,mimeType:'video/mp4'};
async function setup({linked=true,project=true,parent=root,grant=true,canAdd=true,appAuthorized=true,
  tokenInfo={},googleError,location='https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=opaque',fileParent=child,fileSize=1234567}={}){
  const env={ENVIRONMENT:'dev',FIREBASE_PROJECT_ID:'roteiva-web-dev',TOKEN_KEY_VERSION:'v1',
    TOKEN_KEYS:JSON.stringify({v1:base64url(crypto.getRandomValues(new Uint8Array(32)))}),
    FRONTEND_ORIGIN:'https://roteiva-web-dev.web.app',
    GOOGLE_PICKER_API_KEY:'synthetic-key',GOOGLE_CLIENT_ID:'123456789-demo.apps.googleusercontent.com',GOOGLE_CLIENT_SECRET:'demo-secret'};
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
      if(u.pathname.includes('/projects/17'))return project?Response.json({fields:{ownerUid:{stringValue:uid}}}):new Response(null,{status:404});
      if(!linked)return Response.json({error:{code:404}},{status:404});
      return Response.json({fields:{ownerUid:{stringValue:uid},connectionId:{stringValue:account},
        projectId:{integerValue:'17'},folderId:{stringValue:root}}});
    }
    if(u.pathname==='/tokeninfo')return Response.json({aud:env.GOOGLE_CLIENT_ID,sub:'google-alice',scope:'openid '+DRIVE_SCOPE,expires_in:'300',...tokenInfo});
    if(u.hostname==='openidconnect.googleapis.com')return Response.json({sub:'google-alice'});
    if(u.hostname==='oauth2.googleapis.com'){
      assert.equal(init.body.get('refresh_token'),'refresh');
      return Response.json({access_token:'ephemeral',token_type:'Bearer',expires_in:3600});
    }
    assert.equal(init.headers.Authorization,'Bearer ephemeral');
    if(u.pathname.endsWith('/generateIds'))return Response.json({ids:[fileId]});
    if(u.pathname.startsWith('/upload/')){
      assert.equal(init.method,'POST');
      const payload=JSON.parse(init.body);
      assert.deepEqual(payload.parents,[child]);
      assert.equal(payload.name,fname);
      assert.equal(payload.id,fileId);
      assert.equal(init.headers.Origin,env.FRONTEND_ORIGIN);
      assert.equal(init.headers['X-Upload-Content-Length'],'1234567');
      if(googleError)return Response.json({error:{errors:[{reason:googleError.reason}]}},{status:googleError.status});
      return new Response(null,{status:grant?200:403,headers:{Location:location}});
    }
    if(u.pathname.endsWith('/'+root)){
      return Response.json({id:root,mimeType:'application/vnd.google-apps.folder',trashed:false,
        capabilities:{canAddChildren:true},isAppAuthorized:appAuthorized,parents:['root']});
    }
    if(u.pathname.endsWith('/'+child)){
      return Response.json({id:child,mimeType:'application/vnd.google-apps.folder',trashed:false,
        capabilities:{canAddChildren:canAdd},isAppAuthorized:appAuthorized,parents:[parent]});
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
  const payload={attemptId:upload.attemptId,projectId:17,linkedFolderId:root,fileId,size:upload.size};
  await startUpload(fixture.env,uid,account,child,req(upload),fixture.fetcher);
  const response=await completeUpload(fixture.env,uid,account,child,req(payload),fixture.fetcher);
  const data=await response.json();
  assert.equal(data.file.id,fileId);
  const wrongSize=await setup({fileSize:42});t.after(wrongSize.close);
  await startUpload(wrongSize.env,uid,account,child,req(upload),wrongSize.fetcher);
  await assert.rejects(()=>completeUpload(wrongSize.env,uid,account,child,req(payload),wrongSize.fetcher),
    e=>e.code==='drive_upload_not_confirmed');
  const wrongParent=await setup({fileParent:root});t.after(wrongParent.close);
  await startUpload(wrongParent.env,uid,account,child,req(upload),wrongParent.fetcher);
  await assert.rejects(()=>completeUpload(wrongParent.env,uid,account,child,req(payload),wrongParent.fetcher),
    e=>e.code==='drive_upload_not_confirmed');
});

test('rejects orphan project links, non-writable subfolders and ungranted existing folders',async t=>{
  for(const [options,code] of [[{project:false},'upload_project_denied'],[{canAdd:false},'drive_upload_permission_missing'],
    [{appAuthorized:false},'drive_picker_required']]){
    const f=await setup(options);t.after(f.close);
    await assert.rejects(()=>startUpload(f.env,uid,account,child,req(upload),f.fetcher),e=>e.code===code);
    assert.equal(f.log.some(x=>x.url.includes('/upload/')),false);
  }
});

test('attempt binds a pre-generated file ID, is idempotent, encrypted and expires',async t=>{
  const f=await setup();t.after(f.close);
  const first=await (await startUpload(f.env,uid,account,child,req(upload),f.fetcher)).json();
  const second=await (await startUpload(f.env,uid,account,child,req(upload),f.fetcher)).json();
  assert.deepEqual(first,second);
  assert.equal(f.log.filter(x=>x.method==='POST'&&x.url.includes('/upload/')).length,1);
  const saved=f.db.sql.prepare('SELECT * FROM drive_upload_attempts').get();
  assert.equal(saved.file_id,fileId);
  assert.ok(saved.encrypted_session&&!saved.encrypted_session.includes('upload_id'));
  const payload={attemptId:upload.attemptId,projectId:17,linkedFolderId:root,fileId,size:upload.size};
  for(const bad of [{...payload,fileId:'EXISTING_FILE_1234567'}, {...payload,attemptId:crypto.randomUUID()},
    {...payload,size:42},{...payload,projectId:18}])
    await assert.rejects(()=>completeUpload(f.env,uid,account,child,req(bad),f.fetcher),e=>e.code==='upload_attempt_mismatch');
  await assert.rejects(()=>completeUpload(f.env,'bob',account,child,req(payload),f.fetcher),e=>e.status===404);
  await completeUpload(f.env,uid,account,child,req(payload),f.fetcher);
  await completeUpload(f.env,uid,account,child,req(payload),f.fetcher);
  assert.equal(f.db.sql.prepare('SELECT encrypted_session FROM drive_upload_attempts').get().encrypted_session,null);
  f.db.sql.exec('UPDATE drive_upload_attempts SET expires_at=0');
  await assert.rejects(()=>completeUpload(f.env,uid,account,child,req(payload),f.fetcher),e=>e.status===410);
  await cleanupUploads(f.env);
  assert.equal(f.db.sql.prepare('SELECT COUNT(*) n FROM drive_upload_attempts').get().n,0);
});

test('reconnection or disconnect fences old upload attempts',async t=>{
  for(const change of ["revision=revision+1","status='reconnect_required'"]){
    const f=await setup();t.after(f.close);
    await startUpload(f.env,uid,account,child,req(upload),f.fetcher);
    f.db.sql.exec('UPDATE drive_connections SET '+change);
    await assert.rejects(()=>completeUpload(f.env,uid,account,child,req({...upload,fileId}),f.fetcher),
      e=>['reconnect_required','upload_attempt_mismatch'].includes(e.code));
  }
});

test('Picker uses same Google subject and OAuth client and rejects broad or expired tokens',async t=>{
  const f=await setup({appAuthorized:false});t.after(f.close);
  const config=await (await authorizeUploadFolder(f.env,uid,account,child,req(upload),f.fetcher)).json();
  assert.equal(config.authorized,false);assert.equal(config.appId,'123456789');
  assert.equal(config.accountId,'google-alice');
  await verifyPickerToken(f.env,uid,account,req({accessToken:'synthetic-short-token'}),f.fetcher);
  const fallback=await setup({tokenInfo:{sub:undefined}});t.after(fallback.close);
  await verifyPickerToken(fallback.env,uid,account,req({accessToken:'synthetic-short-token'}),fallback.fetcher);
  for(const [info,code] of [[{sub:'google-bob'},'picker_account_mismatch'],[{aud:'foreign-client'},'picker_account_mismatch'],
    [{scope:DRIVE_SCOPE+' '+DRIVE_READ_SCOPE},'picker_scope_mismatch'],[{expires_in:0},'picker_scope_mismatch']]){
    const other=await setup({tokenInfo:info});t.after(other.close);
    await assert.rejects(()=>verifyPickerToken(other.env,uid,account,req({accessToken:'synthetic-short-token'}),other.fetcher),e=>e.code===code);
  }
  f.env.GOOGLE_PICKER_API_KEY=undefined;
  await assert.rejects(()=>authorizeUploadFolder(f.env,uid,account,child,req(upload),f.fetcher),e=>e.code==='picker_not_configured');
});

test('Google quota, storage and provider errors are specific and redirects never followed',async t=>{
  for(const [reason,status,code] of [['storageQuotaExceeded',403,'drive_storage_full'],
    ['userRateLimitExceeded',403,'drive_rate_limited'],['quotaExceeded',429,'drive_rate_limited'],['backendError',503,'drive_upload_unavailable']]){
    const f=await setup({googleError:{reason,status}});t.after(f.close);
    await assert.rejects(()=>startUpload(f.env,uid,account,child,req(upload),f.fetcher),e=>e.code===code);
    for(const entry of f.log)assert.equal(new URL(entry.url).protocol,'https:');
  }
});

test('metadata rejects invalid MIME, native conversion, malformed attempts and oversized streaming body',async t=>{
  const f=await setup();t.after(f.close);
  for(const bad of [{...upload,mimeType:'anything'}, {...upload,mimeType:'application/vnd.google-apps.document'},
    {...upload,attemptId:'foreign'}, {...upload,size:1.2}])
    await assert.rejects(()=>startUpload(f.env,uid,account,child,req(bad),f.fetcher),e=>e.code==='invalid_upload');
  await assert.rejects(()=>startUpload(f.env,uid,account,child,req({name:'x'.repeat(9000)}),f.fetcher),e=>e.status===413);
});

test('real HTTP middleware enforces signed Firebase identity, entitlement and UID isolation on every upload/Picker route',async t=>{
  const f=await setup();t.after(f.close);
  const {privateKey,publicKey}=await generateKeyPair('RS256');const jwk=await exportJWK(publicKey);jwk.kid='upload-test';
  const now=Math.floor(Date.now()/1000);
  const jwt=async sub=>new SignJWT({auth_time:now}).setProtectedHeader({alg:'RS256',kid:'upload-test'})
    .setAudience(f.env.FIREBASE_PROJECT_ID).setIssuer('https://securetoken.google.com/'+f.env.FIREBASE_PROJECT_ID)
    .setSubject(sub).setIssuedAt(now).setExpirationTime(now+300).sign(privateKey);
  const tokens={alice:await jwt('alice'),bob:await jwt('bob')};
  const env={...f.env,OAUTH_ENABLED:'true',OAUTH_REDIRECT_URI:'https://roteiva-api-dev.ewertonmendes9.workers.dev/oauth/drive/callback',
    API_RATE_LIMIT:{limit:async()=>({success:true})}};
  const original=globalThis.fetch;
  globalThis.fetch=async(url,init)=>{
    if(String(url).includes('/service_accounts/v1/jwk/'))return Response.json({keys:[jwk]});
    const next=new URL(url).hostname==='firestore.googleapis.com'?{...init,headers:{...init.headers,Authorization:'Bearer fake-firebase-jwt'}}:init;
    return f.fetcher(url,next);
  };
  t.after(()=>{globalThis.fetch=original;});
  const send=(path,token,origin=env.FRONTEND_ORIGIN,payload=upload)=>handle(new Request('https://api.example'+path,
    {method:'POST',headers:{Origin:origin,Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(payload)}),env);
  const base='/integrations/drive/'+account+'/folders/'+child+'/uploads';
  for(const path of [base,base+'/complete',base+'/authorize','/integrations/drive/'+account+'/picker/verify']){
    assert.equal((await send(path,'invalid')).status,401);
    assert.equal((await send(path,tokens.alice,'https://evil.example')).status,403);
    const expired=await send(path,tokens.alice);assert.equal(expired.status,403);
    assert.equal((await expired.json()).error.code,'access_expired');
  }
  const started=Date.now();
  for(const owner of ['alice','bob'])f.db.sql.prepare('INSERT INTO access_accounts(owner_uid,trial_started_at,trial_ends_at,created_at,updated_at) VALUES(?,?,?,?,?)')
    .run(owner,started,started+604800000,started,started);
  assert.equal((await send(base,tokens.bob)).status,404);
  assert.equal((await send(base,tokens.alice)).status,200);
  assert.equal((await send(base+'/complete',tokens.alice,env.FRONTEND_ORIGIN,{...upload,fileId})).status,200);
  f.db.sql.exec("UPDATE access_accounts SET suspended_at=1 WHERE owner_uid='alice'");
  assert.equal((await send(base+'/complete',tokens.alice,env.FRONTEND_ORIGIN,{...upload,fileId})).status,403);
});
