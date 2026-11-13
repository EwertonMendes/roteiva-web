import test from 'node:test';
import assert from 'node:assert/strict';
import {database} from './helpers/database.mjs';
import {encrypt,context,base64url} from '../src/crypto.ts';
import {importLibraryAssets} from '../src/library-assets.ts';
import {libraryContent} from '../src/library-content.ts';
import {libraryFor,mutateLibrary} from '../src/library.ts';
const conn='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',fileId='FILE_123456789';
async function fixture(t){
 const env={ENVIRONMENT:'dev',TOKEN_KEY_VERSION:'v1',TOKEN_KEYS:JSON.stringify({v1:base64url(crypto.getRandomValues(new Uint8Array(32)))}),GOOGLE_CLIENT_ID:'test',GOOGLE_CLIENT_SECRET:'test'};
 const f=database({id:conn,owner_uid:'alice',google_account_id:'alice-google',status:'connected',revision:1,scopes:'https://www.googleapis.com/auth/drive.file',encrypted_refresh_token:await encrypt(env,'refresh',context(env,'alice','alice-google'))});env.DB=f.DB;t.after(f.close);
 const state={missing:false,download:true,body:'test',total:'4',streams:0,fullStatus:206};
 const fetcher=async(url,options)=>{
 if(String(url).startsWith('https://oauth2.googleapis.com/token'))return Response.json({access_token:'mock',token_type:'Bearer',expires_in:3600});
 if(new URL(url).searchParams.get('alt')==='media'){
 state.streams++;assert.equal(options.redirect,'manual');assert.equal(options.headers.Range,'bytes=0-3');
 return new Response(state.body,{status:state.fullStatus,headers:state.fullStatus===200?{'Content-Length':state.total}:{'Content-Range':'bytes 0-3/'+state.total}});
 }
 if(state.missing)return new Response(null,{status:404});
 return Response.json({id:fileId,name:'photo.jpg',mimeType:'image/jpeg',size:'4',headRevisionId:'v1',isAppAuthorized:true,capabilities:{canDownload:state.download}});
 };
 const imported=await (await importLibraryAssets(env,'alice',17,{parentId:'root',items:[{provider:'google_drive',connectionId:conn,fileId}]},fetcher)).json();
 return {...f,env,state,fetcher,id:imported.results[0].id};
}
test('owner preview checks resource each time and streams bounded content without redirect credentials',async t=>{
 const {env,id,fetcher,state,sql}=await fixture(t);
 const response=await libraryContent(new Request('https://api.example/content'),env,'alice',17,id,fetcher);
 assert.equal(response.status,200);assert.equal(await response.text(),'test');assert.equal(response.headers.get('Content-Length'),'4');
 const r=await libraryContent(new Request('https://api.example/content',{headers:{Range:'bytes=0-3'}}),env,'alice',17,id,fetcher);
 assert.equal(r.status,206);assert.equal(await r.text(),'test');
 state.missing=true;
 await assert.rejects(libraryContent(new Request('https://api.example/content'),env,'alice',17,id,fetcher),e=>e.code==='source_unavailable');
 assert.equal(sql.prepare('SELECT state FROM library_assets').get().state,'unavailable');
 const count=state.streams;
 await assert.rejects(libraryContent(new Request('https://api.example/content'),env,'bob',17,id,fetcher),e=>e.status===404);
 assert.equal(state.streams,count);
});
test('download restrictions, mismatched ranges, oversized bodies and revoked references fail closed',async t=>{
 const {env,id,fetcher,state}=await fixture(t),request=new Request('https://api.example/content');
 state.download=false;await assert.rejects(libraryContent(request,env,'alice',17,id,fetcher),e=>e.code==='source_restricted');assert.equal(state.streams,0);
 state.download=true;state.total='5';await assert.rejects(libraryContent(request,env,'alice',17,id,fetcher),e=>e.code==='media_range_unsupported');
 state.total='4';state.body='oversized';const response=await libraryContent(request,env,'alice',17,id,fetcher);await assert.rejects(response.text());
 const lib=await libraryFor(env,'alice',17);await mutateLibrary(env,lib,id,{action:'trash',revision:1});
 await assert.rejects(libraryContent(request,env,'alice',17,id,fetcher),e=>e.status===404);
});

test('image previews accept exactly sized complete 200 responses but reject partial clients and wrong sizes',async t=>{
 const {env,id,fetcher,state}=await fixture(t);
 state.fullStatus=200;
 const response=await libraryContent(new Request('https://api.example/content'),env,'alice',17,id,fetcher);
 assert.equal(response.status,200);assert.equal(response.headers.get('Content-Length'),'4');
 assert.equal(await response.text(),'test');
 await assert.rejects(
  libraryContent(new Request('https://api.example/content',{headers:{Range:'bytes=0-3'}}),env,'alice',17,id,fetcher),
  e=>e.code==='media_range_unsupported'
 );
 state.total='5';
 await assert.rejects(libraryContent(new Request('https://api.example/content'),env,'alice',17,id,fetcher),e=>e.code==='media_range_unsupported');
});
