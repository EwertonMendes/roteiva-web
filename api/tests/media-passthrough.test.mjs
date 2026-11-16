import test from 'node:test';
import assert from 'node:assert/strict';
import {database} from './helpers/database.mjs';
import {encrypt,context,base64url} from '../src/crypto.ts';
import {importLibraryAssets} from '../src/library-assets.ts';
import {libraryContent} from '../src/library-content.ts';

const conn='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const fileId='FILE_123456789',total=400*1024*1024;
const path='https://api.example/library/projects/17/nodes/video/content';

async function fixture(t){
 const env={ENVIRONMENT:'dev',TOKEN_KEY_VERSION:'v1',TOKEN_KEYS:JSON.stringify({v1:base64url(crypto.getRandomValues(new Uint8Array(32)))}),GOOGLE_CLIENT_ID:'test',GOOGLE_CLIENT_SECRET:'test'};
 const row={id:conn,owner_uid:'alice',google_account_id:'alice-google',status:'connected',revision:1,scopes:'https://www.googleapis.com/auth/drive.file',
  encrypted_refresh_token:await encrypt(env,'refresh',context(env,'alice','alice-google'))};
 const f=database(row);env.DB=f.DB;t.after(f.close);
 const state={lastRange:null,contentLength:String(total),contentRange:null,body:null,requestCount:0,providedResponse:null};
 const fetcher=async(url,options)=>{
  if(String(url).startsWith('https://oauth2.googleapis.com/token'))return Response.json({access_token:'mock',token_type:'Bearer',expires_in:3600});
  if(new URL(url).searchParams.get('alt')==='media'){
   state.requestCount++;state.lastRange=options.headers.Range;
   const range=/^bytes=(\d+)-(\d+)$/.exec(state.lastRange);
   assert.ok(range);
   const requestedLength=Number(range[2])-Number(range[1])+1;
   const response=new Response(state.body||new Uint8Array([3,5,7]),{status:206,headers:{
    'Content-Range':state.contentRange||'bytes '+range[1]+'-'+range[2]+'/'+total,
    'Content-Length':state.contentLength??String(requestedLength),
    'Content-Type':'video/mp4',
   }});
   state.providedResponse=response;return response;
  }
  return Response.json({id:fileId,name:'demo.mp4',mimeType:'video/mp4',size:String(total),
   headRevisionId:'rev1',isAppAuthorized:true,capabilities:{canDownload:true}});
 };
 const imported=await (await importLibraryAssets(env,'alice',17,{parentId:'root',items:[{provider:'google_drive',connectionId:conn,fileId}]},fetcher)).json();
 return {env,state,fetcher,id:imported.results[0].id};
}

test('large private MP4 is passed through without JS reader, transform, clone or whole-body buffering',async t=>{
 const {env,state,fetcher,id}=await fixture(t);
 const starter=new Uint8Array(65536).fill(7);
 const upstream=new ReadableStream({
  start(controller){controller.enqueue(starter);},
  pull(){return new Promise(()=>{});}
 });
 state.body=upstream;
 const response=await libraryContent(new Request(path,{headers:{Range:'bytes=0-'}}),env,'alice',17,id,fetcher);
 assert.equal(response.status,206);
 assert.equal(state.lastRange,'bytes=0-'+(total-1));
 assert.equal(state.requestCount,1,'must make exactly one provider data request');
 assert.equal(response.headers.get('Content-Range'),'bytes 0-'+(total-1)+'/'+total);
 assert.equal(response.headers.get('Content-Length'),String(total));
 assert.equal(response.headers.get('X-Roteiva-Media-Transport'),'origin-pass-through');
 assert.strictEqual(response.body,state.providedResponse.body,'must preserve the exact provider ReadableStream identity');
 const reader=response.body.getReader();
 const first=await reader.read();
 assert.equal(first.value.byteLength,65536,'must expose early bytes without waiting for the rest of the file');
 await reader.cancel();
});

test('seeking forwards exactly the browser byte range without intermediate chunk requests',async t=>{
 const {env,state,fetcher,id}=await fixture(t);
 const start=90*1024*1024,end=start+1024*1024-1;
 state.contentLength=String(end-start+1);
 const response=await libraryContent(new Request(path,{headers:{Range:'bytes='+start+'-'+end}}),env,'alice',17,id,fetcher);
 assert.equal(state.lastRange,'bytes='+start+'-'+end);
 assert.equal(state.requestCount,1);
 assert.equal(response.status,206);
 assert.equal(response.headers.get('Content-Range'),'bytes '+start+'-'+end+'/'+total);
 await response.body.cancel();
});

test('invalid provider ranges or inconsistent lengths are rejected before video bytes reach Chrome',async t=>{
 const {env,state,fetcher,id}=await fixture(t);
 state.contentRange='bytes 1-'+(total-1)+'/'+total;
 await assert.rejects(libraryContent(new Request(path,{headers:{Range:'bytes=0-'}}),env,'alice',17,id,fetcher),e=>e.code==='media_range_unsupported');
 state.contentRange=null;state.contentLength='10';
 await assert.rejects(libraryContent(new Request(path,{headers:{Range:'bytes=0-'}}),env,'alice',17,id,fetcher),e=>e.code==='media_range_unsupported');
});

test('HEAD closes upstream body and returns valid headers without attempting byte processing',async t=>{
 const {env,state,fetcher,id}=await fixture(t);
 const response=await libraryContent(new Request(path,{method:'HEAD',headers:{Range:'bytes=0-'}}),env,'alice',17,id,fetcher);
 assert.equal(response.status,206);
 assert.equal(response.body,null);
 assert.equal(state.requestCount,1);
});
