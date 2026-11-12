import test from 'node:test';
import assert from 'node:assert/strict';
import {database} from './helpers/database.mjs';
import {reviewRouter} from '../src/reviews.ts';
import {random,hash,encrypt,context,base64url} from '../src/crypto.ts';
import {loadReviewSession,assertReviewSession,sessionSubject,touchReviewSession,cleanupReviewSessions} from '../src/review-sessions.ts';
const file='FILE_REVIEW_12345678';
async function fixture(t){
 const db=database();t.after(db.close);
 const env={DB:db.DB,ENVIRONMENT:'dev',VIRTUAL_LIBRARY_ENABLED:'true',TOKEN_KEY_VERSION:'v1',TOKEN_KEYS:JSON.stringify({v1:base64url(crypto.getRandomValues(new Uint8Array(32)))})};
 const id=crypto.randomUUID(),token=random(),now=Date.now(),tokenHash=await hash(token);
 db.sql.prepare("INSERT INTO review_requests(id,owner_uid,client_id,project_id,client_name,project_name,studio_name,title,message,recipient_email,access_mode,status,current_version,expires_at,token_hash,encrypted_token,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
  .run(id,'alice',7,17,'Client','Project','Studio','Cut','','','link','pending',1,now+86400000,tokenHash,await encrypt(env,token,context(env,'alice',id,'review-invite')),now,now);
 db.sql.prepare("INSERT INTO review_assets(review_id,version,file_id,connection_id,linked_folder_id,name,mime_type,grant_state,source_revision,source_size) VALUES(?,?,?,?,?,?,?,'granted','v1','4')")
  .run(id,1,file,crypto.randomUUID(),'root','Cut.mp4','video/mp4');
 const route=(path,headers={},method='GET')=>{
  const req=new Request('https://api.example'+path,{method,headers});return reviewRouter(req,env,new URL(req.url));
 };
 return {...db,env,id,token,tokenHash,route};
}
test('invitation is exchanged for a bounded review session; copied media ticket alone does not authorize bytes',async t=>{
 const f=await fixture(t);
 const session=await (await f.route('/reviews/public/session',{'X-Review-Token':f.token},'POST')).json();
 assert.match(session.session,/^[A-Za-z0-9_-]{43}$/);assert.ok(session.expiresAt<=Date.now()+30*60*1000);
 assert.equal(JSON.stringify(f.sql.prepare('SELECT * FROM review_sessions').get()).includes(session.session),false);
 await assert.rejects(f.route('/reviews/public',{'X-Review-Token':f.token}),e=>e.code==='review_session_required');
 const result=await (await f.route('/reviews/public',{'X-Review-Session':session.session})).json();
 const ticket=new URL(result.mediaTickets[file].url).search;
 await assert.rejects(f.route('/reviews/media'+ticket),e=>e.code==='review_session_required');
 await assert.rejects(f.route('/reviews/media'+ticket,{'X-Review-Session':random()}),e=>e.code==='review_session_expired');
 f.sql.prepare('UPDATE review_requests SET token_hash=? WHERE id=?').run(await hash(random()),f.id);
 await assert.rejects(f.route('/reviews/public',{'X-Review-Session':session.session}),e=>e.code==='review_session_expired');
 await assert.rejects(f.route('/reviews/media'+ticket,{'X-Review-Session':session.session}),e=>e.code==='review_not_found');
});
test('sessions bind identity, version and invitation; expiry and account erasure invalidate them',async t=>{
 const f=await fixture(t),opened=await (await f.route('/reviews/public/session',{'X-Review-Token':f.token},'POST')).json();
 const session=await loadReviewSession(f.env,opened.session),review={id:f.id,current_version:1,token_hash:f.tokenHash,expires_at:Date.now()+86400000};
 assertReviewSession(session,review,null);
 const principal=await sessionSubject('alice','google-a');assert.notEqual(principal,await sessionSubject('bob','google-a'));
 assert.throws(()=>assertReviewSession(session,review,principal),e=>e.code==='review_session_expired');
 assert.throws(()=>assertReviewSession(session,{...review,current_version:2},null),e=>e.code==='review_session_expired');
 session.expires_at=Date.now()+1000;await touchReviewSession(f.env,session,review);assert.ok(session.expires_at>Date.now()+20*60*1000);
 f.sql.prepare('UPDATE review_sessions SET expires_at=0').run();
 await assert.rejects(loadReviewSession(f.env,opened.session),e=>e.code==='review_session_expired');
 await cleanupReviewSessions(f.env);assert.equal(f.sql.prepare('SELECT count(*) n FROM review_sessions').get().n,0);
 await f.route('/reviews/public/session',{'X-Review-Token':f.token},'POST');
 f.sql.prepare('DELETE FROM review_requests WHERE id=?').run(f.id);assert.equal(f.sql.prepare('SELECT count(*) n FROM review_sessions').get().n,0);
});
