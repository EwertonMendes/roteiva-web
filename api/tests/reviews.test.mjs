import test from 'node:test';
import assert from 'node:assert/strict';
import {database} from './helpers/database.mjs';
import {reviewRouter,assertNoConnectionReviews,closeOwnerReviews,cleanupExpiredReviews} from '../src/reviews.ts';
import {handle} from '../src/index.ts';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import {random,hash,encrypt,context,base64url} from '../src/crypto.ts';
const BASE='https://roteiva-api-dev.ewertonmendes9.workers.dev';
const account='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const file='FILE_REVIEW_12345678';
const imageFile='IMAGE_REVIEW_12345678';
const pair=await generateKeyPair('RS256');
function fixture(){
  const db=database({id:account,owner_uid:'alice',google_account_id:'google-alice',
    status:'connected',revision:1,encrypted_refresh_token:'encrypted',
    scopes:'https://www.googleapis.com/auth/drive.file'});
  const env={DB:db.DB,ENVIRONMENT:'dev',FIREBASE_PROJECT_ID:'roteiva-web-dev',TOKEN_KEY_VERSION:'v1',
    TOKEN_KEYS:JSON.stringify({v1:base64url(crypto.getRandomValues(new Uint8Array(32)))})};
  return {...db,env};
}
async function inserted(f,{status='pending',mode='link',expires=Date.now()+86400000,uid='alice'}={}){
  const id=crypto.randomUUID(),token=random(),timestamp=Date.now();
  const sealed=await encrypt(f.env,token,context(f.env,uid,id,'review-invite'));
  f.sql.prepare("INSERT INTO review_requests(id,owner_uid,client_id,project_id,client_name,project_name,studio_name,title,message,recipient_email,access_mode,status,current_version,expires_at,token_hash,encrypted_token,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(id,uid,7,17,'Acme','Video','Estudio','Corte 01','','client@gmail.com',mode,status,1,expires,
      await hash(token),sealed,timestamp,timestamp);
  f.sql.prepare("INSERT INTO review_assets(review_id,version,file_id,connection_id,linked_folder_id,name,mime_type,grant_state) VALUES(?,?,?,?,?,?,?,'granted')")
    .run(id,1,file,account,'PARENT_FOLDER_12345','Corte.mp4','video/mp4');
  return {id,token};
}
function req(token,path='/reviews/public',method='GET',body={},auth){
  return new Request(BASE+path,{method,headers:{
    'X-Review-Token':token,...(auth?{Authorization:'Bearer '+auth}:{}),
    ...(method==='POST'?{'Content-Type':'application/json'}:{})
  },...(method==='POST'?{body:JSON.stringify({version:1,...body})}:{})});
}
async function route(f,token,path,method,body,auth){
  const request=req(token,path,method,body,auth);
  return reviewRouter(request,f.env,new URL(request.url));
}
test('only a matching unexpired capability reveals one review and selected files',async t=>{
  const f=fixture();t.after(f.close);
  const a=await inserted(f),b=await inserted(f,{uid:'bob'});
  const result=await (await route(f,a.token)).json();
  assert.equal(result.review.title,'Corte 01');
  assert.deepEqual(result.assets.map(x=>x.fileId),[file]);
  assert.match(result.mediaTickets[file].url,/\/reviews\/media\?ticket=/);
  assert.ok(result.mediaTickets[file].expiresAt>Date.now());
  assert.ok(result.mediaTickets[file].expiresAt<=Date.now()+12*60*1000);
  assert.equal(JSON.stringify(result).includes(b.token),false);
  await assert.rejects(()=>route(f,random()),e=>e.status===404);
  f.sql.prepare("UPDATE review_requests SET expires_at=0 WHERE id=?").run(a.id);
  await assert.rejects(()=>route(f,a.token),e=>e.code==='review_expired');
  f.sql.prepare("UPDATE review_requests SET expires_at=?,status='closed' WHERE id=?").run(Date.now()+100000,a.id);
  await assert.rejects(()=>route(f,a.token),e=>e.status===404);
});
test('comments reject numeric strings and timestamps on images at the API boundary',async t=>{
  const f=fixture();t.after(f.close);
  const a=await inserted(f);
  await assert.rejects(()=>route(f,a.token,'/reviews/public/comment','POST',
    {authorName:'Cliente',fileId:file,body:'Tempo inválido',seconds:'85'}),e=>e.status===400);
  f.sql.prepare('UPDATE review_assets SET mime_type=? WHERE review_id=?').run('image/png',a.id);
  await assert.rejects(()=>route(f,a.token,'/reviews/public/comment','POST',
    {authorName:'Cliente',fileId:file,body:'Imagem sem tempo',seconds:85}),e=>e.status===400);
  const valid=await route(f,a.token,'/reviews/public/comment','POST',
    {authorName:'Cliente',fileId:file,body:'Imagem aprovada',seconds:null});
  assert.equal((await valid.json()).saved,true);
});
test('Google-restricted link requires verified recipient even if the URL leaks',async t=>{
  const f=fixture();t.after(f.close);
  const a=await inserted(f,{mode:'google'});
  await assert.rejects(()=>route(f,a.token),e=>e.status===401);
  await assert.rejects(()=>route(f,a.token,'/reviews/public/comment','POST',{
    fileId:file,authorName:'Wrong',body:'Change'
  }),e=>e.status===401);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM review_comments').get().n,0);
});
test('comments are file-scoped, timecodes validated; only one decision per version',async t=>{
  const f=fixture();t.after(f.close);
  const a=await inserted(f);
  const wrong=req(a.token,'/reviews/public/comment','POST',{authorName:'Cliente',fileId:'FILE_WRONG_12345678',body:'Ajuste'});
  await assert.rejects(()=>reviewRouter(wrong,f.env,new URL(wrong.url)),e=>e.code==='review_invalid_input');
  await assert.rejects(()=>route(f,a.token,'/reviews/public/comment','POST',
    {authorName:'Cliente',fileId:file,body:'Ajuste',seconds:'invalid'}),e=>e.code==='review_invalid_input');
  const comment=await route(f,a.token,'/reviews/public/comment','POST',
    {authorName:'Cliente',fileId:file,body:'Aumentar legenda',seconds:42});
  assert.equal((await comment.json()).saved,true);
  const before=await (await route(f,a.token)).json();
  assert.equal(before.comments.length,1);
  assert.equal(before.comments[0].seconds,42);
  const decide=await route(f,a.token,'/reviews/public/decide','POST',
    {authorName:'Cliente',decision:'changes',message:'Aumentar o título'});
  assert.equal((await decide.json()).status,'changes');
  await assert.rejects(()=>route(f,a.token,'/reviews/public/decide','POST',
    {authorName:'Cliente',decision:'approved'}),e=>e.code==='review_already_decided');
  await assert.rejects(()=>route(f,a.token,'/reviews/public/comment','POST',
    {authorName:'Cliente',fileId:file,body:'Late'}),e=>e.code==='review_already_decided');
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM review_decisions').get().n,1);
  assert.equal(f.sql.prepare('SELECT status FROM review_requests WHERE id=?').get(a.id).status,'changes');
});
test('drafts and partially published versions cannot leak through public read',async t=>{
  const f=fixture();t.after(f.close);
  const a=await inserted(f,{status:'draft'});
  for(const status of ['draft','publishing','replacing','closing']){
    f.sql.prepare('UPDATE review_requests SET status=? WHERE id=?').run(status,a.id);
    await assert.rejects(()=>route(f,a.token),e=>e.status===409||e.status===404);
  }
  f.sql.prepare("UPDATE review_requests SET status='pending' WHERE id=?").run(a.id);
  f.sql.prepare("UPDATE review_assets SET grant_state='granting' WHERE review_id=?").run(a.id);
  await assert.rejects(()=>route(f,a.token),e=>e.code==='review_not_ready');
});
test('disconnect is blocked while linked reviews active; deleting owner clears closed drafts',async t=>{
  const f=fixture();t.after(f.close);
  const a=await inserted(f,{status:'draft'});
  f.sql.prepare("UPDATE review_assets SET grant_state='unshared' WHERE review_id=?").run(a.id);
  await assert.rejects(()=>assertNoConnectionReviews(f.env,'alice',account),e=>e.code==='review_close_before_disconnect');
  assert.equal(await closeOwnerReviews(f.env,'alice'),false);
  assert.equal(f.sql.prepare('SELECT status FROM review_requests WHERE id=?').get(a.id).status,'closed');
  assert.equal(await closeOwnerReviews(f.env,'alice'),false);
  assert.equal(await closeOwnerReviews(f.env,'alice'),true);
  await assertNoConnectionReviews(f.env,'alice',account);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM review_requests').get().n,0);
});
test('expiry maintenance closes drafts and denies the public token',async t=>{
  const f=fixture();t.after(f.close);
  const a=await inserted(f,{status:'draft',expires:Date.now()-1000});
  f.sql.prepare("UPDATE review_assets SET grant_state='unshared' WHERE review_id=?").run(a.id);
  f.sql.prepare('UPDATE review_requests SET updated_at=? WHERE id=?').run(Date.now()-120000,a.id);
  await cleanupExpiredReviews(f.env);
  assert.equal(f.sql.prepare('SELECT status FROM review_requests WHERE id=?').get(a.id).status,'closed');
  await assert.rejects(()=>route(f,a.token),e=>e.status===404);
});

async function integration(t){
  const f=fixture();t.after(f.close);
  const encrypted=await encrypt(f.env,'refresh',context(f.env,'alice','google-alice'));
  f.sql.prepare("UPDATE drive_connections SET encrypted_refresh_token=? WHERE owner_uid='alice'").run(encrypted);
  const timestamp=Date.now();
  for(const uid of ['alice','bob'])f.sql.prepare(
    'INSERT INTO access_accounts(owner_uid,trial_started_at,trial_ends_at,created_at,updated_at) VALUES(?,?,?,?,?)')
    .run(uid,timestamp,timestamp+604800000,timestamp,timestamp);
  const jwk=await exportJWK(pair.publicKey);jwk.kid='review-test';
  const issued=Math.floor(Date.now()/1000);
  const jwt=async (sub,email)=>new SignJWT({auth_time:issued,...(email?{email,email_verified:true,
    firebase:{sign_in_provider:'google.com',identities:{'google.com':['google-'+sub]}}}:{})})
    .setProtectedHeader({alg:'RS256',kid:'review-test'})
    .setAudience(f.env.FIREBASE_PROJECT_ID)
    .setIssuer('https://securetoken.google.com/'+f.env.FIREBASE_PROJECT_ID)
    .setSubject(sub).setIssuedAt(issued).setExpirationTime(issued+300).sign(pair.privateKey);
  const alice=await jwt('alice'),bob=await jwt('bob');
  const folder='PARENT_FOLDER_12345';
  const env={...f.env,GOOGLE_CLIENT_ID:'client-id-test',GOOGLE_CLIENT_SECRET:'client-secret-test',
    FRONTEND_ORIGIN:'https://roteiva-web-dev.web.app',
    OAUTH_REDIRECT_URI:'https://roteiva-api-dev.ewertonmendes9.workers.dev/oauth/drive/callback',
    API_RATE_LIMIT:{limit:async()=>({success:true})},
    API_THUMB_LIMIT:{limit:async()=>({success:true})}};
  const acl=new Map(),imageAcl=new Map();
  const calls=[];
  const hooks={beforeGrant:null,deleteFails:false,lostGrant:false,outside:false,
    publicFolder:false,unauthorized:false,disableInheritance:false};
  const previous=globalThis.fetch;
  globalThis.fetch=async(url,init={})=>{
    const u=new URL(String(url));calls.push({host:u.host,path:u.pathname,method:init.method||'GET'});
    if(u.pathname.includes('/service_accounts/v1/jwk/'))
      return Response.json({keys:[jwk]});
    if(u.host==='firestore.googleapis.com'){
      const p=u.pathname;
      if(p.includes('/users/bob/'))return new Response(null,{status:404});
      if(p.endsWith('/projects/17'))return Response.json({fields:{
        ownerUid:{stringValue:'alice'},clientId:{integerValue:'7'},name:{stringValue:'Filme'}}});
      if(p.endsWith('/clients/7'))return Response.json({fields:{
        ownerUid:{stringValue:'alice'},name:{stringValue:'Empresa'}}});
      if(p.endsWith('/driveFolders/17_'+account+'_'+folder))
        return Response.json({fields:{ownerUid:{stringValue:'alice'},projectId:{integerValue:'17'},
          connectionId:{stringValue:account},folderId:{stringValue:folder}}});
      return new Response(null,{status:404});
    }
    if(u.host==='oauth2.googleapis.com'&&u.pathname==='/token')
      return Response.json({access_token:'short-lived',token_type:'Bearer',expires_in:3600});
    if(u.host==='www.googleapis.com'){
      assert.equal(init.headers.Authorization,'Bearer short-lived');
      if(u.pathname.endsWith('/files/'+file)&&u.searchParams.get('alt')==='media'){
        assert.match(init.headers.Range||'',/^bytes=0-\d+$/);
        return new Response(new Uint8Array([1,2,3,4]),{status:206,headers:{
          'Content-Type':'video/mp4','Content-Range':'bytes 0-3/100',
          'Content-Length':'4','Accept-Ranges':'bytes'}});
      }
      if(u.pathname.endsWith('/files/'+imageFile)&&u.searchParams.get('alt')==='media'){
        return new Response(new Uint8Array([1,2,3,4]),{status:206,headers:{
          'Content-Type':'image/png','Content-Range':'bytes 0-3/100',
          'Content-Length':'4','Accept-Ranges':'bytes'}});
      }
      if(u.pathname.endsWith('/files/'+imageFile))return Response.json({
        id:imageFile,name:'Capa de campanha.png',mimeType:'image/png',
        trashed:false,isAppAuthorized:!hooks.unauthorized,inheritedPermissionsDisabled:hooks.disableInheritance,
        parents:[folder],capabilities:{canShare:!hooks.unauthorized}});
      if(u.pathname.endsWith('/files/'+file))return Response.json({
        id:file,name:'Primeiro corte.mp4',mimeType:'video/mp4',
        trashed:false,isAppAuthorized:!hooks.unauthorized,inheritedPermissionsDisabled:hooks.disableInheritance,
        parents:[hooks.outside?'OTHER_FOLDER_12345':folder],capabilities:{canShare:!hooks.unauthorized}});
      if(u.pathname.endsWith('/files/'+folder))return Response.json({
        id:folder,name:'Projeto',mimeType:'application/vnd.google-apps.folder',
        trashed:false,isAppAuthorized:true,parents:['root'],capabilities:{canShare:true}});
      if(u.pathname.endsWith('/files/OTHER_FOLDER_12345'))return Response.json({
        id:'OTHER_FOLDER_12345',mimeType:'application/vnd.google-apps.folder',parents:[]});
      if(u.pathname.endsWith('/files/'+folder+'/permissions')){
        return Response.json({permissions:hooks.publicFolder?[
          {id:'folder-share',type:'anyone',role:'reader',permissionDetails:[{inherited:false}]}]:[]});
      }
      if(u.pathname.endsWith('/files/'+imageFile+'/permissions')){
        if(init.method==='POST'){
          const value=JSON.parse(init.body),id='image-permission-'+(imageAcl.size+1);
          imageAcl.set(id,value);return Response.json({id,...value});
        }
        return Response.json({permissions:[...imageAcl].map(([id,p])=>({id,...p}))});
      }
      if(u.pathname.includes('/files/'+imageFile+'/permissions/')&&init.method==='DELETE'){
        imageAcl.delete(u.pathname.split('/').at(-1));return new Response(null,{status:204});
      }
      if(u.pathname.endsWith('/files/'+file+'/permissions')){
        if(init.method==='POST'){
          const value=JSON.parse(init.body);
          assert.equal(u.searchParams.has('sendNotificationEmail'),value.type==='user');
          if(hooks.beforeGrant)await hooks.beforeGrant();
          const id='permission-'+(acl.size+1);
          acl.set(id,JSON.parse(init.body));
          if(hooks.lostGrant){hooks.lostGrant=false;throw new Error('lost response');}
          return Response.json({id,...value});
        }
        return Response.json({permissions:[...acl].map(([id,p])=>({id,...p})),nextPageToken:undefined});
      }
      if(u.pathname.includes('/files/'+file+'/permissions/')&&init.method==='DELETE'){
        if(hooks.deleteFails)return new Response(null,{status:503});
        acl.delete(u.pathname.split('/').at(-1));
        return new Response(null,{status:204});
      }
    }
    throw Error('Unexpected request in review integration test: '+u.href);
  };
  t.after(()=>{globalThis.fetch=previous;});
  const send=(method,path,token,payload)=>
    handle(new Request(BASE+path,{method,
      headers:{Origin:env.FRONTEND_ORIGIN,Authorization:'Bearer '+token,
        ...(payload?{'Content-Type':'application/json'}:{})},
      ...(payload?{body:JSON.stringify(payload)}:{})}),env);
  const payload={clientId:7,projectId:17,studioName:'Estudio',title:'Primeiro corte',message:'Avalie',
    mode:'link',driveShareEnabled:true,expiresInDays:14,assets:[{fileId:file,connectionId:account,linkedFolderId:folder}]};
  return {f,env,send,payload,alice,bob,jwt,acl,imageAcl,calls,hooks};
}
test('public video media uses signed range tickets and stops immediately after review closure',async t=>{
  const x=await integration(t);
  const {id,published}=await createAndPublish(x);
  assert.equal(published.status,200);
  const result=await published.json();
  const access=result.review.review.url.split('/').at(-1);
  const issued=await route(x.f,access,'/reviews/public/media-ticket','POST',{fileId:file});
  assert.equal(issued.status,200);
  const {url}=await issued.json();
  assert.match(url,/\/reviews\/media\?ticket=/);
  const video=await handle(new Request(url,{headers:{Range:'bytes=0-'}}),x.env);
  assert.equal(video.status,206);
  assert.equal(video.headers.get('Content-Range'),'bytes 0-3/100');
  assert.equal(video.headers.get('Content-Type'),'video/mp4');
  assert.deepEqual([...new Uint8Array(await video.arrayBuffer())],[1,2,3,4]);
  assert.equal(video.headers.get('Cache-Control'),'no-store');
  assert.equal((await x.send('POST','/reviews/'+id+'/rotate',x.alice)).status,200);
  assert.equal((await handle(new Request(url),x.env)).status,404);
  const invalid=await handle(new Request(url.slice(0,-1)+(url.endsWith('A')?'B':'A')),x.env);
  assert.equal(invalid.status,404);
  assert.equal((await x.send('POST','/reviews/'+id+'/close',x.alice)).status,200);
  const rejected=await handle(new Request(url,{headers:{Range:'bytes=0-'}}),x.env);
  assert.equal(rejected.status,404);
});

test('real HTTP: owner A can publish/revoke only linked Drive files, owner B cannot read or publish A assets',async t=>{
  const {f,send,payload,alice,bob,acl,calls}=await integration(t);
  const denied=await send('POST','/reviews',bob,payload);
  assert.equal(denied.status,403);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM review_requests').get().n,0);
  const created=await send('POST','/reviews',alice,payload);
  assert.equal(created.status,201);
  const {id}=await created.json();
  const unseen=await send('GET','/reviews/'+id,bob);
  assert.equal(unseen.status,404);
  const published=await send('POST','/reviews/'+id+'/publish',alice);
  assert.equal(published.status,200);
  const view=await published.json();
  assert.equal(view.review.review.status,'pending');
  assert.equal(acl.size,1);
  const publicToken=new URL(view.review.review.url).pathname.split('/').at(-1);
  const guest=await route(f,publicToken);
  assert.equal((await guest.json()).assets[0].fileId,file);
  await send('POST','/reviews/'+id+'/rotate',alice);
  await assert.rejects(()=>route(f,publicToken),e=>e.status===404);
  const closed=await send('POST','/reviews/'+id+'/close',alice);
  assert.equal(closed.status,200);
  assert.equal(acl.size,0);
  const row=f.sql.prepare("SELECT status FROM review_requests WHERE id=?").get(id);
  assert.equal(row.status,'closed');
  assert.equal(calls.filter(x=>x.path.includes('/permissions')&&x.method==='POST').length,1);
});

async function createAndPublish(x,overrides={}){
  const created=await x.send('POST','/reviews',x.alice,{...x.payload,...overrides});
  assert.equal(created.status,201);
  const {id}=await created.json();
  const published=await x.send('POST','/reviews/'+id+'/publish',x.alice);
  return {id,published};
}
test('reject file outside authorized ancestry before persisting or granting',async t=>{
  const x=await integration(t);x.hooks.outside=true;
  const res=await x.send('POST','/reviews',x.alice,x.payload);
  assert.equal(res.status,403);
  assert.equal(x.f.sql.prepare('SELECT COUNT(*) n FROM review_requests').get().n,0);
  assert.equal(x.acl.size,0);
});
test('public linked folder grants inherited reader access without modifying owner ACL',async t=>{
  const x=await integration(t);x.hooks.publicFolder=true;x.hooks.unauthorized=true;
  const {id,published}=await createAndPublish(x);
  assert.equal(published.status,200);
  const record=x.f.sql.prepare('SELECT grant_state,permission_id FROM review_assets WHERE review_id=?').get(id);
  assert.equal(record.grant_state,'granted');
  assert.equal(record.permission_id,null);
  assert.equal(x.calls.filter(c=>c.method==='POST'&&c.path.endsWith('/permissions')).length,0);
  assert.equal((await x.send('POST','/reviews/'+id+'/close',x.alice)).status,200);
  assert.equal(x.calls.filter(c=>c.method==='DELETE'&&c.path.includes('/permissions/')).length,0);
});
test('file already shared by owner is accepted and never revoked by Roteiva',async t=>{
  const x=await integration(t);x.hooks.unauthorized=true;
  x.acl.set('owner-public',{type:'anyone',role:'reader'});
  const {id,published}=await createAndPublish(x);
  assert.equal(published.status,200);
  assert.equal((await x.send('POST','/reviews/'+id+'/close',x.alice)).status,200);
  assert.equal(x.acl.has('owner-public'),true);
  assert.equal(x.calls.filter(c=>c.method==='DELETE'||c.method==='POST'&&c.path.includes('/permissions')).length,0);
});
test('Google identity protects approval even when the linked Drive folder is public',async t=>{
  const x=await integration(t);x.hooks.publicFolder=true;x.hooks.unauthorized=true;
  const {id,published}=await createAndPublish(x,{mode:'google',recipientEmail:'client@gmail.com'});
  assert.equal(published.status,200);
  const token=(await published.json()).review.review.url.split('/').at(-1);
  const authorized=await x.jwt('client','client@gmail.com');
  const unrelated=await x.jwt('stranger','stranger@gmail.com');
  assert.equal((await route(x.f,token,undefined,undefined,undefined,authorized)).status,200);
  await assert.rejects(()=>route(x.f,token,undefined,undefined,undefined,unrelated),e=>e.status===403);
  assert.equal(x.calls.filter(c=>c.method==='POST'&&c.path.endsWith('/permissions')).length,0);
  assert.equal((await x.send('POST','/reviews/'+id+'/close',x.alice)).status,200);
  x.hooks.publicFolder=false;
  const portal=await createAndPublish(x,{mode:'google',recipientEmail:'client@gmail.com',driveShareEnabled:false});
  assert.equal(portal.published.status,200,'portal-only requires no file ACL mutation');
  assert.equal((await x.send('POST','/reviews/'+portal.id+'/close',x.alice)).status,200);
  const denied=await createAndPublish(x,{mode:'google',recipientEmail:'client@gmail.com'});
  assert.equal(denied.published.status,409);
  const detail=(await denied.published.json()).error;
  assert.equal(detail.code,'review_drive_file_authorization_required');
  assert.equal(detail.asset.fileId,file);
  assert.equal(detail.asset.fileName,'Primeiro corte.mp4');
  assert.equal((await x.send('POST','/reviews/'+denied.id+'/close',x.alice)).status,200);
});
test('Google-restricted review publishes video and image from a public folder without mutating Drive ACLs',async t=>{
  const x=await integration(t);x.hooks.publicFolder=true;x.hooks.unauthorized=true;
  const selection=[...x.payload.assets,{fileId:imageFile,connectionId:account,linkedFolderId:x.payload.assets[0].linkedFolderId}];
  const {id,published}=await createAndPublish(x,{mode:'google',recipientEmail:'client@gmail.com',assets:selection});
  assert.equal(published.status,200);
  const granted=x.f.sql.prepare("SELECT name,grant_state FROM review_assets WHERE review_id=? ORDER BY name").all(id);
  assert.deepEqual(granted.map(r=>[r.name,r.grant_state]),[['Capa de campanha.png','granted'],['Primeiro corte.mp4','granted']]);
  const invitation=(await published.json()).review.review.url.split('/').at(-1);
  const recipient=await x.jwt('recipient','client@gmail.com');
  const stranger=await x.jwt('stranger','stranger@gmail.com');
  assert.equal((await route(x.f,invitation,undefined,undefined,undefined,recipient)).status,200);
  await assert.rejects(()=>route(x.f,invitation,undefined,undefined,undefined,stranger),e=>e.status===403);
  assert.equal(x.calls.filter(v=>['POST','DELETE'].includes(v.method)&&v.path.includes('/permissions')).length,0);
  assert.equal((await x.send('POST','/reviews/'+id+'/close',x.alice)).status,200);
});
test('publication identifies the blocked image and can safely resume without recreating approval',async t=>{
  const x=await integration(t);x.hooks.unauthorized=true;
  x.acl.set('owner-public',{type:'anyone',role:'reader'});
  const selection=[...x.payload.assets,{fileId:imageFile,connectionId:account,linkedFolderId:x.payload.assets[0].linkedFolderId}];
  const created=await x.send('POST','/reviews',x.alice,{...x.payload,mode:'google',
    recipientEmail:'client@gmail.com',assets:selection});
  assert.equal(created.status,201);
  const {id}=await created.json();
  const failed=await x.send('POST','/reviews/'+id+'/publish',x.alice);
  assert.equal(failed.status,409);
  const error=(await failed.json()).error;
  assert.equal(error.code,'review_drive_file_authorization_required');
  assert.deepEqual(error.asset,{fileId:imageFile,fileName:'Capa de campanha.png'});
  x.hooks.unauthorized=false;
  const retried=await x.send('POST','/reviews/'+id+'/publish',x.alice);
  assert.equal(retried.status,200);
  assert.equal((await retried.json()).review.review.status,'pending');
  assert.equal((await x.send('POST','/reviews/'+id+'/close',x.alice)).status,200);
  assert.equal(x.acl.has('owner-public'),true);
});
test('restricted review verifies Google recipient and preserves their pre-existing ACL',async t=>{
  const x=await integration(t);
  x.acl.set('external-reader',{type:'user',role:'reader',emailAddress:'client@gmail.com'});
  const {id,published}=await createAndPublish(x,{mode:'google',recipientEmail:'client@gmail.com'});
  assert.equal(published.status,200);
  const result=await published.json();const token=result.review.review.url.split('/').at(-1);
  const correct=await x.jwt('recipient','client@gmail.com');
  const wrong=await x.jwt('intruder','wrong@gmail.com');
  assert.equal((await route(x.f,token,undefined,undefined,undefined,correct)).status,200);
  await assert.rejects(()=>route(x.f,token,undefined,undefined,undefined,wrong),e=>e.status===403);
  assert.equal((await x.send('POST','/reviews/'+id+'/close',x.alice)).status,200);
  assert.equal(x.acl.has('external-reader'),true);
  assert.equal(x.calls.filter(c=>c.method==='DELETE').length,0);
});
test('Google-restricted portal preserves public, group and domain Drive permissions',async t=>{
  const x=await integration(t);
  for(const type of ['anyone','domain','group']){
    x.acl.set('external',{type,role:'reader',emailAddress:'other@gmail.com'});
    const {id,published}=await createAndPublish(x,{mode:'google',recipientEmail:'client@gmail.com'});
    assert.equal(published.status,200,'existing '+type+' ACL must not block the portal');
    assert.equal((await x.send('POST','/reviews/'+id+'/close',x.alice)).status,200);
    assert.equal(x.acl.has('external'),true,'existing '+type+' ACL remains untouched');
    x.acl.clear();
  }
  const {id,published}=await createAndPublish(x,{mode:'google',recipientEmail:'client@gmail.com'});
  assert.equal(published.status,200);
  assert.deepEqual([...x.acl.values()],[{type:'user',role:'reader',emailAddress:'client@gmail.com'}]);
  assert.equal((await x.send('POST','/reviews/'+id+'/close',x.alice)).status,200);
  assert.equal(x.acl.size,0);
});
test('another review cannot adopt a pending grant; failed deletion stays closing until cron confirms',async t=>{
  const x=await integration(t);x.hooks.lostGrant=true;
  const first=await createAndPublish(x);
  assert.equal(first.published.status,503);
  assert.equal(x.acl.size,1);
  const second=await createAndPublish(x);
  assert.equal(second.published.status,409);
  assert.equal((await second.published.json()).error.code,'review_file_in_use');
  x.hooks.deleteFails=true;
  assert.equal((await x.send('POST','/reviews/'+first.id+'/close',x.alice)).status,503);
  assert.equal(x.f.sql.prepare('SELECT status FROM review_requests WHERE id=?').get(first.id).status,'closing');
  x.hooks.deleteFails=false;
  x.f.sql.prepare('UPDATE review_requests SET updated_at=0 WHERE id=?').run(first.id);
  await cleanupExpiredReviews(x.env);
  assert.equal(x.acl.size,0);
  assert.equal(x.f.sql.prepare('SELECT status FROM review_requests WHERE id=?').get(first.id).status,'closed');
  assert.equal((await x.send('POST','/reviews/'+second.id+'/publish',x.alice)).status,200);
});
test('simultaneous grant/close cannot declare closure before Google response; compensation can retry',async t=>{
  const x=await integration(t);
  let release,started;
  const waiting=new Promise(resolve=>{release=resolve;});
  const entered=new Promise(resolve=>{started=resolve;});
  x.hooks.beforeGrant=async()=>{started();await waiting;};
  const created=await x.send('POST','/reviews',x.alice,x.payload);const {id}=await created.json();
  const publish=x.send('POST','/reviews/'+id+'/publish',x.alice);
  await entered;
  assert.equal((await x.send('POST','/reviews/'+id+'/publish',x.alice)).status,409);
  assert.equal((await x.send('POST','/reviews/'+id+'/close',x.alice)).status,409);
  assert.equal(x.f.sql.prepare('SELECT status FROM review_requests WHERE id=?').get(id).status,'closing');
  x.hooks.deleteFails=true;release();
  assert.equal((await publish).status,503);
  assert.equal(x.acl.size,1);
  assert.equal(x.f.sql.prepare('SELECT grant_state FROM review_assets WHERE review_id=?').get(id).grant_state,'revoking');
  x.hooks.deleteFails=false;
  assert.equal((await x.send('POST','/reviews/'+id+'/close',x.alice)).status,200);
  assert.equal(x.acl.size,0);
});
test('lost grant response reconciles once, stale-version decisions are rejected and duplicate clicks remain atomic',async t=>{
  const x=await integration(t);x.hooks.lostGrant=true;
  const {id,published}=await createAndPublish(x);assert.equal(published.status,503);
  const resumed=await x.send('POST','/reviews/'+id+'/publish',x.alice);assert.equal(resumed.status,200);
  assert.equal(x.calls.filter(c=>c.method==='POST'&&c.path.endsWith('/permissions')).length,1);
  const result=await resumed.json(),token=result.review.review.url.split('/').at(-1);
  x.f.sql.prepare('UPDATE review_requests SET current_version=2 WHERE id=?').run(id);
  x.f.sql.prepare('UPDATE review_assets SET version=2 WHERE review_id=?').run(id);
  await assert.rejects(()=>route(x.f,token,'/reviews/public/decide','POST',
    {authorName:'Client',decision:'approved',version:1}),e=>e.code==='review_version_changed');
  const results=await Promise.allSettled([1,2].map(()=>route(x.f,token,'/reviews/public/decide','POST',
    {authorName:'Client',decision:'approved',version:2})));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(x.f.sql.prepare('SELECT COUNT(*) n FROM review_decisions').get().n,1);
});

test('review may cycle through unlimited requested versions without invalid state',async t=>{
  const x=await integration(t);
  const {id,published}=await createAndPublish(x);
  assert.equal(published.status,200);
  const token=(await published.json()).review.review.url.split('/').at(-1);
  for(let n=2;n<=6;n++){
    const changes=await route(x.f,token,'/reviews/public/decide','POST',
      {version:n-1,authorName:'Client',decision:'changes',message:'Another revision'});
    assert.equal(changes.status,200,'request changes on version '+(n-1));
    const response=await x.send('POST','/reviews/'+id+'/revise',x.alice,{assets:x.payload.assets});
    assert.equal(response.status,200,'publish version '+n);
    const content=await response.json();
    assert.equal(content.review.review.version,n);
    assert.equal(content.review.review.status,'pending');
    assert.equal((await (await route(x.f,token)).json()).review.version,n);
    assert.equal(x.f.sql.prepare("SELECT COUNT(*) n FROM review_assets WHERE review_id=? AND grant_state='granted'").get(id).n,1);
    assert.equal(x.acl.size,1);
  }
  const approved=await route(x.f,token,'/reviews/public/decide','POST',
    {version:6,authorName:'Client',decision:'approved'});
  assert.equal(approved.status,200);
  assert.equal(x.f.sql.prepare("SELECT COUNT(*) n FROM review_decisions WHERE review_id=?").get(id).n,6);
  assert.equal((await x.send('POST','/reviews/'+id+'/close',x.alice)).status,200);
  assert.equal(x.acl.size,0);
});
test('revision resumes an incomplete replacing state without losing the original selection',async t=>{
  const x=await integration(t);
  const {id,published}=await createAndPublish(x);
  assert.equal(published.status,200);
  const token=(await published.json()).review.review.url.split('/').at(-1);
  assert.equal((await route(x.f,token,'/reviews/public/decide','POST',
    {authorName:'Client',decision:'changes',message:'Try again'})).status,200);
  x.f.sql.prepare("UPDATE review_requests SET status='replacing',transition_id=? WHERE id=?")
    .run('recovery-fence',id);
  assert.equal(x.f.sql.prepare('SELECT COUNT(*) n FROM review_assets WHERE review_id=? AND version=2').get(id).n,0);
  const fixed=await x.send('POST','/reviews/'+id+'/revise',x.alice,{assets:x.payload.assets});
  assert.equal(fixed.status,200);
  const state=await fixed.json();
  assert.equal(state.review.review.version,2);
  assert.equal(state.review.review.status,'pending');
  assert.equal(x.f.sql.prepare('SELECT COUNT(*) n FROM review_assets WHERE review_id=? AND version=2').get(id).n,1);
  assert.equal(x.f.sql.prepare('SELECT transition_id FROM review_requests WHERE id=?').get(id).transition_id,null);
});
test('revision resumes a committed version switch and only publishes it once',async t=>{
  const x=await integration(t);
  const {id,published}=await createAndPublish(x);
  assert.equal(published.status,200);
  const token=(await published.json()).review.review.url.split('/').at(-1);
  assert.equal((await route(x.f,token,'/reviews/public/decide','POST',
    {authorName:'Client',decision:'changes',message:'Fix design'})).status,200);
  const first=await x.send('POST','/reviews/'+id+'/revise',x.alice,{assets:x.payload.assets});
  assert.equal(first.status,200);
  x.f.sql.prepare("UPDATE review_requests SET status='draft' WHERE id=?").run(id);
  x.f.sql.prepare("UPDATE review_assets SET grant_state='unshared',permission_id=NULL WHERE review_id=? AND version=2").run(id);
  x.acl.clear();
  x.f.sql.prepare('DELETE FROM review_file_claims').run();
  const resumed=await x.send('POST','/reviews/'+id+'/revise',x.alice,{assets:[]});
  assert.equal(resumed.status,200);
  assert.equal((await resumed.json()).review.review.version,2);
});
test('concurrent replacement keeps one complete version, revokes prior ACL and retains decision history',async t=>{
  const x=await integration(t);const {id,published}=await createAndPublish(x);
  assert.equal(published.status,200);
  const result=await published.json(),token=result.review.review.url.split('/').at(-1);
  await route(x.f,token,'/reviews/public/decide','POST',{authorName:'Client',decision:'changes',message:'New cut'});
  const results=await Promise.all([1,2].map(()=>x.send('POST','/reviews/'+id+'/revise',x.alice,{assets:x.payload.assets})));
  assert.equal(results.filter(r=>r.status===200).length,1);
  assert.equal(results.filter(r=>r.status===409).length,1);
  assert.deepEqual(x.f.sql.prepare('SELECT version,grant_state FROM review_assets WHERE review_id=? ORDER BY version').all(id)
    .map(r=>({...r})),[{version:1,grant_state:'revoked'},{version:2,grant_state:'granted'}]);
  assert.equal(x.f.sql.prepare('SELECT COUNT(*) n FROM review_decisions WHERE review_id=?').get(id).n,1);
  assert.equal(x.acl.size,1);
  assert.equal((await (await route(x.f,token)).json()).review.version,2);
  assert.equal((await x.send('POST','/reviews/'+id+'/close',x.alice)).status,200);
  assert.equal(x.acl.size,0);
  assert.equal(x.f.sql.prepare('SELECT COUNT(*) n FROM review_file_claims').get().n,0);
});

test('expiry revokes actual mocked ACL; owner deletion revokes before removing review records and credentials',async t=>{
  const x=await integration(t);const first=await createAndPublish(x);
  assert.equal(first.published.status,200);assert.equal(x.acl.size,1);
  x.f.sql.prepare('UPDATE review_requests SET expires_at=0,updated_at=0 WHERE id=?').run(first.id);
  await cleanupExpiredReviews(x.env);assert.equal(x.acl.size,0);
  const second=await createAndPublish(x);assert.equal(second.published.status,200);
  assert.equal(await closeOwnerReviews(x.env,'alice'),false);assert.equal(x.acl.size,0);
  assert.equal(await closeOwnerReviews(x.env,'alice'),false);
  assert.equal(await closeOwnerReviews(x.env,'alice'),true);
  assert.equal(x.f.sql.prepare('SELECT COUNT(*) n FROM review_requests').get().n,0);
  assert.equal(x.f.sql.prepare('SELECT COUNT(*) n FROM review_assets').get().n,0);
  assert.equal(x.f.sql.prepare('SELECT COUNT(*) n FROM review_file_claims').get().n,0);
  assert.equal(x.f.sql.prepare('SELECT COUNT(*) n FROM drive_connections').get().n,1);
});

test('Google participants have verified roles and all reviewers must approve',async t=>{
  const x=await integration(t);
  const participants=[
    {email:'first@gmail.com',role:'reviewer'},
    {email:'second@gmail.com',role:'reviewer'},
    {email:'observer@gmail.com',role:'viewer'}
  ];
  const {id,published}=await createAndPublish(x,{mode:'google',recipientEmail:'first@gmail.com',participants});
  assert.equal(published.status,200);
  assert.equal(x.acl.size,3);
  const token=(await published.json()).review.review.url.split('/').at(-1);
  const first=await x.jwt('first','first@gmail.com');
  const second=await x.jwt('second','second@gmail.com');
  const observer=await x.jwt('observer','observer@gmail.com');
  const outsider=await x.jwt('outsider','outsider@gmail.com');
  await assert.rejects(()=>route(x.f,token,undefined,undefined,undefined,outsider),e=>e.status===403);
  const visible=await (await route(x.f,token,undefined,undefined,undefined,observer)).json();
  assert.equal(visible.review.role,'viewer');
  assert.equal(visible.assets.length,1);
  await assert.rejects(()=>route(x.f,token,'/reviews/public/comment','POST',
    {fileId:file,authorName:'Observer',body:'Illegal comment'},observer),e=>e.code==='review_viewer_read_only');
  await assert.rejects(()=>route(x.f,token,'/reviews/public/decide','POST',
    {authorName:'Observer',decision:'approved'},observer),e=>e.code==='review_viewer_read_only');
  assert.equal((await route(x.f,token,'/reviews/public/comment','POST',
    {fileId:file,authorName:'First',body:'Looks good'},first)).status,200);
  const vote=await route(x.f,token,'/reviews/public/decide','POST',
    {authorName:'First',decision:'approved'},first);
  assert.equal((await vote.json()).status,'pending');
  assert.equal(x.f.sql.prepare('SELECT status FROM review_requests WHERE id=?').get(id).status,'pending');
  assert.equal((await (await route(x.f,token,undefined,undefined,undefined,first)).json()).review.myVote,'approved');
  await assert.rejects(()=>route(x.f,token,'/reviews/public/decide','POST',
    {authorName:'First',decision:'approved'},first),e=>e.status===409);
  const final=await route(x.f,token,'/reviews/public/decide','POST',
    {authorName:'Second',decision:'approved'},second);
  assert.equal((await final.json()).status,'approved');
  assert.equal(x.f.sql.prepare('SELECT COUNT(*) n FROM review_votes WHERE review_id=?').get(id).n,2);
  assert.equal(x.f.sql.prepare('SELECT status FROM review_requests WHERE id=?').get(id).status,'approved');
  assert.equal((await x.send('POST','/reviews/'+id+'/close',x.alice)).status,200);
  assert.equal(x.acl.size,0);
});
test('Google reader ACLs are shared safely across independent active approvals',async t=>{
  const x=await integration(t);
  const p={mode:'google',recipientEmail:'first@gmail.com',participants:[
    {email:'first@gmail.com',role:'reviewer'},{email:'observer@gmail.com',role:'viewer'}
  ]};
  const one=await createAndPublish(x,p),two=await createAndPublish(x,p);
  assert.equal(one.published.status,200);
  assert.equal(two.published.status,200);
  assert.equal(x.acl.size,2,'one Drive permission per unique Google identity');
  assert.equal((await x.send('POST','/reviews/'+one.id+'/close',x.alice)).status,200);
  assert.equal(x.acl.size,2,'other approval still references each ACL');
  assert.equal((await x.send('POST','/reviews/'+two.id+'/close',x.alice)).status,200);
  assert.equal(x.acl.size,0);
});
test('owner explicitly restricts a directly public Drive file without removing other readers',async t=>{
  const x=await integration(t);
  x.acl.set('owner-public',{type:'anyone',role:'reader'});
  x.acl.set('owner-reader',{type:'user',role:'reader',emailAddress:'other@gmail.com'});
  const options={mode:'google',recipientEmail:'first@gmail.com',driveShareEnabled:true,restrictExistingPublic:true};
  const {id,published}=await createAndPublish(x,options);
  assert.equal(published.status,200);
  assert.equal(x.acl.has('owner-public'),false);
  assert.equal(x.acl.has('owner-reader'),true);
  assert.equal((await x.send('POST','/reviews/'+id+'/close',x.alice)).status,200);
  assert.equal(x.acl.has('owner-reader'),true);
});
test('same file may be reviewed in parallel; public grant survives the first close',async t=>{
  const x=await integration(t);
  const first=await createAndPublish(x),second=await createAndPublish(x);
  assert.equal(first.published.status,200);
  assert.equal(second.published.status,200);
  assert.equal(x.acl.size,1);
  assert.equal((await x.send('POST','/reviews/'+first.id+'/close',x.alice)).status,200);
  assert.equal(x.acl.size,1,'shared link permission cannot be deleted early');
  assert.equal((await x.send('POST','/reviews/'+second.id+'/close',x.alice)).status,200);
  assert.equal(x.acl.size,0);
});


test('portal-only review does not mutate Drive permissions and supports repeated files',async t=>{
  const x=await integration(t);
  x.acl.set('owner-public',{type:'anyone',role:'reader'});
  const base={driveShareEnabled:false,mode:'google',recipientEmail:'client@gmail.com'};
  const first=await createAndPublish(x,base),second=await createAndPublish(x,base);
  assert.equal(first.published.status,200);assert.equal(second.published.status,200);
  assert.equal(x.acl.size,1,'pre-existing ACL must remain intact');
  assert.equal(x.f.sql.prepare('SELECT drive_share_enabled FROM review_requests WHERE id=?')
    .get(first.id).drive_share_enabled,0);
  assert.equal((await x.send('POST','/reviews/'+first.id+'/close',x.alice)).status,200);
  assert.equal((await x.send('POST','/reviews/'+second.id+'/close',x.alice)).status,200);
  assert.equal(x.acl.size,1);
});
test('Google-only video and image streaming require verified review membership before ticket mint',async t=>{
  const x=await integration(t);
  const people=[{email:'reviewer@gmail.com',role:'reviewer'},{email:'viewer@gmail.com',role:'viewer'}];
  const created=await createAndPublish(x,{driveShareEnabled:false,mode:'google',
    recipientEmail:'reviewer@gmail.com',participants:people});
  assert.equal(created.published.status,200);
  const invite=(await created.published.json()).review.review.url.split('/').at(-1);
  const viewer=await x.jwt('viewer','viewer@gmail.com');
  const intruder=await x.jwt('intruder','intruder@gmail.com');
  await assert.rejects(()=>route(x.f,invite,'/reviews/public/media-ticket','POST',
    {fileId:file}),e=>e.status===401);
  await assert.rejects(()=>route(x.f,invite,'/reviews/public/media-ticket','POST',
    {fileId:file},intruder),e=>e.status===403);
  await assert.rejects(()=>route(x.f,invite,'/reviews/public/media-ticket','POST',
    {fileId:'OTHER_FILE_12345678'},viewer),e=>e.status===404);
  const ticket=await route(x.f,invite,'/reviews/public/media-ticket','POST',{fileId:file},viewer);
  assert.equal(ticket.status,200);
  const address=(await ticket.json()).url;
  const stream=await handle(new Request(address,{headers:{Range:'bytes=0-'}}),x.env);
  assert.equal(stream.status,206);
  assert.equal(stream.headers.get('Content-Range'),'bytes 0-3/100');
  assert.match(stream.headers.get('Cache-Control')||'',/no-store/);
  assert.deepEqual([...new Uint8Array(await stream.arrayBuffer())],[1,2,3,4]);
  assert.equal((await x.send('POST','/reviews/'+created.id+'/close',x.alice)).status,200);
  assert.equal((await handle(new Request(address),x.env)).status,404);
});

test('new invitations default to portal-only without modifying existing Google Drive ACLs',async t=>{
  const x=await integration(t);
  const input={...x.payload};delete input.driveShareEnabled;
  const created=await x.send('POST','/reviews',x.alice,input);
  assert.equal(created.status,201);
  const {id}=await created.json();
  const row=x.f.sql.prepare('SELECT drive_share_enabled FROM review_requests WHERE id=?').get(id);
  assert.equal(row.drive_share_enabled,0);
  const published=await x.send('POST','/reviews/'+id+'/publish',x.alice);
  assert.equal(published.status,200);
  const token=(await published.json()).review.review.url.split('/').at(-1);
  const issued=await route(x.f,token,'/reviews/public/media-ticket','POST',{fileId:file});
  assert.equal(issued.status,200);
  assert.equal(x.acl.size,0,'portal-only must not publish a public Drive permission');
  assert.equal((await x.send('POST','/reviews/'+id+'/close',x.alice)).status,200);
  assert.equal(x.calls.filter(c=>c.path.includes('/permissions')&&['POST','DELETE'].includes(c.method)).length,0);
});

test('unsupported Drive-native documents fail explicitly without minting unusable tickets',async t=>{
  const x=await integration(t);
  const {id,published}=await createAndPublish(x,{driveShareEnabled:false});
  assert.equal(published.status,200);
  x.f.sql.prepare("UPDATE review_assets SET mime_type=? WHERE review_id=?").run('application/vnd.google-apps.document',id);
  const invite=(await published.json()).review.review.url.split('/').at(-1);
  await assert.rejects(()=>route(x.f,invite,'/reviews/public/media-ticket','POST',{fileId:file}),
    e=>e.status===415&&e.code==='review_media_unsupported');
});
