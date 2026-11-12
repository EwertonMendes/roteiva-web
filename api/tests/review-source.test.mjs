import test from 'node:test';
import assert from 'node:assert/strict';
import {database} from './helpers/database.mjs';
import {encrypt,context,base64url} from '../src/crypto.ts';
import {readPublishedSource} from '../src/review-source.ts';

const connection='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',file='FILE_123456789';
async function fixture(t){
 const env={ENVIRONMENT:'dev',TOKEN_KEY_VERSION:'v1',TOKEN_KEYS:JSON.stringify({v1:base64url(crypto.getRandomValues(new Uint8Array(32)))}),GOOGLE_CLIENT_ID:'test',GOOGLE_CLIENT_SECRET:'test'};
 const db=database({id:connection,owner_uid:'alice',google_account_id:'alice-google',status:'connected',revision:1,scopes:'https://www.googleapis.com/auth/drive.file',encrypted_refresh_token:await encrypt(env,'refresh',context(env,'alice','alice-google'))});
 env.DB=db.DB;t.after(db.close);
 const state={head:'v2',missing:false,mediaStatus:206,total:'4',body:'test',reads:0};
 const fetcher=async(url,options)=>{
  const u=new URL(url);
  if(u.hostname==='oauth2.googleapis.com')return Response.json({access_token:'mock',token_type:'Bearer',expires_in:3600});
  if(u.searchParams.get('alt')==='media'){
   state.reads++;assert.equal(u.pathname,'/drive/v3/files/'+file+'/revisions/v1');
   assert.equal(options.redirect,'manual');
   const end=options.headers.Range==='bytes=0-0'?0:3;
   return new Response(state.body.slice(0,end+1),{status:state.mediaStatus,headers:{'Content-Range':'bytes 0-'+end+'/'+state.total}});
  }
  if(state.missing)return new Response(null,{status:404});
  return Response.json({id:file,name:'changed.jpg',mimeType:'image/jpeg',size:'9',headRevisionId:state.head,isAppAuthorized:true,capabilities:{canDownload:true}});
 };
 return {env,state,fetcher,asset:{provider:'google_drive',connection_id:connection,file_id:file,mime_type:'image/jpeg',source_revision:'v1',source_size:'4'}};
}
test('published bytes remain at the selected revision even after live source changes; HEAD/probe cancel safely',async t=>{
 const {env,state,fetcher,asset}=await fixture(t);
 const response=await readPublishedSource(new Request('https://api.example/media'),env,'alice',asset,false,fetcher);
 assert.equal(await response.text(),'test');assert.equal(response.status,200);
 const head=await readPublishedSource(new Request('https://api.example/media',{method:'HEAD'}),env,'alice',asset,false,fetcher);
 assert.equal(head.status,200);assert.equal(head.headers.get('Content-Length'),'4');assert.equal(await head.text(),'');
 assert.equal((await readPublishedSource(new Request('https://api.example/media'),env,'alice',asset,true,fetcher)).status,204);
 assert.equal(state.reads,3);
});
test('missing source, purged revision and inconsistent range never fall back to mutable head',async t=>{
 const {env,state,fetcher,asset}=await fixture(t),request=new Request('https://api.example/media');
 state.missing=true;await assert.rejects(readPublishedSource(request,env,'alice',asset,false,fetcher),e=>e.code==='source_unavailable');assert.equal(state.reads,0);
 state.missing=false;state.mediaStatus=404;
 await assert.rejects(readPublishedSource(request,env,'alice',asset,false,fetcher),e=>e.code==='review_source_revision_unavailable');
 state.mediaStatus=206;state.total='9';
 await assert.rejects(readPublishedSource(request,env,'alice',asset,false,fetcher),e=>e.code==='media_range_unsupported');
 await assert.rejects(readPublishedSource(request,env,'alice',{...asset,source_revision:null},false,fetcher),e=>e.code==='review_source_version_unsupported');
 assert.equal(state.reads,2);
});
