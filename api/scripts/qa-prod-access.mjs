/**
 * Protected, owner-dispatched PROD-only QA operation. Looks up the exact email
 * in Firebase Authentication, never guesses a UID from D1 or a Google Drive
 * connection, and refuses all accounts with monetary/paid or complimentary
 * entitlements. Writes a private Firestore backup before altering the trial.
 *
 * Run only via .github/workflows/prod-qa-access.yml, with environment approval.
 */
import assert from 'node:assert/strict';
import {SignJWT,importPKCS8} from 'jose';

const PROJECT='roteiva-web-prod';
const ACCOUNT='836f81609b80e6b75be8e33d80c59dd5';
const DATABASE='082ca9da-af45-4162-a581-ed2c8c1938cb';
const TRIAL_MS=7*24*60*60*1000;
const QA_DOC='qa-expiry-20261121';

export function expiredTrial(now) {
  assert.ok(Number.isSafeInteger(now)&&now>TRIAL_MS);
  const end=now-120000;
  return {start:end-TRIAL_MS,end};
}
export function assertSafeAccount(row,now) {
  assert.ok(row&&/^[A-Za-z0-9_-]{1,128}$/.test(row.owner_uid),'Registered PROD access row required');
  assert.equal(row.suspended_at,null,'Suspended accounts cannot be QA-expired');
  assert.equal(Number(row.sync_pending),0,'An access projection is in flight');
  assert.equal(Number(row.subscriptions),0,'Paid subscription history must remain untouched');
  assert.equal(Number(row.contracts),0,'An active recurring billing contract exists');
  assert.equal(Number(row.checkouts),0,'Payment checkout exists; do not change the access period');
  assert.equal(Number(row.payments),0,'A payment exists; do not modify test access');
  assert.equal(Number(row.grants),0,'Other entitlement exists; expire only a simple free trial');
  assert.equal(Number(row.pending_projections),0,'A billing projection is pending');
  assert.equal(row.trial_ends_at-row.trial_started_at,TRIAL_MS,'Unexpected trial duration');
  assert.ok(Number.isSafeInteger(row.trial_ends_at)&&row.trial_started_at>=0);
  assert.ok(now>0);
}
export function projectedAccess(uid,end,now) {
  assert.match(uid,/^[A-Za-z0-9_-]{1,128}$/);
  assert.ok(Number.isSafeInteger(end));
  return {
    ownerUid:{stringValue:uid},schemaVersion:{integerValue:'1'},
    source:{stringValue:end>now?'trial':'none'},
    accessUntil:{timestampValue:new Date(end).toISOString()},
    trialEndsAt:{timestampValue:new Date(end).toISOString()},
    unlimited:{booleanValue:false},suspended:{booleanValue:false},
    updatedAt:{timestampValue:new Date(now).toISOString()},
  };
}
function required(name) {
  const value=process.env[name];
  assert.ok(value&&value.trim()===value,'Missing protected '+name);
  return value;
}
function ensureIdentity() {
  assert.equal(process.env.GITHUB_ACTIONS,'true','Must use GitHub protected environment');
  assert.equal(process.env.GITHUB_REPOSITORY,'EwertonMendes/roteiva-web');
  assert.equal(process.env.GITHUB_ACTOR,process.env.GITHUB_REPOSITORY_OWNER);
  assert.equal(process.env.CLOUDFLARE_ACCOUNT_ID,ACCOUNT);
  assert.equal(process.env.CLOUDFLARE_D1_DATABASE_ID,DATABASE);
  assert.equal(process.env.QA_CONFIRMATION,'EXPIRE ROTEIVA PROD TEST');
  const email=required('QA_TARGET_EMAIL').toLowerCase();
  assert.match(email,/^[^\s@]{1,64}@[^\s@]{1,190}\.[A-Za-z]{2,}$/);
  const action=required('QA_ACTION');
  assert.ok(action==='expire'||action==='restore');
  const sa=JSON.parse(required('FIREBASE_ADMIN_CREDENTIALS_JSON'));
  assert.equal(sa.type,'service_account');
  assert.equal(sa.project_id,PROJECT);
  assert.match(sa.client_email,/^.+@roteiva-web-prod\.iam\.gserviceaccount\.com$/);
  assert.equal(sa.token_uri,'https://oauth2.googleapis.com/token');
  assert.match(sa.private_key,/BEGIN PRIVATE KEY/);
  return {email,action,sa,cloudflareKey:required('CLOUDFLARE_API_TOKEN')};
}
async function safeResponse(response,label) {
  if(!response.ok)throw new Error(label+' returned HTTP '+response.status);
  return response.json();
}
async function tokenFor(sa) {
  const now=Math.floor(Date.now()/1000);
  const jwt=await new SignJWT({scope:'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/identitytoolkit'})
    .setProtectedHeader({alg:'RS256',typ:'JWT'}).setIssuer(sa.client_email)
    .setAudience(sa.token_uri).setIssuedAt(now).setExpirationTime(now+300)
    .sign(await importPKCS8(sa.private_key,'RS256'));
  const response=await fetch(sa.token_uri,{method:'POST',redirect:'error',headers:{
    'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:jwt}),
    signal:AbortSignal.timeout(12000)});
  const result=await safeResponse(response,'Google service-account token');
  assert.ok(result.access_token,'No Google admin access token');
  return result.access_token;
}
async function google(token,path,method='GET',body) {
  const response=await fetch(path,{method,redirect:'error',
    headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});
  return safeResponse(response,'Firebase admin request');
}
async function uidFromVerifiedEmail(token,email) {
  const response=await google(token,'https://identitytoolkit.googleapis.com/v1/projects/'+PROJECT+'/accounts:lookup',
    'POST',{email:[email]});
  const users=response.users||[];
  assert.equal(users.length,1,'Firebase Authentication must resolve exactly one account');
  const user=users[0];
  assert.equal(String(user.email||'').toLowerCase(),email,'Firebase returned a different email');
  assert.match(user.localId,/^[A-Za-z0-9_-]{1,128}$/,'Invalid verified PROD UID');
  assert.equal(user.disabled||false,false,'The account is disabled');
  return user.localId;
}
const firestoreRoot='https://firestore.googleapis.com/v1/projects/'+PROJECT+'/databases/(default)/documents';
const firestoreName=(uid,relative)=>'projects/'+PROJECT+'/databases/(default)/documents/users/'+uid+'/'+relative;
const fsUrl=(name)=>'https://firestore.googleapis.com/v1/'+name;
async function fsGet(token,name,canBeMissing=false) {
  const response=await fetch(fsUrl(name),{redirect:'error',headers:{Authorization:'Bearer '+token},
    signal:AbortSignal.timeout(15000)});
  if(canBeMissing&&response.status===404)return null;
  return safeResponse(response,'Firestore read');
}
async function firestoreCommit(token,writes) {
  return google(token,firestoreRoot+':commit','POST',{writes});
}
async function d1Request(cfKey,sql,params=[]) {
  const response=await fetch('https://api.cloudflare.com/client/v4/accounts/'+ACCOUNT+
    '/d1/database/'+DATABASE+'/query',{method:'POST',redirect:'error',
    headers:{Authorization:'Bearer '+cfKey,'Content-Type':'application/json'},
    body:JSON.stringify({sql,params}),signal:AbortSignal.timeout(15000)});
  const result=await safeResponse(response,'Cloudflare PROD D1');
  if(!result.success||!Array.isArray(result.result)||result.result.length!==1||result.result[0].success===false)
    throw new Error('Cloudflare PROD D1 rejected the guarded operation');
  return result.result[0];
}
const accountSql=`SELECT a.owner_uid,a.trial_started_at,a.trial_ends_at,a.suspended_at,a.sync_pending,
  (SELECT COUNT(*) FROM access_subscriptions s WHERE s.owner_uid=a.owner_uid) AS subscriptions,
  (SELECT COUNT(*) FROM billing_contracts c WHERE c.owner_uid=a.owner_uid) AS contracts,
  (SELECT COUNT(*) FROM billing_checkout_intents i WHERE i.owner_uid=a.owner_uid) AS checkouts,
  (SELECT COUNT(*) FROM billing_payment_records p WHERE p.owner_uid=a.owner_uid) AS payments,
  (SELECT COUNT(*) FROM access_grants g WHERE g.owner_uid=a.owner_uid AND g.revoked_at IS NULL
     AND g.starts_at<=? AND (g.ends_at IS NULL OR g.ends_at>?)) AS grants,
  (SELECT COUNT(*) FROM billing_access_projections b WHERE b.owner_uid=a.owner_uid) AS pending_projections
  FROM access_accounts a WHERE a.owner_uid=?`;
async function getAccount(cfKey,uid,now) {
  const response=await d1Request(cfKey,accountSql,[now,now,uid]);
  assert.equal(response.results.length,1,'Firebase account not enrolled in PROD D1');
  return response.results[0];
}
async function writeTrial(cfKey,uid,oldStart,oldEnd,newStart,newEnd,now) {
  const sql=`UPDATE access_accounts
    SET trial_started_at=?,trial_ends_at=?,updated_at=?
    WHERE owner_uid=? AND trial_started_at=? AND trial_ends_at=?
    AND suspended_at IS NULL AND sync_pending=0
    AND NOT EXISTS(SELECT 1 FROM access_subscriptions WHERE owner_uid=?)
    AND NOT EXISTS(SELECT 1 FROM billing_checkout_intents WHERE owner_uid=?)
    AND NOT EXISTS(SELECT 1 FROM billing_payment_records WHERE owner_uid=?)
    AND NOT EXISTS(SELECT 1 FROM billing_contracts WHERE owner_uid=?)
    AND NOT EXISTS(SELECT 1 FROM billing_access_projections WHERE owner_uid=?)
    AND NOT EXISTS(SELECT 1 FROM access_grants WHERE owner_uid=? AND revoked_at IS NULL
      AND starts_at<=? AND (ends_at IS NULL OR ends_at>?))`;
  const result=await d1Request(cfKey,sql,[newStart,newEnd,now,uid,oldStart,oldEnd,
    uid,uid,uid,uid,uid,uid,now,now]);
  assert.equal(result.meta?.changes,1,'Protected D1 update changed an unexpected number of rows');
}
function backupFields(uid,row,newTrial,now) {
  return {
    ownerUid:{stringValue:uid},
    originalTrialStart:{integerValue:String(row.trial_started_at)},
    originalTrialEnd:{integerValue:String(row.trial_ends_at)},
    testTrialStart:{integerValue:String(newTrial.start)},
    testTrialEnd:{integerValue:String(newTrial.end)},
    createdAt:{timestampValue:new Date(now).toISOString()}
  };
}
function readBackup(backup,uid) {
  assert.equal(backup?.fields?.ownerUid?.stringValue,uid,'QA backup owner mismatch');
  const f=backup.fields;
  const values={originalStart:Number(f.originalTrialStart?.integerValue),
    originalEnd:Number(f.originalTrialEnd?.integerValue),
    testStart:Number(f.testTrialStart?.integerValue),
    testEnd:Number(f.testTrialEnd?.integerValue)};
  for(const value of Object.values(values))assert.ok(Number.isSafeInteger(value)&&value>=0,'Invalid QA backup');
  assert.equal(values.originalEnd-values.originalStart,TRIAL_MS);
  assert.equal(values.testEnd-values.testStart,TRIAL_MS);
  return values;
}
async function updateProjection(token,uid,oldDocument,end,now) {
  const fields=projectedAccess(uid,end,now);
  await firestoreCommit(token,[{
    update:{name:firestoreName(uid,'access/current'),fields},
    updateMask:{fieldPaths:Object.keys(fields)},
    currentDocument:{updateTime:oldDocument.updateTime}
  }]);
}
async function main() {
  const {email,action,sa,cloudflareKey}=ensureIdentity();
  const token=await tokenFor(sa);
  const uid=await uidFromVerifiedEmail(token,email);
  const profile=await fsGet(token,firestoreName(uid,''));
  assert.equal(profile.fields?.ownerUid?.stringValue,uid,'Firestore profile UID mismatch');
  assert.notEqual(profile.fields?.deletionState?.stringValue,'deleting','Account is being deleted');
  const accessName=firestoreName(uid,'access/current');
  const backupName=firestoreName(uid,'qaAccessOverrides/'+QA_DOC);
  const [projection,backup]=await Promise.all([fsGet(token,accessName),fsGet(token,backupName,true)]);
  assert.equal(projection.fields?.ownerUid?.stringValue,uid,'Firestore access owner mismatch');
  assert.ok(projection.updateTime,'Firestore access update precondition missing');
  const now=Date.now();
  const account=await getAccount(cloudflareKey,uid,now);
  assertSafeAccount(account,now);
  let oldStart,oldEnd,newStart,newEnd;
  if(action==='expire'){
    assert.equal(backup,null,'A QA expiry backup already exists. Restore first.');
    assert.ok(account.trial_ends_at>now,'Account is already expired');
    assert.equal(projection.fields?.trialEndsAt?.timestampValue,
      new Date(account.trial_ends_at).toISOString(),'Firestore trial projection is stale');
    assert.equal(projection.fields?.source?.stringValue,'trial','QA can expire only a plain trial');
    const test=expiredTrial(now);
    ({start:newStart,end:newEnd}=test);
    oldStart=account.trial_started_at;
    oldEnd=account.trial_ends_at;
    await firestoreCommit(token,[{
      update:{name:backupName,fields:backupFields(uid,account,test,now)},
      currentDocument:{exists:false}
    }]);
  } else {
    const saved=readBackup(backup,uid);
    assert.equal(account.trial_started_at,saved.testStart,'D1 trial no longer matches QA override');
    assert.equal(account.trial_ends_at,saved.testEnd,'D1 trial no longer matches QA override');
    oldStart=saved.testStart;oldEnd=saved.testEnd;
    newStart=saved.originalStart;newEnd=saved.originalEnd;
  }
  await writeTrial(cloudflareKey,uid,oldStart,oldEnd,newStart,newEnd,now);
  try{
    await updateProjection(token,uid,projection,newEnd,Date.now());
  }catch(error){
    // Never leave an invisible D1-only expiration after a Firestore failure.
    try{
      await writeTrial(cloudflareKey,uid,newStart,newEnd,oldStart,oldEnd,Date.now());
    }catch{
      throw new Error('CRITICAL: Firestore update failed and D1 rollback also failed. Manual repair required.');
    }
    throw new Error('Firestore update failed. D1 was restored; the QA operation was not completed.');
  }
  const [verifiedD1,verifiedFirestore]=await Promise.all([
    getAccount(cloudflareKey,uid,Date.now()),fsGet(token,accessName)
  ]);
  assert.equal(verifiedD1.trial_ends_at,newEnd,'D1 verification failed');
  assert.equal(verifiedFirestore.fields?.trialEndsAt?.timestampValue,
    new Date(newEnd).toISOString(),'Firestore verification failed');
  if(action==='restore'){
    const deleted=await fetch(fsUrl(backupName),{method:'DELETE',redirect:'error',
      headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(12000)});
    assert.equal(deleted.ok,true,'Access restored but QA backup cleanup needs attention');
  }
  console.log('Verified exact Firebase Auth account. PROD QA access '+action+
    ' succeeded; Firestore projection matches D1. No payment, subscription or grant was modified.');
}
if(process.argv[1]?.endsWith('/qa-prod-access.mjs'))main().catch(error=>{
  console.error('PROD QA access operation failed: '+(error instanceof Error?error.message:'unknown error'));
  process.exitCode=1;
});
