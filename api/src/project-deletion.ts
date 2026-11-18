import {ApiError,type Env} from './types.ts';
import {adminToken,deletionConfigured} from './firebase-admin.ts';
import {assertNotDeleting} from './account-deletion.ts';
import {assertActiveAccess} from './access.ts';
import {closeProjectReviews} from './reviews.ts';
import {eraseProjectLibraryChunk} from './library-deletion.ts';
import {fenceProject,eraseProjectFirestoreChunk} from './project-deletion-firestore.ts';

type Phase='locking'|'reviews'|'uploads'|'library'|'previews'|'firestore'|'completed'|'manual_review';
type Job={owner_uid:string;project_id:number;operation_id:string;phase:Phase;attempts:number;lease_id:string|null;lease_until:number;next_attempt_at:number};
const PHRASE='EXCLUIR PROJETO';
const MAX_ATTEMPTS=10;
const LIMIT=15;
const validProject=(id:number)=>Number.isSafeInteger(id)&&id>0;
const row=(env:Env,uid:string,id:number)=>env.DB.prepare('SELECT * FROM project_deletions WHERE owner_uid=? AND project_id=?')
  .bind(uid,id).first<Job>();
function state(job:Job|null){
  return job?{status:job.phase==='completed'?'completed':job.phase==='manual_review'?'manual_review':'processing',
    phase:job.phase,operationId:job.operation_id}:{status:'idle' as const};
}
export async function assertProjectNotDeleting(env:Env,uid:string,projectId:number){
  if(!validProject(projectId))throw new ApiError(400,'invalid_project');
  if(await row(env,uid,projectId))throw new ApiError(409,'project_deleting');
}
export async function projectDeletionStatus(env:Env,uid:string,id:number):Promise<Response>{
  if(!validProject(id))throw new ApiError(400,'invalid_project');
  const job=await row(env,uid,id);
  if(job&&job.phase!=='completed'&&job.phase!=='manual_review'){
    // Status checks can resume a pending job when the tab remains open.
    await advanceProjectDeletion(env,uid,id);
  }
  return Response.json(state(await row(env,uid,id)),{headers:{'Cache-Control':'no-store'}});
}
async function ownedProject(request:Request,env:Env,uid:string,id:number):Promise<string>{
  const url='https://firestore.googleapis.com/v1/projects/'+encodeURIComponent(env.FIREBASE_PROJECT_ID)+
    '/databases/(default)/documents/users/'+encodeURIComponent(uid)+'/projects/'+id;
  let response:Response;
  try{response=await fetch(url,{headers:{Authorization:request.headers.get('Authorization')||''},
    redirect:'manual',signal:AbortSignal.timeout(12000)});}
  catch{throw new ApiError(503,'project_authorization_unavailable');}
  if([401,403,404].includes(response.status))throw new ApiError(404,'project_not_found');
  if(!response.ok)throw new ApiError(503,'project_authorization_unavailable');
  const data=await response.json() as {fields?:{ownerUid?:{stringValue?:string};name?:{stringValue?:string}}};
  if(data.fields?.ownerUid?.stringValue!==uid||!data.fields?.name?.stringValue)
    throw new ApiError(404,'project_not_found');
  return data.fields.name.stringValue;
}
export async function requestProjectDeletion(request:Request,env:Env,uid:string,id:number){
  if(!validProject(id))throw new ApiError(400,'invalid_project');
  if(!deletionConfigured(env))throw new ApiError(503,'project_deletion_unavailable');
  await assertNotDeleting(env,uid);
  await assertActiveAccess(env,uid);
  let input:unknown;
  try{input=await request.json();}catch{throw new ApiError(400,'project_confirmation_invalid');}
  const value=input as {phrase?:unknown;name?:unknown;acknowledged?:unknown}|null;
  if(!value||typeof value!=='object'||Array.isArray(value)||
    value.phrase!==PHRASE||value.acknowledged!==true||
    typeof value.name!=='string'||value.name.length>200)
    throw new ApiError(400,'project_confirmation_invalid');
  const existing=await row(env,uid,id);
  if(!existing){
    const name=await ownedProject(request,env,uid,id);
    if(name!==value.name)throw new ApiError(409,'project_confirmation_mismatch');
    // Fail closed before creating the durable, irreversible request.
    await adminToken(env);
    const timestamp=Date.now();
    await env.DB.prepare("INSERT OR IGNORE INTO project_deletions(owner_uid,project_id,operation_id,phase,next_attempt_at,created_at,updated_at) VALUES(?,?,?,'locking',?,?,?)")
      .bind(uid,id,crypto.randomUUID(),timestamp,timestamp,timestamp).run();
  }
  await advanceProjectDeletion(env,uid,id);
  const job=await row(env,uid,id);
  if(!job)throw new ApiError(503,'project_deletion_unavailable');
  return Response.json(state(job),{status:job.phase==='completed'?200:202,headers:{'Cache-Control':'no-store'}});
}
async function advancePhase(env:Env,job:Job):Promise<Phase|null>{
  const {owner_uid:uid,project_id:id}=job;
  switch(job.phase){
    case 'locking':
      await fenceProject(env,uid,id);
      return 'reviews';
    case 'reviews':
      return await closeProjectReviews(env,uid,id)?'uploads':null;
    case 'uploads':
      await env.DB.batch([
        env.DB.prepare('DELETE FROM drive_upload_attempts WHERE owner_uid=? AND project_id=?').bind(uid,id),
        env.DB.prepare('DELETE FROM dropbox_upload_attempts WHERE owner_uid=? AND project_id=?').bind(uid,id),
      ]);
      return 'library';
    case 'library': {
      // Capture only project-owned preview keys before deleting virtual references.
      await env.DB.prepare(`INSERT OR IGNORE INTO project_deletion_previews
        (owner_uid,project_id,provider,connection_id,file_id,source_revision)
        SELECT ?,?,o.provider,o.connection_id,o.file_id,o.source_revision
        FROM optimized_media_previews o
        JOIN library_assets a ON a.provider=o.provider AND a.connection_id=o.connection_id AND a.file_id=o.file_id
        JOIN libraries l ON l.id=a.library_id
        WHERE o.owner_uid=? AND l.owner_uid=? AND l.project_id=?`)
        .bind(uid,id,uid,uid,id).run();
      return await eraseProjectLibraryChunk(env,uid,id)?'previews':null;
    }
    case 'previews':
      return await erasePreviewCandidate(env,uid,id)?'firestore':null;
    case 'firestore':
      return await eraseProjectFirestoreChunk(env,uid,id)?'completed':null;
    default:return null;
  }
}
async function erasePreviewCandidate(env:Env,uid:string,id:number):Promise<boolean>{
  const candidate=await env.DB.prepare('SELECT * FROM project_deletion_previews WHERE owner_uid=? AND project_id=? LIMIT 1')
    .bind(uid,id).first<{provider:string;connection_id:string;file_id:string;source_revision:string}>();
  if(!candidate)return true;
  const {provider,connection_id:conn,file_id:file,source_revision:revision}=candidate;
  const reused=await env.DB.prepare(`SELECT 1 FROM library_assets a JOIN libraries l ON l.id=a.library_id
    WHERE l.owner_uid=? AND a.provider=? AND a.connection_id=? AND a.file_id=? LIMIT 1`)
    .bind(uid,provider,conn,file).first();
  const reviewUse=await env.DB.prepare(`SELECT 1 FROM review_assets a JOIN review_requests r ON r.id=a.review_id
    WHERE r.owner_uid=? AND a.provider=? AND a.connection_id=? AND a.file_id=? LIMIT 1`)
    .bind(uid,provider,conn,file).first();
  const preview=!reused&&!reviewUse ? await env.DB.prepare(`SELECT stream_uid FROM optimized_media_previews
    WHERE owner_uid=? AND provider=? AND connection_id=? AND file_id=? AND source_revision=?`)
    .bind(uid,provider,conn,file,revision).first<{stream_uid:string|null}>():null;
  if(preview?.stream_uid){
    if(!env.STREAM)throw new ApiError(503,'project_stream_cleanup_unavailable');
    try{await env.STREAM.video(preview.stream_uid).delete();}
    catch(error){
      // An already removed Stream object is idempotently complete.
      if((error as {status?:number}).status!==404)throw new ApiError(503,'project_stream_cleanup_unavailable');
    }
  }
  await env.DB.batch([
    ...(!reused&&!reviewUse?[env.DB.prepare(`DELETE FROM optimized_media_previews WHERE owner_uid=? AND provider=? AND connection_id=? AND file_id=? AND source_revision=?`)
      .bind(uid,provider,conn,file,revision)]:[]),
    env.DB.prepare(`DELETE FROM project_deletion_previews WHERE owner_uid=? AND project_id=? AND provider=? AND connection_id=? AND file_id=? AND source_revision=?`)
      .bind(uid,id,provider,conn,file,revision)
  ]);
  return false;
}
/** One bounded stage per call, leased and retryable after worker/network failures. */
export async function advanceProjectDeletion(env:Env,uid:string,id:number):Promise<void>{
  const timestamp=Date.now(),lease=crypto.randomUUID();
  const claim=await env.DB.prepare(`UPDATE project_deletions SET lease_id=?,lease_until=?
    WHERE owner_uid=? AND project_id=? AND phase NOT IN ('completed','manual_review')
    AND lease_until<? AND next_attempt_at<=?`)
    .bind(lease,timestamp+90000,uid,id,timestamp,timestamp).run();
  if(claim.meta.changes!==1)return;
  try{
    const job=await row(env,uid,id);
    if(!job||job.lease_id!==lease)return;
    try{
      const next=await advancePhase(env,job);
      await env.DB.prepare(`UPDATE project_deletions SET phase=?,attempts=0,error_code=NULL,next_attempt_at=?,updated_at=?,
        completed_at=CASE WHEN ?='completed' THEN ? ELSE completed_at END
        WHERE owner_uid=? AND project_id=? AND lease_id=? AND phase=?`)
        .bind(next||job.phase,Date.now(),Date.now(),next||job.phase,Date.now(),uid,id,lease,job.phase).run();
    }catch(error){
      const attempts=job.attempts+1;
      const code=error instanceof ApiError?error.code:'project_deletion_step_failed';
      await env.DB.prepare(`UPDATE project_deletions SET phase=?,attempts=?,error_code=?,next_attempt_at=?,updated_at=?
        WHERE owner_uid=? AND project_id=? AND lease_id=?`)
        .bind(attempts>=MAX_ATTEMPTS?'manual_review':job.phase,attempts,code,
          Date.now()+Math.min(3600000,2000*2**Math.min(attempts,9)),Date.now(),uid,id,lease).run();
      console.error(JSON.stringify({event:'project_deletion_retry',phase:job.phase,code}));
    }
  }finally{
    await env.DB.prepare('UPDATE project_deletions SET lease_id=NULL,lease_until=0 WHERE owner_uid=? AND project_id=? AND lease_id=?')
      .bind(uid,id,lease).run();
  }
}
export async function runPendingProjectDeletions(env:Env):Promise<void>{
  const now=Date.now();
  const jobs=await env.DB.prepare(`SELECT owner_uid,project_id FROM project_deletions
    WHERE phase NOT IN ('completed','manual_review') AND lease_until<? AND next_attempt_at<=?
    ORDER BY next_attempt_at,updated_at LIMIT ?`).bind(now,now,LIMIT>1?1:LIMIT).all<{owner_uid:string;project_id:number}>();
  for(const job of jobs.results)await advanceProjectDeletion(env,job.owner_uid,job.project_id);
}
