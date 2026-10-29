import test from 'node:test';
import assert from 'node:assert/strict';
import {database} from './helpers/database.mjs';
import {encrypt,base64url,context} from '../src/crypto.ts';
import {listCoverImages,coverImage,MAX_COVER_BYTES} from '../src/project-covers.ts';
import {DRIVE_READ_SCOPE} from '../src/google.ts';
const id='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',fileId='image_123456789';
async function setup(){
 const env={ENVIRONMENT:'dev',TOKEN_KEY_VERSION:'v1',TOKEN_KEYS:JSON.stringify({v1:base64url(crypto.getRandomValues(new Uint8Array(32)))}),GOOGLE_CLIENT_ID:'demo',GOOGLE_CLIENT_SECRET:'secret'};
 const row={id,owner_uid:'alice',google_account_id:'google-alice',status:'connected',revision:1,scopes:DRIVE_READ_SCOPE,encrypted_refresh_token:await encrypt(env,'refresh',context(env,'alice','google-alice'))};
 const db=database(row);env.DB=db.DB;
 const fetcher=(handler)=>async(url,options)=>{
  if(String(url).includes('oauth2.googleapis.com/token'))return Response.json({access_token:'short-token',token_type:'Bearer',expires_in:3600});
  assert.equal(options.headers.Authorization,'Bearer short-token');assert.equal(options.redirect,'manual');
  return handler(new URL(url),options);
 };
 return {env,db,fetcher};
}
test('cover search is private, escaped, paginated and filters unsupported/oversized files',async()=>{
 const {env,db,fetcher}=await setup();try{
  const load=fetcher(url=>{assert.match(url.searchParams.get('q'),/name contains 'bob\\'s'/);assert.equal(url.searchParams.get('pageToken'),'next');assert.equal(url.searchParams.get('pageSize'),'60');return Response.json({files:[{id:fileId,name:'photo.jpg',mimeType:'image/jpeg',size:'3'},{id:'oversize_123456',mimeType:'image/jpeg',size:String(MAX_COVER_BYTES+1)},{id:'svg_1234567890',mimeType:'image/svg+xml',size:'3'}],nextPageToken:'page2'});});
  const data=await(await listCoverImages(env,'alice',id,new URLSearchParams({search:"bob's",pageToken:'next'}),load)).json();assert.equal(data.files.length,1);assert.equal(data.nextPageToken,'page2');
  await assert.rejects(listCoverImages(env,'bob',id,new URLSearchParams(),load));
  await assert.rejects(listCoverImages(env,'alice',id,new URLSearchParams({pageToken:'bad token'}),load));
 }finally{db.close();}
});
test('cover image validates file type/bytes and rejects other accounts, redirects and disconnects',async()=>{
 const {env,db,fetcher}=await setup();try{
  const load=fetcher(url=>url.searchParams.get('alt')==='media'?new Response(new Uint8Array([1,2,3]),{headers:{'Content-Type':'image/jpeg'}}):Response.json({id:fileId,mimeType:'image/jpeg',size:'3',imageMediaMetadata:{width:100,height:100}}));
  const result=await coverImage(env,'alice',id,fileId,load);assert.equal(result.headers.get('Cache-Control'),'private, no-store');assert.equal((await result.arrayBuffer()).byteLength,3);
  await assert.rejects(coverImage(env,'bob',id,fileId,load));
  for(const info of [{mimeType:'image/svg+xml',size:'3'},{mimeType:'video/mp4',size:'3'},{mimeType:'image/jpeg',size:String(MAX_COVER_BYTES+1)},{mimeType:'image/jpeg',size:'3',trashed:true},{mimeType:'image/jpeg',size:'3',imageMediaMetadata:{width:10000,height:10000}}])await assert.rejects(coverImage(env,'alice',id,fileId,fetcher(()=>Response.json(info))));
  await assert.rejects(coverImage(env,'alice',id,fileId,fetcher(url=>url.searchParams.get('alt')==='media'?new Response('bad',{status:302,headers:{Location:'https://evil.test'}}):Response.json({mimeType:'image/jpeg',size:'3'}))));
  await assert.rejects(coverImage(env,'alice',id,fileId,fetcher(url=>url.searchParams.get('alt')==='media'?new Response(new Uint8Array([1,2]),{headers:{'Content-Type':'image/jpeg'}}):Response.json({mimeType:'image/jpeg',size:'3'}))));
  db.sql.prepare("UPDATE drive_connections SET status='reconnect_required'").run();await assert.rejects(coverImage(env,'alice',id,fileId,load));
 }finally{db.close();}
});

import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import {handle} from '../src/index.ts';
test('cover HTTP routes require a signed identity, active entitlement and connection ownership',async()=>{
 const {env,db,fetcher}=await setup();const original=globalThis.fetch;
 try{
  Object.assign(env,{FIREBASE_PROJECT_ID:'roteiva-web-dev',ENVIRONMENT:'dev',OAUTH_ENABLED:'true',FRONTEND_ORIGIN:'https://roteiva-web-dev.web.app',OAUTH_REDIRECT_URI:'https://roteiva-api-dev.ewertonmendes9.workers.dev/oauth/drive/callback',API_RATE_LIMIT:{limit:async()=>({success:true})},API_THUMB_LIMIT:{limit:async()=>({success:true})}});
  const {privateKey,publicKey}=await generateKeyPair('RS256'),jwk=await exportJWK(publicKey);jwk.kid='cover-test';const now=Math.floor(Date.now()/1000);
  const jwt=sub=>new SignJWT({auth_time:now}).setProtectedHeader({alg:'RS256',kid:'cover-test'}).setAudience(env.FIREBASE_PROJECT_ID).setIssuer('https://securetoken.google.com/'+env.FIREBASE_PROJECT_ID).setSubject(sub).setIssuedAt(now).setExpirationTime(now+300).sign(privateKey);
  const alice=await jwt('alice'),bob=await jwt('bob');
  globalThis.fetch=async(url,init)=>String(url).includes('/service_accounts/v1/jwk/')?Response.json({keys:[jwk]}):fetcher(u=>u.searchParams.get('alt')==='media'?new Response(new Uint8Array([1,2,3]),{headers:{'Content-Type':'image/jpeg'}}):u.pathname.endsWith('/files')?Response.json({files:[]}):Response.json({mimeType:'image/jpeg',size:'3'}))(url,init);
  const send=(path,token)=>handle(new Request('https://api.example/integrations/drive/'+id+path,{headers:{Authorization:'Bearer '+token,Origin:env.FRONTEND_ORIGIN}}),env);
  for(const path of ['/cover-images','/files/'+fileId+'/cover']){
   assert.equal((await send(path,'invalid')).status,401);assert.equal((await send(path,alice)).status,403);
  }
  const started=Date.now();for(const uid of ['alice','bob'])db.sql.prepare('INSERT INTO access_accounts(owner_uid,trial_started_at,trial_ends_at,created_at,updated_at) VALUES(?,?,?,?,?)').run(uid,started,started+604800000,started,started);
  for(const path of ['/cover-images','/files/'+fileId+'/cover']){assert.equal((await send(path,bob)).status,404);assert.equal((await send(path,alice)).status,200);}
  db.sql.exec("UPDATE access_accounts SET suspended_at=1 WHERE owner_uid='alice'");assert.equal((await send('/cover-images',alice)).status,403);
 }finally{globalThis.fetch=original;db.close();}
});


test('client image picker includes Drive folders, scopes to parent and skips empty image-only pages',async()=>{
 const {env,db,fetcher}=await setup();
 try{
  let calls=0;
  const load=fetcher(url=>{
   calls++;
   assert.match(url.searchParams.get('q'),/trashed = false/);
   assert.match(url.searchParams.get('q'),/'root' in parents/);
   assert.match(url.searchParams.get('q'),/application\\/vnd.google-apps.folder/);
   if(calls===1)return Response.json({files:[{id:'oversize_123456',mimeType:'image/jpeg',name:'oversize.jpg',size:String(MAX_COVER_BYTES+1)}],nextPageToken:'next-page'});
   assert.equal(url.searchParams.get('pageToken'),'next-page');
   return Response.json({files:[
    {id:'folder_123456789',mimeType:'application/vnd.google-apps.folder',name:'Fotografias'},
    {id:'image_987654321',mimeType:'image/png',name:'Retrato',size:'3000'}
   ],nextPageToken:null});
  });
  const result=await(await listCoverImages(env,'alice',id,new URLSearchParams(),load)).json();
  assert.equal(calls,2);
  assert.deepEqual(result.files.map(x=>x.name),['Fotografias','Retrato']);
  assert.equal(result.nextPageToken,null);
  assert.equal(result.files[0].thumbnailTicket,undefined);
  const sub=await(await listCoverImages(env,'alice',id,new URLSearchParams({parentId:'folder_123456789',search:''}),
   fetcher(url=>{assert.match(url.searchParams.get('q'),/'folder_123456789' in parents/);return Response.json({files:[]});}))).json();
  assert.deepEqual(sub.files,[]);
  await assert.rejects(listCoverImages(env,'alice',id,new URLSearchParams({parentId:'../invalid'}),load));
 }finally{db.close();}
});
