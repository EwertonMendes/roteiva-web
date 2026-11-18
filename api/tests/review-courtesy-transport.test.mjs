import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {database} from './helpers/database.mjs';
import {runReviewCourtesy} from '../scripts/review-courtesy.mjs';

function setup(t, fault){
  const db=database();t.after(db.close);
  const config=JSON.parse(readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8')).env.dev;
  const now=Math.floor(Date.now()/1000)*1000,until=new Date(now+60*86400000).toISOString();
  db.sql.prepare('INSERT INTO access_accounts(owner_uid,trial_started_at,trial_ends_at,created_at,updated_at) VALUES(?,?,?,?,?)').run('qa',now,now+604800000,now,now);
  let version=1,commits=0;
  let projection={fields:{ownerUid:{stringValue:'qa'},schemaVersion:{integerValue:'1'},source:{stringValue:'trial'},
    accessUntil:{timestampValue:new Date(now+604800000).toISOString()},trialEndsAt:{timestampValue:new Date(now+604800000).toISOString()},
    suspended:{booleanValue:false},unlimited:{booleanValue:false}},updateTime:'v1'};
  const env={CLOUDFLARE_ACCOUNT_ID:config.account_id,CLOUDFLARE_D1_DATABASE_ID:config.d1_databases[0].database_id,
    CLOUDFLARE_API_TOKEN:'synthetic-cf',FIREBASE_OPS_ACCESS_TOKEN:'synthetic-owner'};
  const args=['dev','review@example.com',until,'dropbox-review-20261117'];
  const fetcher=async(input,options={})=>{
    const url=new URL(input);assert.equal(options.redirect,'error');
    if(url.hostname==='api.cloudflare.com'){
      assert.equal(options.headers.Authorization,'Bearer synthetic-cf');
      assert.ok(url.pathname.includes(config.account_id));assert.ok(url.pathname.includes(config.d1_databases[0].database_id));
      if(url.pathname.endsWith('/query')){
        const {sql,params=[]}=JSON.parse(options.body);
        const stmt=db.sql.prepare(sql),results=stmt.all(...params);
        return Response.json({success:true,result:[{success:true,results,meta:{changes:Number(db.sql.prepare('SELECT changes() AS n').get().n)}}]});
      }
      return Response.json({success:true,result:{uuid:config.d1_databases[0].database_id,name:config.d1_databases[0].database_name}});
    }
    assert.equal(options.headers.Authorization,'Bearer synthetic-owner');
    if(url.pathname==='/oauth2/v3/userinfo')return Response.json({email:'owner@example.com',email_verified:true});
    if(url.hostname==='identitytoolkit.googleapis.com')return Response.json({users:[{localId:'qa',email:'review@example.com',emailVerified:true,
      providerUserInfo:[{providerId:'google.com',email:'review@example.com'}]}]});
    if(url.pathname.endsWith('/databases/(default)'))return Response.json({name:'projects/roteiva-web-dev/databases/(default)',type:'FIRESTORE_NATIVE',databaseEdition:'STANDARD'});
    if(url.pathname.endsWith('/users/qa'))return Response.json({fields:{ownerUid:{stringValue:fault==='foreign'?'foreign':'qa'}},updateTime:'profile-v1'});
    if(url.pathname.endsWith('/access/current'))return Response.json(projection);
    if(url.pathname.endsWith('/documents:commit')){
      commits++;
      if(fault==='deny')return new Response('',{status:503});
      if(fault==='publish'&&commits===2)throw Error('uncertain transport');
      const writes=JSON.parse(options.body).writes;
      assert.equal(writes.length,2);assert.equal(writes[0].currentDocument.updateTime,'profile-v1');
      assert.deepEqual(writes[0].updateMask.fieldPaths,['ownerUid']);
      assert.equal(writes[1].currentDocument.updateTime,projection.updateTime);
      assert.equal(db.sql.prepare('SELECT sync_pending FROM access_accounts WHERE owner_uid=?').get('qa').sync_pending,1);
      const canonicalFields=JSON.parse(JSON.stringify(writes[1].update.fields).replaceAll('.000Z','Z'));
      projection={fields:canonicalFields,updateTime:'v'+(++version)};
      return Response.json({});
    }
    throw Error('Unexpected transport');
  };
  return {...db,args,env,fetcher,projection:()=>projection,commits:()=>commits,now,until};
}
test('operator plan is read-only; apply uses real SQLite constraints and preserves trial',async t=>{
  const s=setup(t);
  assert.equal((await runReviewCourtesy(s.args,s.env,s.fetcher)).mode,'read-only-plan');
  assert.equal(s.commits(),0);assert.equal(s.sql.prepare('SELECT COUNT(*) AS n FROM access_grants').get().n,0);
  const apply=[...s.args,'APPLY-REVIEW-COURTESY'];
  assert.equal((await runReviewCourtesy(apply,s.env,s.fetcher)).status,'applied');
  assert.equal(s.commits(),2);
  const row=s.sql.prepare('SELECT * FROM access_accounts').get();
  assert.equal(row.sync_pending,0);assert.equal(row.trial_started_at,s.now);assert.equal(row.trial_ends_at,s.now+604800000);
  assert.equal(s.projection().fields.source.stringValue,'complimentary');
  assert.equal(Date.parse(s.projection().fields.accessUntil.timestampValue),Date.parse(s.until));
  assert.equal((await runReviewCourtesy(apply,s.env,s.fetcher)).status,'already-applied');
  assert.equal(s.commits(),2);assert.equal(s.sql.prepare('SELECT COUNT(*) AS n FROM access_grants').get().n,1);
});
test('explicit recovery seals the inspected snapshot and rejects a changed account',async t=>{
  const s=setup(t,'publish');
  await assert.rejects(runReviewCourtesy([...s.args,'APPLY-REVIEW-COURTESY'],s.env,s.fetcher));
  const plan=await runReviewCourtesy(s.args,s.env,s.fetcher);
  assert.match(plan.recoveryFingerprint,/^[a-f0-9]{64}$/);
  s.sql.prepare('UPDATE access_accounts SET updated_at=updated_at+1').run();
  await assert.rejects(runReviewCourtesy([...s.args,'RECOVER-REVIEW-COURTESY:'+plan.recoveryFingerprint],s.env,s.fetcher));
  assert.equal(s.sql.prepare('SELECT sync_pending FROM access_accounts').get().sync_pending,1);
  const fresh=await runReviewCourtesy(s.args,s.env,s.fetcher);
  assert.equal((await runReviewCourtesy([...s.args,'RECOVER-REVIEW-COURTESY:'+fresh.recoveryFingerprint],s.env,s.fetcher)).status,'reconciled');
  assert.equal(s.sql.prepare('SELECT sync_pending FROM access_accounts').get().sync_pending,0);
  assert.equal(s.sql.prepare('SELECT COUNT(*) AS n FROM access_grants').get().n,1);
});
test('wrong environment or foreign profile causes no mutation',async t=>{
  for(const fault of ['environment','foreign']){
    const s=setup(t,fault);const env={...s.env,...(fault==='environment'?{CLOUDFLARE_ACCOUNT_ID:'wrong'}:{})};
    await assert.rejects(runReviewCourtesy([...s.args,'APPLY-REVIEW-COURTESY'],env,s.fetcher));
    assert.equal(s.commits(),0);assert.equal(s.sql.prepare('SELECT sync_pending FROM access_accounts').get().sync_pending,0);
  }
});
for(const fault of ['deny','publish'])test('transport failure '+fault+' fails closed without replaying uncertain writes',async t=>{
  const s=setup(t,fault);await assert.rejects(runReviewCourtesy([...s.args,'APPLY-REVIEW-COURTESY'],s.env,s.fetcher));
  assert.equal(s.sql.prepare('SELECT sync_pending FROM access_accounts').get().sync_pending,1);
  assert.equal(s.commits(),fault==='deny'?1:2);
  if(fault==='deny')assert.equal(s.sql.prepare('SELECT COUNT(*) AS n FROM access_grants').get().n,0);
  else assert.equal(s.projection().fields.suspended.booleanValue,true);
});
