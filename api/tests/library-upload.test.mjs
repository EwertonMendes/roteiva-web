import test from 'node:test';
import assert from 'node:assert/strict';
import {database} from './helpers/database.mjs';
import {encrypt,context,base64url} from '../src/crypto.ts';
import {prepareLibraryUploadTarget,authorizeVirtualUpload} from '../src/library-upload-target.ts';
import {libraryFor,mutateLibrary} from '../src/library.ts';
import {startUpload,completeUpload} from '../src/uploads.ts';
const account='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',folder='MANAGED_FOLDER_12345',file='UPLOAD_FILE_12345';
const request=body=>new Request('https://api.example/library/projects/17/uploads/destination',{method:'POST',headers:{Authorization:'Bearer caller','Content-Type':'application/json'},body:JSON.stringify(body)});
async function fixture(t){
 const env={VIRTUAL_LIBRARY_ENABLED:'true',ENVIRONMENT:'dev',FIREBASE_PROJECT_ID:'demo-roteiva',FRONTEND_ORIGIN:'https://roteiva-web-dev.web.app',GOOGLE_CLIENT_ID:'test',GOOGLE_CLIENT_SECRET:'test',TOKEN_KEY_VERSION:'v1',TOKEN_KEYS:JSON.stringify({v1:base64url(crypto.getRandomValues(new Uint8Array(32)))})};
 const f=database({id:account,owner_uid:'alice',google_account_id:'google-alice',status:'connected',revision:1,scopes:'https://www.googleapis.com/auth/drive.file',encrypted_refresh_token:await encrypt(env,'refresh',context(env,'alice','google-alice'))});t.after(f.close);env.DB=f.DB;
 const state={exists:false,created:[],generated:0,project:true,uploaded:false};
 const fetcher=async(url,options)=>{
  const u=new URL(url);
  if(u.hostname==='firestore.googleapis.com'){assert.equal(options.headers.Authorization,'Bearer caller');assert.match(u.pathname,/\/projects\/17$/);return state.project?Response.json({fields:{ownerUid:{stringValue:'alice'}}}):new Response(null,{status:404});}
  if(u.hostname==='oauth2.googleapis.com')return Response.json({access_token:'test-token',token_type:'Bearer',expires_in:3600});
  if(u.pathname.endsWith('generateIds')){state.generated++;return Response.json({ids:[state.generated===1?folder:file]});}
  if(u.pathname==='/drive/v3/files'&&options.method==='POST'){
   const body=JSON.parse(options.body);assert.equal(body.id,folder);state.created.push(body.id);state.exists=true;return Response.json({id:folder});
  }
  if(u.pathname.endsWith('/'+folder))return state.exists?Response.json({id:folder,mimeType:'application/vnd.google-apps.folder',isAppAuthorized:true,capabilities:{canAddChildren:true}}):new Response(null,{status:404});
  if(u.pathname.startsWith('/upload/')){
   const body=JSON.parse(options.body);assert.deepEqual(body.parents,[folder]);assert.equal(body.id,file);state.uploaded=true;
   return new Response(null,{status:200,headers:{Location:'https://www.googleapis.com/upload/drive/v3/files?upload_id=synthetic'}});
  }
  if(u.pathname.endsWith('/'+file))return Response.json({id:file,name:'photo.png',mimeType:'image/png',size:'4',parents:[folder],isAppAuthorized:true,headRevisionId:'v1',capabilities:{canDownload:true}});
  throw new Error('Unexpected provider operation');
 };
 return {...f,env,state,fetcher};
}
test('managed upload destination is reused; arbitrary project, node, account and destination are denied',async t=>{
 const {env,state,fetcher}=await fixture(t),input={provider:'google_drive',connectionId:account,nodeId:'root'};
 const prepared=await (await prepareLibraryUploadTarget(request(input),env,'alice',17,input,fetcher)).json();
 assert.equal(prepared.targetFolderId,folder);assert.equal(state.created.length,1);
 await prepareLibraryUploadTarget(request(input),env,'alice',17,input,fetcher);assert.equal(state.created.length,1);
 await assert.rejects(authorizeVirtualUpload(request({}),env,'alice','google_drive',account,17,'root','OTHER_FOLDER_1234',fetcher),e=>e.code==='library_upload_target_denied');
 const library=await libraryFor(env,'alice',17),node=await (await mutateLibrary(env,library,null,{name:'Videos'})).json();
 await mutateLibrary(env,library,node.id,{action:'trash',revision:1});
 await assert.rejects(authorizeVirtualUpload(request({}),env,'alice','google_drive',account,17,node.id,folder,fetcher),e=>e.status===404);
 state.project=false;await assert.rejects(prepareLibraryUploadTarget(request(input),env,'alice',17,input,fetcher),e=>e.code==='library_project_denied');
 assert.equal(state.created.length,1);
});
test('virtual direct Drive upload confirms source before registering exactly one reference; retry is idempotent',async t=>{
 const {env,state,fetcher,sql}=await fixture(t),input={provider:'google_drive',connectionId:account,nodeId:'root'};
 await prepareLibraryUploadTarget(request(input),env,'alice',17,input,fetcher);
 const metadata={attemptId:crypto.randomUUID(),projectId:17,linkedFolderId:'root',name:'photo.png',size:4,mimeType:'image/png'};
 const session=await startUpload(env,'alice',account,folder,request(metadata),fetcher);assert.equal(session.status,200);assert.equal(state.uploaded,true);
 assert.equal(sql.prepare('SELECT count(*) n FROM library_assets').get().n,0);
 const complete={...metadata,fileId:file};
 await completeUpload(env,'alice',account,folder,request(complete),fetcher);
 await completeUpload(env,'alice',account,folder,request(complete),fetcher);
 assert.equal(sql.prepare('SELECT count(*) n FROM library_assets').get().n,1);
 assert.equal(sql.prepare('SELECT count(*) n FROM library_entries').get().n,1);
 assert.equal(sql.prepare('SELECT status FROM drive_upload_attempts').get().status,'completed');
});
