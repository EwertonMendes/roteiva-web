import test from 'node:test';
import assert from 'node:assert/strict';
import {database} from './helpers/database.mjs';
import {encrypt,decrypt,context,base64url} from '../src/crypto.ts';
import {accessCredential,accessToken} from '../src/google.ts';
import {driveJson} from '../src/drive-client.ts';
import {rejectCachedToken} from '../src/token-store.ts';

async function setup(t) {
  const env={ENVIRONMENT:'dev',TOKEN_KEY_VERSION:'v1',
    TOKEN_KEYS:JSON.stringify({v1:base64url(crypto.getRandomValues(new Uint8Array(32)))}),
    GOOGLE_CLIENT_ID:'synthetic-client',GOOGLE_CLIENT_SECRET:'synthetic-secret'};
  const row={id:'connection-A',owner_uid:'A',google_account_id:'google-A',google_email:'a@example.com',
    status:'connected',revision:1,scopes:'https://www.googleapis.com/auth/drive.file',
    encrypted_refresh_token:await encrypt(env,'synthetic-refresh',context(env,'A','google-A'))};
  const db=database(row);t.after(db.close);env.DB=db.DB;
  const saved=()=>db.sql.prepare('SELECT * FROM drive_connections WHERE id=?').get(row.id);
  return {env,row,...db,saved};
}
const token=(value='access-A',extra={})=>Response.json({access_token:value,token_type:'Bearer',expires_in:3600,...extra});
const target=()=>new URL('https://www.googleapis.com/drive/v3/about?fields=user');
function deferred() {let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}

test('cache reuses encrypted token across independent callers; expiry margin triggers renewal',async(t)=>{
  const {env,row,sql,saved}=await setup(t);let calls=0;
  const fetcher=async()=>{calls++;return token('access-'+calls);};
  const first=await accessCredential(env,row,fetcher);
  for(let i=0;i<10;i++)assert.equal(await accessToken({...env}, {...row},fetcher),first.value);
  assert.equal(calls,1);
  assert.ok(!JSON.stringify(saved()).includes(first.value));
  assert.ok(saved().access_token_expires_at>Date.now()+3000000);
  sql.prepare('UPDATE drive_connections SET access_token_expires_at=?').run(Date.now()+59000);
  assert.equal(await accessToken(env,row,fetcher),'access-2');
  assert.equal(calls,2);
});

test('simultaneous requests coordinate via SQL lease, not isolate memory',async(t)=>{
  const {env,row}=await setup(t);let calls=0;
  const fetcher=async()=>{calls++;await new Promise(r=>setTimeout(r,180));return token();};
  const values=await Promise.all(Array.from({length:8},()=>accessToken({...env}, {...row},fetcher)));
  assert.deepEqual(new Set(values),new Set(['access-A']));assert.equal(calls,1);
});

test('owner, account, environment and cache AAD are isolated',async(t)=>{
  const {env,row,sql,saved}=await setup(t);
  await accessToken(env,row,async()=>token());
  await assert.rejects(()=>accessToken(env,{...row,owner_uid:'B'},async()=>token()),e=>e.code==='connection_not_found');
  await assert.rejects(()=>accessToken({...env,ENVIRONMENT:'prod'},row,async()=>token()));
  const cipher=saved().encrypted_access_token;
  sql.prepare('UPDATE drive_connections SET google_account_id=?').run('other-google');
  await assert.rejects(()=>accessToken(env,row,async()=>token()));
  assert.equal(saved().encrypted_access_token,cipher);
});

test('refresh rotation and cache are committed together with matching revision/AAD',async(t)=>{
  const {env,row,saved}=await setup(t);
  await accessToken(env,row,async()=>token('rotated-access',{refresh_token:'rotated-refresh'}));
  assert.equal(saved().revision,2);
  assert.equal(await decrypt(env,saved().encrypted_refresh_token,context(env,'A','google-A')),'rotated-refresh');
  assert.equal(await accessToken(env,row,async()=>{throw Error('cache should be used');}),'rotated-access');
});

test('disconnect during refresh fences late success and never restores cache',async(t)=>{
  const {env,row,sql,saved}=await setup(t);const started=deferred(),resume=deferred();
  const pending=accessToken(env,row,async()=>{started.resolve();await resume.promise;return token();});
  await started.promise;
  sql.exec("UPDATE drive_connections SET status='revocation_pending',revision=revision+1,encrypted_access_token=NULL,refresh_lease_id=NULL,refresh_lease_until=0");
  resume.resolve();
  await assert.rejects(()=>pending,e=>e.code==='connection_changed');
  assert.equal(saved().status,'revocation_pending');assert.equal(saved().encrypted_access_token,null);
  await assert.rejects(()=>accessToken(env,row,async()=>token()),e=>e.code==='reconnect_required');
});

test('reconnection during refresh is not overwritten or invalidated by old invalid_grant',async(t)=>{
  const {env,row,sql,saved}=await setup(t);const started=deferred(),resume=deferred();
  const pending=accessToken(env,row,async()=>{started.resolve();await resume.promise;return Response.json({error:'invalid_grant'},{status:400});});
  await started.promise;
  const fresh=await encrypt(env,'new-consent-refresh',context(env,'A','google-A'));
  sql.prepare("UPDATE drive_connections SET revision=revision+1,encrypted_refresh_token=?,refresh_lease_id=NULL,refresh_lease_until=0").run(fresh);
  resume.resolve();
  await assert.rejects(()=>pending,e=>e.code==='reconnect_required');
  assert.equal(saved().revision,2);assert.equal(saved().status,'connected');
  assert.equal(saved().encrypted_refresh_token,fresh);
});

test('expired lease can be taken over; former holder cannot publish or invalidate replacement',async(t)=>{
  const {env,row,sql,saved}=await setup(t);const started=deferred(),resume=deferred();
  const pending=accessToken(env,row,async()=>{started.resolve();await resume.promise;return Response.json({error:'invalid_grant'},{status:400});});
  await started.promise;
  sql.exec('UPDATE drive_connections SET refresh_lease_until=0');
  const replacement=await accessCredential(env,row,async()=>token('replacement'));
  resume.resolve();
  await assert.rejects(()=>pending,e=>e.code==='reconnect_required');
  assert.equal(saved().status,'connected');
  assert.equal(saved().access_token_version,replacement.version);
  assert.equal(await accessToken(env,row,async()=>token()),'replacement');
});

test('late 401 only evicts the rejected cache version',async(t)=>{
  const {env,row}=await setup(t);
  const old=await accessCredential(env,row,async()=>token('old'));
  await rejectCachedToken(env,row,old.version);
  const fresh=await accessCredential(env,row,async()=>token('new'));
  await rejectCachedToken(env,row,old.version);
  assert.equal((await accessCredential(env,row,async()=>{throw Error('must reuse');})).version,fresh.version);
});

test('Drive 401 refreshes and retries GET exactly once; persistent 401 is bounded',async(t)=>{
  const {env,row}=await setup(t);let tokens=0,reads=0;
  const fetcher=async(url)=>{
    if(String(url).includes('oauth2.googleapis.com'))return token('access-'+(++tokens));
    reads++;return reads===1?Response.json({error:{}},{status:401}):Response.json({ok:true});
  };
  assert.deepEqual(await driveJson(env,row,target(),fetcher),{ok:true});
  assert.equal(tokens,2);assert.equal(reads,2);
  reads=0;
  await assert.rejects(()=>driveJson(env,row,target(),async(url)=>{
    if(String(url).includes('oauth2.googleapis.com'))return token('retry');
    reads++;return Response.json({error:{}},{status:401});
  }),e=>e.code==='drive_access_rejected');
  assert.equal(reads,2);
});

test('Drive 403 permission, quota and outages never trigger token refresh/reconnection',async(t)=>{
  const {env,row,saved}=await setup(t);let tokenCalls=0;
  await accessToken(env,row,async()=>{tokenCalls++;return token();});
  for(const [status,reason,code] of [
    [403,'insufficientFilePermissions','drive_permission_denied'],
    [403,'insufficientPermissions','drive_read_permission_missing'],
    [403,'userRateLimitExceeded','drive_rate_limited'],
    [429,'','drive_rate_limited'],[503,'','drive_unavailable'],
  ]) {
    await assert.rejects(()=>driveJson(env,row,target(),async(url)=>{
      if(String(url).includes('oauth2.googleapis.com')){tokenCalls++;return token();}
      return Response.json({error:{errors:[{reason}]}},{status});
    }),e=>e.code===code);
    assert.equal(saved().status,'connected');
  }
  assert.equal(tokenCalls,1);
  await assert.rejects(()=>driveJson(env,row,new URL('https://evil.example/drive/v3/files')),e=>e.code==='invalid_drive_endpoint');
});

test('transient refresh failure releases lease, preserves refresh credential and applies cooldown',async(t)=>{
  const {env,row,saved}=await setup(t);let calls=0;
  const fail=async()=>{calls++;throw Error('network');};
  await assert.rejects(()=>accessToken(env,row,fail),e=>e.code==='google_unavailable');
  assert.equal(saved().status,'connected');assert.ok(saved().encrypted_refresh_token);
  assert.equal(saved().refresh_lease_id,null);
  await assert.rejects(()=>accessToken(env,row,fail),e=>e.code==='token_refresh_retry_later');
  assert.equal(calls,1);
});
