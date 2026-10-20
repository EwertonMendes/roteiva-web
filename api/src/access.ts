import { ApiError, type Env } from './types.ts';
import { adminToken } from './firebase-admin.ts';
import {retainTrialIdentity,type TrialPrincipal} from './trial-identity.ts';


async function assertNotDeleting(env:Env,uid:string):Promise<void> {
  const row=await env.DB.prepare('SELECT 1 FROM account_deletions WHERE owner_uid=?').bind(uid).first();
  if(row)throw new ApiError(409,'account_deleting');
}
export const TRIAL_DAYS=7;
export const TRIAL_MS=TRIAL_DAYS*24*60*60*1000;
export const PAYMENT_GRACE_MS=3*24*60*60*1000;
type Account={trial_started_at:number;trial_ends_at:number;suspended_at:number|null};
type Grant={grant_kind:'complimentary'|'lifetime';ends_at:number|null};
type Subscription={status:'active'|'past_due'|'canceled'|'expired';paid_until:number};
export type AccessState={active:boolean;source:'trial'|'complimentary'|'subscription'|'none';accessUntil:string;unlimited:boolean;suspended:boolean;trialEndsAt:string;trialDays:number};

function safeUid(uid:string):string {
  if(!/^[a-zA-Z0-9_-]{1,128}$/.test(uid))throw new ApiError(400,'invalid_identity');
  return encodeURIComponent(uid);
}
function iso(ms:number):string {return new Date(ms).toISOString();}
export function resolveAccess(account:Account,grants:Grant[],subscriptions:Subscription[],now=Date.now()):AccessState {
  if(!Number.isFinite(account.trial_ends_at))throw new ApiError(503,'invalid_access_state');
  let until=account.trial_ends_at,source:AccessState['source']='trial',unlimited=false;
  for(const grant of grants) {
    if(grant.grant_kind==='lifetime'){unlimited=true;source='complimentary';continue;}
    if(grant.ends_at!==null && grant.ends_at>until){until=grant.ends_at;source='complimentary';}
  }
  for(const sub of subscriptions) {
    const paidUntil=sub.status==='past_due'?sub.paid_until+PAYMENT_GRACE_MS:sub.paid_until;
    if(sub.status!=='expired' && paidUntil>until && Number.isFinite(paidUntil)){
      until=paidUntil;source='subscription';
    }
  }
  const suspended=account.suspended_at!==null;
  return {active:!suspended&&(unlimited||until>now),source:unlimited||until>now?source:'none',
    accessUntil:iso(until),unlimited,suspended,trialEndsAt:iso(account.trial_ends_at),trialDays:TRIAL_DAYS};
}
async function activeState(env:Env,uid:string,now=Date.now()):Promise<AccessState|null> {
  const account=await env.DB.prepare('SELECT trial_started_at,trial_ends_at,suspended_at,sync_pending FROM access_accounts WHERE owner_uid=?')
    .bind(uid).first<Account&{sync_pending:number}>();
  if(!account)return null;
  if(account.sync_pending!==0)throw new ApiError(503,'access_sync_pending');
  const [g,s]=await Promise.all([
    env.DB.prepare('SELECT grant_kind,ends_at FROM access_grants WHERE owner_uid=? AND revoked_at IS NULL AND starts_at<=? AND (ends_at IS NULL OR ends_at>?)')
      .bind(uid,now,now).all<Grant>(),
    env.DB.prepare("SELECT status,paid_until FROM access_subscriptions WHERE owner_uid=? AND status IN ('active','past_due','canceled')")
      .bind(uid).all<Subscription>()
  ]);
  return resolveAccess(account,g.results,s.results,now);
}
async function verifiedProfile(env:Env,uid:string,token:string):Promise<number> {
  const url='https://firestore.googleapis.com/v1/projects/'+env.FIREBASE_PROJECT_ID+
    '/databases/(default)/documents/users/'+safeUid(uid);
  let response:Response;
  try{response=await fetch(url,{redirect:'manual',headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(12000)});}
  catch{throw new ApiError(503,'access_provision_unavailable');}
  if(response.status===404)throw new ApiError(409,'registration_required');
  if(!response.ok)throw new ApiError(503,'access_profile_read_'+response.status);
  const record=await response.json() as {createTime?:string;fields?:{ownerUid?:{stringValue?:string};deletionState?:{stringValue?:string}}};
  if(record.fields?.ownerUid?.stringValue!==uid)throw new ApiError(403,'invalid_profile');
  if(record.fields?.deletionState?.stringValue==='deleting')throw new ApiError(409,'account_deleting');
  const created=Date.parse(record.createTime||'');
  if(!Number.isFinite(created))throw new ApiError(503,'invalid_profile');
  return created;
}
async function publish(env:Env,uid:string,token:string):Promise<AccessState> {
  const url='https://firestore.googleapis.com/v1/projects/'+env.FIREBASE_PROJECT_ID+
    '/databases/(default)/documents/users/'+safeUid(uid)+'/access/current';
  // Only server credentials can write here. No public client write path exists.
  // Publishing the same effective state is idempotent and avoids unnecessary writes.
  let current:Response;
  try{current=await fetch(url,{redirect:'manual',headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(12000)});}
  catch{throw new ApiError(503,'access_provision_unavailable');}
  if(current.status!==404&&!current.ok)throw new ApiError(503,'access_projection_read_'+current.status);
  // Resolve after reading the projection version. A stale writer cannot replace
  // a newer projection because every PATCH is conditional on that version.
  const state=await activeState(env,uid);
  if(!state)throw new ApiError(503,'access_provision_unavailable');
  await assertNotDeleting(env,uid);
  let precondition='currentDocument.exists=false';
  if(current.ok){
    const saved=await current.json() as {updateTime?:string;fields?:Record<string,{stringValue?:string;booleanValue?:boolean;timestampValue?:string}>};
    if(!saved.updateTime)throw new ApiError(503,'invalid_access_state');
    precondition='currentDocument.updateTime='+encodeURIComponent(saved.updateTime);
    const f=saved.fields;
    if(f?.source?.stringValue===state.source && f?.unlimited?.booleanValue===state.unlimited &&
       f?.suspended?.booleanValue===state.suspended && Date.parse(f?.accessUntil?.timestampValue||'')===Date.parse(state.accessUntil) &&
       Date.parse(f?.trialEndsAt?.timestampValue||'')===Date.parse(state.trialEndsAt))return state;
  }
  const fields={
    ownerUid:{stringValue:uid},schemaVersion:{integerValue:'1'},source:{stringValue:state.source},
    accessUntil:{timestampValue:state.accessUntil},trialEndsAt:{timestampValue:state.trialEndsAt},
    unlimited:{booleanValue:state.unlimited},suspended:{booleanValue:state.suspended},
    updatedAt:{timestampValue:new Date().toISOString()}
  };
  const mask=Object.keys(fields).map(field=>'updateMask.fieldPaths='+encodeURIComponent(field)).join('&');
  let result:Response;
  try{result=await fetch(url+'?'+mask+'&'+precondition,{method:'PATCH',redirect:'manual',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    body:JSON.stringify({fields}),signal:AbortSignal.timeout(12000)});}
  catch{throw new ApiError(503,'access_provision_unavailable');}
  if(!result.ok)throw new ApiError(503,'access_projection_write_'+result.status);
  await assertNotDeleting(env,uid);
  return state;
}
export async function ensureAccess(env:Env,uid:string,adminBearer?:string,principal?:TrialPrincipal):Promise<Response> {
  await assertNotDeleting(env,uid);
  // Prove registration before creating any trial. Firebase Auth alone is insufficient.
  const token=adminBearer||await adminToken(env);
  const created=await verifiedProfile(env,uid,token);
  // The Cron backfills only accounts that predate the beta cutoff.
  // Customer-facing ensure always supplies a trusted Google principal.
  if(adminBearer&&!principal){
    const rollout=await env.DB.prepare('SELECT cutoff_at FROM access_rollout WHERE id=1').first<{cutoff_at:number}>();
    if(!rollout||created>rollout.cutoff_at)throw new ApiError(503,'access_backfill_ineligible');
  }
  if(!principal&&!adminBearer)throw new ApiError(503,'trial_identity_required');
  if(principal&&principal.uid!==uid)throw new ApiError(401,'invalid_identity');
  const allowed=principal?await retainTrialIdentity(env,principal):true;
  return Response.json(await provisionAccess(env,uid,created,token,allowed));
}
async function provisionAccess(env:Env,uid:string,created:number,token:string,allowTrial:boolean):Promise<AccessState> {
  await assertNotDeleting(env,uid);
  const now=Date.now();
  const start=allowTrial?now:now-TRIAL_MS;
  await env.DB.prepare('INSERT OR IGNORE INTO access_accounts (owner_uid,trial_started_at,trial_ends_at,created_at,updated_at) VALUES (?,?,?,?,?)')
    .bind(uid,start,start+TRIAL_MS,now,now).run();
  const rollout=await env.DB.prepare('SELECT cutoff_at,beta_ends_at FROM access_rollout WHERE id=1')
    .first<{cutoff_at:number;beta_ends_at:number}>();
  if(!rollout)throw new ApiError(503,'access_provision_unavailable');
  if(created<=rollout.cutoff_at){
    await env.DB.prepare("INSERT OR IGNORE INTO access_grants(id,owner_uid,grant_kind,starts_at,ends_at,reason,created_at) VALUES(?,?,'complimentary',?,?,?,?)")
      .bind('dev-beta-30d:'+uid,uid,rollout.cutoff_at,rollout.beta_ends_at,'DEV existing-account migration: 30 days',now).run();
  }
  return publish(env,uid,token);
}
export async function assertActiveAccess(env:Env,uid:string):Promise<void> {
  await assertNotDeleting(env,uid);
  // No implicit enrollment via Drive/OAuth: access provisioning requires
  // the signed Google principal supplied by POST /access/ensure.
  const state=await activeState(env,uid);
  if(!state?.active)throw new ApiError(403,'access_expired');
}
/** Called by account deletion after Firestore children are gone, before deleting identity. */
export async function eraseAccess(env:Env,uid:string):Promise<void> {
  await env.DB.prepare('DELETE FROM access_accounts WHERE owner_uid=?').bind(uid).run();
}
