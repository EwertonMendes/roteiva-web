import { ApiError, type Env } from './types.ts';
import { adminToken, deletionConfigured, deleteIdentity, deleteFirestoreChunk, deleteRoot, lockAccount } from './firebase-admin.ts';
import { decrypt, context } from './crypto.ts';

type Phase='locking'|'revoking'|'firestore'|'identity'|'completed'|'manual_review';
type Job={owner_uid:string;operation_id:string;phase:Phase;attempts:number;lease_id:string|null;lease_until:number;next_attempt_at:number};
const PHRASE='EXCLUIR MINHA CONTA';
const MAX_ATTEMPTS=10;

export async function assertNotDeleting(env:Env,uid:string):Promise<void>{
  const job=await env.DB.prepare('SELECT phase FROM account_deletions WHERE owner_uid=?').bind(uid).first<{phase:Phase}>();
  if(job)throw new ApiError(409,'account_deleting');
}
export async function deletionStatus(env:Env,uid:string):Promise<Response>{
  const row=await env.DB.prepare('SELECT operation_id,phase,created_at FROM account_deletions WHERE owner_uid=?')
    .bind(uid).first<{operation_id:string;phase:Phase;created_at:number}>();
  return Response.json({available:deletionConfigured(env),operation:row?{id:row.operation_id,
    status:row.phase==='completed'?'completed':row.phase==='manual_review'?'manual_review':'processing'}:null});
}
export async function requestDeletion(request:Request,env:Env,uid:string):Promise<Response>{
  if(!deletionConfigured(env))throw new ApiError(503,'deletion_unavailable');
  let payload:unknown;
  try{payload=await request.json();}catch{throw new ApiError(400,'invalid_confirmation');}
  if(!payload||typeof payload!=='object'||Array.isArray(payload)||
    (payload as {phrase?:unknown}).phrase!==PHRASE ||
    (payload as {acknowledged?:unknown}).acknowledged!==true)throw new ApiError(400,'invalid_confirmation');
  // Before accepting an irreversible request, confirm admin credentials work.
  await adminToken(env);
  const now=Date.now(),operationId=crypto.randomUUID();
  await env.DB.prepare("INSERT OR IGNORE INTO account_deletions (owner_uid,operation_id,phase,next_attempt_at,created_at,updated_at) VALUES (?,?,'locking',?,?,?)")
    .bind(uid,operationId,now,now,now).run();
  // No success is claimed before Firestore has been locked. Any crash is
  // recoverable by cron; follow-up calls are idempotent for this UID.
  await advanceDeletion(env,uid);
  const job=await env.DB.prepare('SELECT operation_id,phase FROM account_deletions WHERE owner_uid=?')
    .bind(uid).first<{operation_id:string;phase:Phase}>();
  if(!job||job.phase==='locking')throw new ApiError(503,'deletion_not_locked');
  return Response.json({status:job.phase==='completed'?'completed':'processing',operationId:job.operation_id},{status:job.phase==='completed'?200:202});
}
async function changePhase(env:Env,job:Job,lease:string,phase:Phase){
  const now=Date.now();
  const res=await env.DB.prepare('UPDATE account_deletions SET phase=?,attempts=0,next_attempt_at=?,updated_at=?,completed_at=CASE WHEN ?=\'completed\' THEN ? ELSE completed_at END,error_code=NULL WHERE owner_uid=? AND lease_id=? AND phase=?')
    .bind(phase,now,now,phase,now,job.owner_uid,lease,job.phase).run();
  if(res.meta.changes!==1)throw new ApiError(503,'deletion_lease_lost');
}
async function revokeConnections(env:Env,uid:string):Promise<void>{
  // A Google Drive credential is never deleted until revocation succeeds.
  // Disabled credentials are rejected by all authenticated API routes.
  const rows=await env.DB.prepare('SELECT * FROM drive_connections WHERE owner_uid=? LIMIT 100')
    .bind(uid).all<{id:string;google_account_id:string;encrypted_refresh_token:string|null}>();
  for(const row of rows.results){
    await env.DB.prepare("UPDATE drive_connections SET status='revocation_pending',encrypted_access_token=NULL,access_token_expires_at=0,access_token_version=NULL,refresh_lease_id=NULL,refresh_lease_until=0,revision=revision+1,updated_at=? WHERE owner_uid=? AND id=?")
      .bind(Date.now(),uid,row.id).run();
    if(row.encrypted_refresh_token){
      const token=await decrypt(env,row.encrypted_refresh_token,context(env,uid,row.google_account_id));
      let response:Response;
      try{response=await fetch('https://oauth2.googleapis.com/revoke',{
        method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
        body:new URLSearchParams({token}),signal:AbortSignal.timeout(10000)});}
      catch{throw new ApiError(503,'google_revocation_unavailable');}
      if(!response.ok){
        const code=(await response.json().catch(()=>({}))) as {error?:string};
        if(code.error!=='invalid_token')throw new ApiError(503,'google_revocation_unavailable');
      }
    }
    await env.DB.prepare('DELETE FROM drive_connections WHERE owner_uid=? AND id=?').bind(uid,row.id).run();
  }
  const outstanding=await env.DB.prepare('SELECT 1 FROM drive_connections WHERE owner_uid=? LIMIT 1').bind(uid).first();
  if(outstanding)throw new ApiError(503,'drive_connections_remaining');
  await env.DB.prepare('DELETE FROM oauth_transactions WHERE owner_uid=?').bind(uid).run();
}
async function runPhase(env:Env,job:Job,lease:string):Promise<void>{
  const uid=job.owner_uid;
  if(job.phase==='locking'){
    const token=await adminToken(env);
    await lockAccount(env,uid,token);
    await changePhase(env,job,lease,'revoking');
  }else if(job.phase==='revoking'){
    await revokeConnections(env,uid);
    await changePhase(env,job,lease,'firestore');
  }else if(job.phase==='firestore'){
    const token=await adminToken(env);
    const empty=await deleteFirestoreChunk(env,uid,token,20);
    if(empty)await changePhase(env,job,lease,'identity');
  }else if(job.phase==='identity'){
    const token=await adminToken(env);
    await deleteIdentity(env,uid,token);
    // Keep the Firestore deletion marker until Auth has been removed.
    await deleteRoot(env,uid,token);
    await changePhase(env,job,lease,'completed');
  }
}
export async function advanceDeletion(env:Env,uid:string):Promise<void>{
  if(!deletionConfigured(env))return;
  const now=Date.now(),lease=crypto.randomUUID();
  const claimed=await env.DB.prepare("UPDATE account_deletions SET lease_id=?,lease_until=? WHERE owner_uid=? AND phase NOT IN ('completed','manual_review') AND lease_until<? AND next_attempt_at<=?")
    .bind(lease,now+60000,uid,now,now).run();
  if(claimed.meta.changes!==1)return;
  try{
    const job=await env.DB.prepare('SELECT * FROM account_deletions WHERE owner_uid=? AND lease_id=?')
      .bind(uid,lease).first<Job>();
    if(!job)return;
    try{await runPhase(env,job,lease);}
    catch(error){
      const code=error instanceof ApiError?error.code:'deletion_step_failed';
      const count=job.attempts+1;
      const delay=Math.min(3600000,30000*Math.pow(2,Math.min(count,7)));
      await env.DB.prepare("UPDATE account_deletions SET attempts=?,phase=?,error_code=?,next_attempt_at=?,updated_at=? WHERE owner_uid=? AND lease_id=?")
        .bind(count,count>=MAX_ATTEMPTS?'manual_review':job.phase,code,Date.now()+delay,Date.now(),uid,lease).run();
      // Never log UID, credentials, email or raw provider errors.
      console.error(JSON.stringify({event:'account_deletion_retry',phase:job.phase,code}));
    }
  }finally{
    await env.DB.prepare('UPDATE account_deletions SET lease_id=NULL,lease_until=0 WHERE owner_uid=? AND lease_id=?')
      .bind(uid,lease).run();
  }
}
export async function runPendingDeletions(env:Env):Promise<void>{
  if(!deletionConfigured(env))return;
  const now=Date.now();
  const rows=await env.DB.prepare("SELECT owner_uid FROM account_deletions WHERE phase NOT IN ('completed','manual_review') AND lease_until<? AND next_attempt_at<=? ORDER BY created_at LIMIT 10")
    .bind(now,now).all<{owner_uid:string}>();
  for(const row of rows.results){
    try{await advanceDeletion(env,row.owner_uid);}
    catch{
      // Do not let one database/lease failure starve every other account.
      console.error(JSON.stringify({event:'account_deletion_scheduler_failure'}));
    }
  }
  // Minimal operational tombstone: 24h for idempotent status/recovery.
  await env.DB.prepare("DELETE FROM account_deletions WHERE phase='completed' AND completed_at<?")
    .bind(now-86400000).run();
}
