import {adminToken} from './firebase-admin.ts';
import {ApiError,type Env} from './types.ts';
import {ensureAccess} from './access.ts';

/** One profile per Cron invocation. No public administrative route. */
export async function backfillAccess(env:Env):Promise<void> {
 const rollout=await env.DB.prepare('SELECT cursor,completed_at FROM access_rollout WHERE id=1')
   .first<{cursor:string|null;completed_at:number|null}>();
 if(!rollout||rollout.completed_at!==null)return;
 const token=await adminToken(env);
 const query=new URLSearchParams({pageSize:'1','mask.fieldPaths':'ownerUid'});
 query.append('mask.fieldPaths','deletionState');
 if(rollout.cursor)query.set('pageToken',rollout.cursor);
 const response=await fetch('https://firestore.googleapis.com/v1/projects/'+env.FIREBASE_PROJECT_ID+
   '/databases/(default)/documents/users?'+query,{redirect:'error',headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(12000)});
 if(!response.ok)throw new ApiError(503,'access_backfill_list_'+response.status);
 const data=await response.json() as {documents?:{name:string;fields?:{ownerUid?:{stringValue?:string};deletionState?:{stringValue?:string}}}[];nextPageToken?:string};
 for(const profile of data.documents||[]){
   const uid=profile.name.split('/').at(-1)||'';
   if(profile.fields?.deletionState?.stringValue==='deleting')continue;
   if(!/^[A-Za-z0-9_-]{1,128}$/.test(uid)||profile.fields?.ownerUid?.stringValue!==uid)
     throw new ApiError(503,'invalid_backfill_profile');
   const deleting=await env.DB.prepare('SELECT 1 FROM account_deletions WHERE owner_uid=?').bind(uid).first();
   if(!deleting)await ensureAccess(env,uid,token);
 }
 // Advance only after successful provisioning. Retrying never renews a benefit.
 await env.DB.prepare('UPDATE access_rollout SET cursor=?,processed=processed+?,completed_at=?,updated_at=? WHERE id=1 AND cursor IS ? AND completed_at IS NULL')
   .bind(data.nextPageToken||null,data.documents?.length||0,data.nextPageToken?null:Date.now(),Date.now(),rollout.cursor).run();
}
