// Local owner-operated maintenance. No public route, deployment credential,
// arbitrary SQL input, generic document patch, or credential file is accepted.
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {readFileSync} from 'node:fs';
import {environment} from '../../shared/environments.ts';
import {resolveAccess} from '../src/access.ts';
import {grantReviewCourtesy,validateReviewRequest} from '../ops/review-courtesy.mjs';

export async function runReviewCourtesy(args=process.argv.slice(2), env=process.env, fetcher=fetch){
const fetch=fetcher;
let phase="configuration";
try{
const [target, email, until, operation, confirmation] = args;
const expected=environment(target);
assert.match(email||'', /^[^\s@]+@[^\s@]+\.[^\s@]+$/);
const config=JSON.parse(readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8')).env[target];
assert.equal(config.vars.FIREBASE_PROJECT_ID,expected.projectId);
assert.equal(config.name,expected.workerName);
assert.equal(config.vars.ENVIRONMENT,target);
assert.equal(config.d1_databases[0].database_name,expected.databaseName);
assert.equal(env.CLOUDFLARE_ACCOUNT_ID,config.account_id);
assert.equal(env.CLOUDFLARE_D1_DATABASE_ID,config.d1_databases[0].database_id);
assert.ok(env.FIREBASE_OPS_ACCESS_TOKEN && env.CLOUDFLARE_API_TOKEN);
assert.ok(!env.GOOGLE_APPLICATION_CREDENTIALS,'Use the interactive owner identity, never a deployment service account');
const googleToken=env.FIREBASE_OPS_ACCESS_TOKEN;
const cfToken=env.CLOUDFLARE_API_TOKEN;
const root='projects/'+expected.projectId+'/databases/(default)/documents/users/';
const api='https://firestore.googleapis.com/v1/';
const d1='https://api.cloudflare.com/client/v4/accounts/'+config.account_id+
  '/d1/database/'+config.d1_databases[0].database_id;
async function call(url,token,method='GET',body){
  phase=url.includes('identitytoolkit')?'identity-lookup':url.includes('userinfo')?'operator-identity':url.startsWith(d1)?'d1':url.includes('/access/current')?'projection-read':url.includes('/users/')?'profile-read':'database-metadata';
  const r=await fetch(url,{method,redirect:'error',signal:AbortSignal.timeout(20000),
    headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},
    ...(body?{body:JSON.stringify(body)}:{})});
  if(!r.ok)throw Object.assign(new Error('Operator transport failed'),{httpStatus:r.status});
  return r.json();
}
async function query(sql,params=[]){
  const r=await call(d1+'/query',cfToken,'POST',{sql,params});
  assert.ok(r.success && r.result?.length===1 && r.result[0].success,'D1 operation not confirmed');
  return r.result[0];
}
async function one(sql,params){return (await query(sql,params)).results[0]||null;}
const owner=await call('https://www.googleapis.com/oauth2/v3/userinfo',googleToken);
assert.ok(owner.email_verified && owner.email && !owner.email.endsWith('.gserviceaccount.com'),
  'Interactive owner identity required');
const database=await call(api+'projects/'+expected.projectId+'/databases/(default)',googleToken);
assert.equal(database.name,'projects/'+expected.projectId+'/databases/(default)');
assert.equal(database.type,'FIRESTORE_NATIVE');
assert.ok(!database.databaseEdition || database.databaseEdition==='STANDARD','Unexpected database edition');
const metadata=await call(d1,cfToken);
assert.ok(metadata.success);
assert.equal(metadata.result.uuid,config.d1_databases[0].database_id);
assert.equal(metadata.result.name,expected.databaseName);
assert.equal((await one('SELECT environment FROM deployment_identity WHERE singleton=1'))?.environment,target);
const lookup=await call('https://identitytoolkit.googleapis.com/v1/projects/'+expected.projectId+'/accounts:lookup',
  googleToken,'POST',{email:[email]});
assert.equal(lookup.users?.length,1,'Exactly one existing review identity required');
const identity=lookup.users[0];
assert.equal(identity.email,email);
assert.ok(identity.emailVerified && !identity.disabled);
assert.ok(identity.providerUserInfo?.some(p=>p.providerId==='google.com'&&p.email===email));
const uid=identity.localId;
assert.match(uid,/^[A-Za-z0-9_-]{1,128}$/);
const account=()=>one('SELECT * FROM access_accounts WHERE owner_uid=?',[uid]);
const originalAccount=await account();assert.ok(originalAccount);
assert.equal(originalAccount.suspended_at,null,'Cannot override a suspension');
const grantId=operation+':'+uid;
async function profile(){
  const p=await call(api+root+uid,googleToken);
  assert.equal(p.fields?.ownerUid?.stringValue,uid);
  assert.ok(!p.fields?.deletionState?.stringValue,'Account deletion must not be pending');
  assert.ok(p.updateTime);
  assert.equal(await one('SELECT 1 AS present FROM account_deletions WHERE owner_uid=?',[uid]),null);
  return p;
}
async function projection(){const p=await call(api+root+uid+'/access/current',googleToken);
  assert.equal(p.fields?.ownerUid?.stringValue,uid);assert.ok(p.updateTime);return p;}
async function patchProjection(fields){
  // CAS retry is safe only for rejected commits, never transport/uncertain writes.
  for(let attempt=0;attempt<4;attempt++){
    const p=await profile(),current=await projection();
    phase="projection-write";
    const r=await fetch(api+'projects/'+expected.projectId+'/databases/(default)/documents:commit',{
      method:'POST',redirect:'error',signal:AbortSignal.timeout(20000),
      headers:{Authorization:'Bearer '+googleToken,'Content-Type':'application/json'},
      body:JSON.stringify({writes:[
        {update:{name:root+uid,fields:{ownerUid:{stringValue:uid}}},updateMask:{fieldPaths:['ownerUid']},currentDocument:{updateTime:p.updateTime}},
        {update:{name:root+uid+'/access/current',fields},updateMask:{fieldPaths:Object.keys(fields)},currentDocument:{updateTime:current.updateTime}},
      ]})});
    if(r.ok)return;
    if(r.status!==409&&r.status!==412)throw Error('Projection write HTTP '+r.status);
  }
  throw Error('Projection CAS contention; maintenance fence retained');
}
async function state(){
  const a=await account();assert.ok(a);assert.equal(a.suspended_at,null);
  assert.equal(a.trial_started_at,originalAccount.trial_started_at);
  assert.equal(a.trial_ends_at,originalAccount.trial_ends_at);
  const now=Date.now();
  const grants=(await query('SELECT grant_kind,ends_at FROM access_grants WHERE owner_uid=? AND revoked_at IS NULL AND starts_at<=? AND (ends_at IS NULL OR ends_at>?)',[uid,now,now])).results;
  const subscriptions=(await query('SELECT status,paid_until FROM access_subscriptions WHERE owner_uid=?',[uid])).results;
  return resolveAccess(a,grants,subscriptions,now);
}
function fields(s){return {ownerUid:{stringValue:uid},schemaVersion:{integerValue:'1'},
  source:{stringValue:s.source},accessUntil:{timestampValue:s.accessUntil},trialEndsAt:{timestampValue:s.trialEndsAt},
  unlimited:{booleanValue:s.unlimited},suspended:{booleanValue:s.suspended},updatedAt:{timestampValue:new Date().toISOString()}};}
const adapter={
  async verifyIdentity(value){assert.equal(value,uid);await profile();},
  async readGrant(id){assert.equal(id,grantId);return one('SELECT * FROM access_grants WHERE id=?',[id]);},
  async acquireFence(){return (await query('UPDATE access_accounts SET sync_pending=1,updated_at=? WHERE owner_uid=? AND sync_pending=0 AND suspended_at IS NULL AND NOT EXISTS(SELECT 1 FROM account_deletions WHERE owner_uid=?)',[Date.now(),uid,uid])).meta.changes;},
  async denyProjection(){const p=await projection();await patchProjection({...p.fields,suspended:{booleanValue:true},unlimited:{booleanValue:false},updatedAt:{timestampValue:new Date().toISOString()}});},
  async verifyDenied(){assert.equal((await account()).sync_pending,1);const p=await projection();assert.equal(p.fields.suspended.booleanValue,true);assert.equal(p.fields.unlimited.booleanValue,false);},
  async insertGrant(g){assert.equal((await account()).sync_pending,1);await profile();
    await query("INSERT INTO access_grants(id,owner_uid,grant_kind,starts_at,ends_at,reason,created_at) SELECT ?,?,'complimentary',?,?,?,? WHERE EXISTS(SELECT 1 FROM access_accounts WHERE owner_uid=? AND sync_pending=1 AND suspended_at IS NULL) AND NOT EXISTS(SELECT 1 FROM account_deletions WHERE owner_uid=?) ON CONFLICT(id) DO NOTHING",[g.id,uid,g.startsAt,g.endsAt,g.reason,Date.now(),uid,uid]);},
  async publishFromAuthoritativeState(){assert.equal((await account()).sync_pending,1);await patchProjection(fields(await state()));},
  async verifyPublished(_uid,end,options){await profile();const a=await account();assert.equal(a.sync_pending,options?.fenced?1:0);
    const s=await state(),p=await projection();assert.ok(s.active&&!s.suspended&&!s.unlimited);
    assert.equal(s.source,'complimentary');assert.ok(Date.parse(s.accessUntil)>=end);
    const wanted=fields(s);delete wanted.updatedAt;
    for(const [key,value] of Object.entries(wanted))assert.deepEqual(p.fields[key],value);
  },
  async releaseFence(){await profile();return (await query('UPDATE access_accounts SET sync_pending=0,updated_at=? WHERE owner_uid=? AND sync_pending=1 AND NOT EXISTS(SELECT 1 FROM account_deletions WHERE owner_uid=?)',[Date.now(),uid,uid])).meta.changes;},
};
await profile();
validateReviewRequest({uid,operation,until,operator:owner.email});
if(!await adapter.readGrant(grantId)){
  const before=await state();
  assert.ok(!before.unlimited&&!before.suspended,'Existing special access cannot be overridden');
  assert.ok(Date.parse(until)>Date.parse(before.accessUntil),'Courtesy must extend current access');
  assert.equal((await account()).sync_pending,0,'Existing maintenance must be reconciled separately');
}
if(confirmation!=='APPLY-REVIEW-COURTESY'){
  assert.equal(confirmation,undefined,'Invalid confirmation');
  return {environment:target,operation,expiresAt:until,identityVerified:true,mode:'read-only-plan'};
}else{
  // Never log the identity, credentials, remote bodies, grants or projection.
  const result=await grantReviewCourtesy(adapter,{uid,operation,until,operator:owner.email});
  return {environment:target,operation,...result,trialPreserved:true,projectionVerified:true};
}

}catch(error){throw Object.assign(new Error("Operator operation not confirmed"),{stage:phase,httpStatus:error.httpStatus||null});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)runReviewCourtesy().then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(JSON.stringify({status:"not-confirmed",stage:error.stage,httpStatus:error.httpStatus}));process.exitCode=1;});
