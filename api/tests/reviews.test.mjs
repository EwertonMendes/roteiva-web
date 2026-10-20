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
  },...(method==='POST'?{body:JSON.stringify(body)}:{})});
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
  assert.equal(JSON.stringify(result).includes(b.token),false);
  await assert.rejects(()=>route(f,random()),e=>e.status===404);
  f.sql.prepare("UPDATE review_requests SET expires_at=0 WHERE id=?").run(a.id);
  await assert.rejects(()=>route(f,a.token),e=>e.code==='review_expired');
  f.sql.prepare("UPDATE review_requests SET expires_at=?,status='closed' WHERE id=?").run(Date.now()+100000,a.id);
  await assert.rejects(()=>route(f,a.token),e=>e.status===404);
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

test('real HTTP: owner A can publish/revoke only linked Drive files, owner B cannot read or publish A assets',async t=>{
  const f=fixture();t.after(f.close);
  const encrypted=await encrypt(f.env,'refresh',context(f.env,'alice','google-alice'));
  f.sql.prepare("UPDATE drive_connections SET encrypted_refresh_token=? WHERE owner_uid='alice'").run(encrypted);
  const timestamp=Date.now();
  for(const uid of ['alice','bob'])f.sql.prepare(
    'INSERT INTO access_accounts(owner_uid,trial_started_at,trial_ends_at,created_at,updated_at) VALUES(?,?,?,?,?)')
    .run(uid,timestamp,timestamp+604800000,timestamp,timestamp);
  const pair=await generateKeyPair('RS256');
  const jwk=await exportJWK(pair.publicKey);jwk.kid='review-test';
  const issued=Math.floor(Date.now()/1000);
  const jwt=async sub=>new SignJWT({auth_time:issued})
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
  const acl=new Map();
  const calls=[];
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
      if(u.pathname.endsWith('/files/'+file))return Response.json({
        id:file,name:'Primeiro corte.mp4',mimeType:'video/mp4',
        trashed:false,isAppAuthorized:true,parents:[folder],capabilities:{canShare:true}});
      if(u.pathname.endsWith('/files/'+folder))return Response.json({
        id:folder,name:'Projeto',mimeType:'application/vnd.google-apps.folder',
        trashed:false,isAppAuthorized:true,parents:['root'],capabilities:{canShare:true}});
      if(u.pathname.endsWith('/files/'+file+'/permissions')){
        if(init.method==='POST'){
          const id='permission-'+(acl.size+1);
          acl.set(id,JSON.parse(init.body));
          return Response.json({id,type:'anyone',role:'reader'});
        }
        return Response.json({permissions:[...acl].map(([id,p])=>({id,...p})),nextPageToken:undefined});
      }
      if(u.pathname.includes('/files/'+file+'/permissions/')&&init.method==='DELETE'){
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
    mode:'link',expiresInDays:14,assets:[{fileId:file,connectionId:account,linkedFolderId:folder}]};
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
