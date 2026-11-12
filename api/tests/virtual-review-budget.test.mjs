import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import {database} from './helpers/database.mjs';
import {base64url,encrypt,context,random,hash} from '../src/crypto.ts';
import {reviewManifestHash} from '../src/review-manifest.ts';
import {handle} from '../src/index.ts';
import {libraryFor,mutateLibrary} from '../src/library-core.ts';
import {reviewLibrarySelection} from '../src/review-library-selection.ts';
import {createLibraryStructure} from '../src/library-structure.ts';

async function fixture(t){
 const db=database();t.after(db.close);
 let used=0;const count=()=>{assert.ok(++used<=50,'D1 Free invocation limit exceeded: '+used);};
 const metered={batch:async statements=>{count();return db.DB.batch(statements);},prepare(query){
  const wrap=statement=>new Proxy(statement,{get(target,key){
   if(key==='bind')return(...args)=>wrap(target.bind(...args));
   if(['first','all','run'].includes(key))return(...args)=>{count();return target[key](...args);};
   return target[key];
  }});return wrap(db.DB.prepare(query));
 }};
 const env={DB:metered,ENVIRONMENT:'dev',VIRTUAL_LIBRARY_ENABLED:'true',FIREBASE_PROJECT_ID:'roteiva-web-dev',
 FRONTEND_ORIGIN:'https://roteiva-web-dev.web.app',OAUTH_REDIRECT_URI:'https://roteiva-api-dev.roteiva-dev.workers.dev/oauth/drive/callback',
 TOKEN_KEY_VERSION:'v1',TOKEN_KEYS:JSON.stringify({v1:base64url(crypto.getRandomValues(new Uint8Array(32)))}),
 GOOGLE_CLIENT_ID:'mock-client',GOOGLE_CLIENT_SECRET:'mock-secret',
 API_RATE_LIMIT:{limit:async()=>({success:true})},API_THUMB_LIMIT:{limit:async()=>({success:true})},API_UPLOAD_LIMIT:{limit:async()=>({success:true})}};
 const now=Date.now();db.sql.prepare('INSERT INTO access_accounts(owner_uid,trial_started_at,trial_ends_at,created_at,updated_at) VALUES(?,?,?,?,?)').run('alice',now,now+604800000,now,now);
 const lib=await libraryFor({...env,DB:db.DB},'alice',17),selections=[];
 for(let i=0;i<8;i++){
  const conn=crypto.randomUUID(),account='google-'+i,node=crypto.randomUUID(),asset=crypto.randomUUID(),file='FILE_BUDGET_123456_'+i;
  db.sql.prepare('INSERT INTO drive_connections(id,owner_uid,google_account_id,google_email,encrypted_refresh_token,status,scopes,revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(conn,'alice',account,'mock@example.com',await encrypt(env,'refresh',context(env,'alice',account)),'connected','https://www.googleapis.com/auth/drive.file',1,now,now);
  db.sql.prepare("INSERT INTO library_assets(library_id,id,provider,connection_id,file_id,source_name,mime_type,size,source_revision,observed_at,state) VALUES(?,?,'google_drive',?,?,'Cut.mp4','video/mp4','4','rev1',?,'available')").run(lib.id,asset,conn,file,now);
  db.sql.prepare("INSERT INTO library_nodes(library_id,id,parent_id,kind,name,asset_id) VALUES(?,?,'root','asset','Cut.mp4',?)").run(lib.id,node,asset);
  db.sql.prepare('INSERT INTO library_entries(library_id,node_id,asset_id) VALUES(?,?,?)').run(lib.id,node,asset);
  selections.push({libraryNodeId:node,file,conn});
 }
 const pair=await generateKeyPair('RS256'),jwk=await exportJWK(pair.publicKey);jwk.kid='budget';
 const iat=Math.floor(now/1000),jwt=await new SignJWT({auth_time:iat}).setProtectedHeader({alg:'RS256',kid:'budget'}).setAudience(env.FIREBASE_PROJECT_ID).setIssuer('https://securetoken.google.com/'+env.FIREBASE_PROJECT_ID).setSubject('alice').setIssuedAt(iat).setExpirationTime(iat+600).sign(pair.privateKey);
 const hooks={missing:null,changed:false},previous=globalThis.fetch;t.after(()=>{globalThis.fetch=previous;});
 globalThis.fetch=async(url,init={})=>{
  const u=new URL(url);
  if(u.pathname.includes('/service_accounts/v1/jwk/'))return Response.json({keys:[jwk]});
  if(u.hostname==='firestore.googleapis.com')return Response.json({fields:{ownerUid:{stringValue:'alice'},clientId:{integerValue:'7'},name:{stringValue:'Fixture'}}});
  if(u.hostname==='oauth2.googleapis.com')return Response.json({access_token:'mock',token_type:'Bearer',expires_in:3600});
  assert.equal(u.hostname,'www.googleapis.com');
  const file=/\/files\/([^/]+)/.exec(u.pathname)?.[1];
  if(hooks.missing===file)return Response.json({error:{}},{status:404});
  if(u.pathname.includes('/revisions/'))return new Response(new Uint8Array([1]),{status:206,headers:{'Content-Range':'bytes 0-0/4'}});
  return Response.json({id:file,name:'Cut.mp4',mimeType:'video/mp4',size:'4',headRevisionId:hooks.changed?'rev2':'rev1',resourceKey:'resource-key',isAppAuthorized:true,trashed:false,capabilities:{canDownload:true}});
 };
 const call=async(path,body,session,auth=true)=>{
  used=0;
  if(path.startsWith('/reviews/public/')&&body?.version){
    const rows=db.sql.prepare('SELECT * FROM review_assets WHERE version=? ORDER BY file_id').all(body.version);
    body={manifestHash:await reviewManifestHash(rows),...body};
  }
  const response=await handle(new Request('https://roteiva-api-dev.roteiva-dev.workers.dev'+path,{method:body===undefined?'GET':'POST',headers:{Origin:env.FRONTEND_ORIGIN,...(auth?{Authorization:'Bearer '+jwt}:{}),...(session?{'X-Review-Session':session}:{}),'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})}),env);
  const data=await response.json();assert.notEqual(response.status,500,JSON.stringify(data));
  return {response,data,used};
 };
 return {...db,env,lib,selections,hooks,call,get used(){return used;},reset(){used=0;}};
}

test('eight cold accounts create/publish/revise/close within D1 Free, with bounded source probes',async t=>{
 const f=await fixture(t);
 const created=await f.call('/reviews',{clientId:7,projectId:17,studioName:'Fixture',title:'Eight',message:'',mode:'link',expiresInDays:7,assets:f.selections.map(x=>({libraryNodeId:x.libraryNodeId}))});
 assert.equal(created.response.status,201,JSON.stringify(created.data));assert.ok(created.used<=47,created.used);
 const id=created.data.id;
 let published;for(let i=0;i<4;i++){
  published=await f.call('/reviews/'+id+'/publish',{});
  assert.equal(published.response.status,i===3?200:202,JSON.stringify(published.data));assert.ok(published.used<45,published.used);
 }
 const token=new URL(published.data.review.review.url).hash.slice('#invite='.length);
 const sessionReq=new Request('https://roteiva-api-dev.roteiva-dev.workers.dev/reviews/public/session',{method:'POST',headers:{Origin:f.env.FRONTEND_ORIGIN,'X-Review-Token':token}});
 f.reset();const session=await (await handle(sessionReq,f.env)).json();assert.ok(session.session);
 const before=await f.call('/reviews/public/decide',{version:1,authorName:'Client',decision:'approved'},session.session,false);
 assert.equal(before.data.error.code,'review_decision_check_required');
 let proof;
 for(let i=0;i<4;i++){
  const result=await f.call('/reviews/public/decision-check',{version:1,proof},session.session,false);
  assert.equal(result.response.status,200,JSON.stringify(result.data));assert.equal(result.data.ready,i===3);assert.ok(result.used<35,result.used);proof=result.data.proof;
  if(i===0){const premature=await f.call('/reviews/public/decide',{version:1,authorName:'Client',decision:'approved',proof},session.session,false);assert.equal(premature.data.error.code,'review_decision_check_required');}
 }
 const comment={version:1,authorName:'Client',fileId:f.selections[0].file,body:'Check frame',idempotencyKey:crypto.randomUUID()};
 const wrongManifest=await f.call('/reviews/public/comment',{...comment,manifestHash:'stale'},session.session,false);assert.equal(wrongManifest.data.error.code,'review_manifest_changed');
 for(let i=0;i<2;i++)assert.equal((await f.call('/reviews/public/comment',comment,session.session,false)).response.status,200);
 assert.equal(f.sql.prepare('SELECT count(*) n FROM review_comments').get().n,1);
 const changedComment=await f.call('/reviews/public/comment',{...comment,body:'Different'},session.session,false);assert.equal(changedComment.response.status,409);
 const decision=await f.call('/reviews/public/decide',{version:1,authorName:'Client',decision:'changes',message:'Next',proof},session.session,false);
 assert.equal(decision.response.status,200,JSON.stringify(decision.data));
 f.sql.prepare('UPDATE drive_connections SET encrypted_access_token=NULL,access_token_expires_at=0').run();
 const revised=await f.call('/reviews/'+id+'/revise',{assets:f.selections.map(x=>({libraryNodeId:x.libraryNodeId}))});
 assert.equal(revised.response.status,202,JSON.stringify(revised.data));assert.equal(revised.data.review.review.version,2);assert.ok(revised.used<=49,revised.used);
 const closed=await f.call('/reviews/'+id+'/close',{});assert.equal(closed.response.status,200);assert.ok(closed.used<15,closed.used);
 assert.equal(f.sql.prepare("SELECT count(*) n FROM review_assets WHERE grant_state!='revoked'").get().n,0);
 f.sql.prepare('UPDATE drive_connections SET scopes=? WHERE id=?').run('https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.readonly',f.selections[0].conn);
 const upgrade=await f.call('/integrations/drive');assert.equal(upgrade.data.connections.find(x=>x.id===f.selections[0].conn).status,'minimum_reconsent_required');
 assert.equal(f.sql.prepare('SELECT status FROM drive_connections WHERE id=?').get(f.selections[0].conn).status,'connected');

});

test('decision receipts cannot be forged, reused by another session, or cover a missing source',async t=>{
 const f=await fixture(t),id=crypto.randomUUID(),token=random(),now=Date.now();
 f.sql.prepare("INSERT INTO review_requests(id,owner_uid,client_id,project_id,client_name,project_name,studio_name,title,message,recipient_email,access_mode,status,current_version,expires_at,token_hash,encrypted_token,created_at,updated_at) VALUES(?,'alice',7,17,'C','P','S','R','','','link','pending',1,?,?,?,?,?)").run(id,now+86400000,await hash(token),await encrypt(f.env,token,context(f.env,'alice',id,'review-invite')),now,now);
 const file=f.selections[0];
 f.sql.prepare("INSERT INTO review_assets(review_id,version,file_id,connection_id,linked_folder_id,name,mime_type,grant_state,source_revision,source_size) VALUES(?,1,?,?,'','Cut.mp4','video/mp4','granted','rev1','4')").run(id,file.file,file.conn);
 const open=async()=>{
  f.reset();return (await (await handle(new Request('https://roteiva-api-dev.roteiva-dev.workers.dev/reviews/public/session',{method:'POST',headers:{Origin:f.env.FRONTEND_ORIGIN,'X-Review-Token':token}}),f.env)).json()).session;
 };
 const a=await open(),b=await open(),payload={version:1,authorName:'Client',decision:'approved'};
 const prepared=await f.call('/reviews/public/decision-check',{version:1},a,false);assert.equal(prepared.data.ready,true);
 const cross=await f.call('/reviews/public/decide',{...payload,proof:prepared.data.proof},b,false);assert.equal(cross.data.error.code,'review_decision_check_required');
 const forged=await f.call('/reviews/public/decide',{...payload,proof:'forged'},a,false);assert.equal(forged.data.error.code,'review_decision_check_required');
 f.hooks.missing=file.file;
 const missing=await f.call('/reviews/public/decision-check',{version:1},a,false);assert.equal(missing.response.status,404);assert.equal(f.sql.prepare('SELECT count(*) n FROM review_decisions').get().n,0);
 const original=Date.now;Date.now=()=>now+61000;t.after(()=>{Date.now=original;});
 const stale=await f.call('/reviews/public/decide',{...payload,proof:prepared.data.proof},a,false);assert.equal(stale.data.error.code,'review_decision_check_required');
});

test('bulk authorization denies trashed ancestors and foreign projects; eighty-folder reuse stays within budget',async t=>{
 const f=await fixture(t),ids=f.selections.map(x=>x.libraryNodeId);
 f.reset();assert.equal((await reviewLibrarySelection(f.env,'alice',17,ids)).length,8);assert.equal(f.used,1);
 await assert.rejects(reviewLibrarySelection(f.env,'bob',17,ids),e=>e.code==='review_file_denied');
 await assert.rejects(reviewLibrarySelection(f.env,'alice',18,ids),e=>e.code==='review_file_denied');
 const folder=await (await mutateLibrary({...f.env,DB:f.DB},f.lib,null,{name:'Moved'})).json();
 f.sql.prepare('UPDATE library_nodes SET parent_id=? WHERE id=?').run(folder.id,ids[0]);
 f.sql.prepare("UPDATE library_nodes SET state='trashed' WHERE id=?").run(folder.id);
 await assert.rejects(reviewLibrarySelection(f.env,'alice',17,ids),e=>e.code==='review_file_denied');
 const folders=Array.from({length:80},(_,i)=>({key:'k'+i,parentKey:i%16?'k'+(i-1):null,name:'Folder '+i}));
 for(let i=0;i<2;i++){
  f.reset();const result=await createLibraryStructure(f.env,'alice',17,{attemptId:crypto.randomUUID(),parentId:'root',folders,reuseExisting:true});
  assert.equal(result.status,200);assert.ok(f.used<35,f.used);
 }
});
