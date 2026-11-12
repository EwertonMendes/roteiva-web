import test from 'node:test';
import assert from 'node:assert/strict';
import {database} from './helpers/database.mjs';
import {base64url,context,encrypt} from '../src/crypto.ts';
import {importLibraryAssets} from '../src/library-assets.ts';
import {libraryContent} from '../src/library-content.ts';
import {disconnect} from '../src/drive.ts';
const connection='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',file='SHARED_FILE_12345',resourceKey='0-synthetic-resource-key';
test('link-shared selected files retain an encrypted resource key, reuse it only for the owner, and clear it on disconnect',async t=>{
 const env={VIRTUAL_LIBRARY_ENABLED:'true',ENVIRONMENT:'dev',TOKEN_KEY_VERSION:'v1',TOKEN_KEYS:JSON.stringify({v1:base64url(crypto.getRandomValues(new Uint8Array(32)))}),GOOGLE_CLIENT_ID:'test',GOOGLE_CLIENT_SECRET:'test'};
 const f=database({id:connection,owner_uid:'alice',google_account_id:'google-alice',revision:1,status:'connected',scopes:'https://www.googleapis.com/auth/drive.file',encrypted_refresh_token:await encrypt(env,'refresh',context(env,'alice','google-alice'))});t.after(f.close);env.DB=f.DB;
 let reads=0;
 const fetcher=async(url,options)=>{
  const u=new URL(url);
  if(u.hostname==='oauth2.googleapis.com')return Response.json({access_token:'test-token',token_type:'Bearer',expires_in:3600});
  reads++;assert.equal(options.headers['X-Goog-Drive-Resource-Keys'],file+'/'+resourceKey);assert.equal(options.redirect,'manual');
  if(u.searchParams.get('alt')==='media')return new Response('test',{status:206,headers:{'Content-Range':'bytes 0-3/4'}});
  return Response.json({id:file,name:'Shared.png',mimeType:'image/png',size:'4',headRevisionId:'v1',isAppAuthorized:true,resourceKey,capabilities:{canDownload:true}});
 };
 const input={parentId:'root',items:[{provider:'google_drive',connectionId:connection,fileId:file,resourceKey}]};
 const response=await (await importLibraryAssets(env,'alice',17,input,fetcher)).json();assert.equal(response.results[0].status,'added');
 const retained=f.sql.prepare('SELECT * FROM drive_resource_keys').get();assert.equal(JSON.stringify(retained).includes(resourceKey),false);
 const content=await libraryContent(new Request('https://api.example/media'),env,'alice',17,response.results[0].id,fetcher);assert.equal(await content.text(),'test');
 const before=reads;
 const denied=await (await importLibraryAssets(env,'bob',17,input,fetcher)).json();assert.equal(denied.results[0].status,'failed');assert.equal(reads,before);
 await assert.rejects(importLibraryAssets(env,'alice',17,{...input,items:[{...input.items[0],resourceKey:'bad\r\nheader'}]},fetcher),e=>e.code==='invalid_library_asset');
 await disconnect(env,'alice',connection,async()=>new Response(null,{status:200}));
 assert.equal(f.sql.prepare('SELECT count(*) n FROM drive_resource_keys').get().n,0);
});
