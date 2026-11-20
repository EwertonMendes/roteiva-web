import {publishBillingAccess} from './access.ts';
import {ApiError,type Env} from './types.ts';

/** Run in the same D1 batch as the subscription status/paid_until transition. */
export function queueBillingProjection(env:Env,uid:string,now:number):D1PreparedStatement[]{
  return [
    env.DB.prepare('INSERT INTO billing_access_projections(owner_uid,version,next_attempt_at) VALUES(?,?,?) '+
      'ON CONFLICT(owner_uid) DO UPDATE SET version=excluded.version,next_attempt_at=excluded.next_attempt_at,attempts=0,last_error_code=NULL')
      .bind(uid,crypto.randomUUID(),now),
    env.DB.prepare('UPDATE access_accounts SET sync_pending=1 WHERE owner_uid=?').bind(uid)
  ];
}

export async function flushBillingProjection(env:Env,uid?:string):Promise<void>{
  const pending=await (uid?
    env.DB.prepare('SELECT owner_uid,version,attempts FROM billing_access_projections WHERE owner_uid=?').bind(uid):
    env.DB.prepare('SELECT owner_uid,version,attempts FROM billing_access_projections WHERE next_attempt_at<=? AND attempts<10 ORDER BY next_attempt_at LIMIT 1').bind(Date.now()))
    .first<{owner_uid:string;version:string;attempts:number}>();
  if(!pending||pending.attempts>=10)return;
  try{
    await publishBillingAccess(env,pending.owner_uid,pending.version);
    await env.DB.batch([
      env.DB.prepare('UPDATE access_accounts SET sync_pending=0 WHERE owner_uid=? AND EXISTS (SELECT 1 FROM billing_access_projections WHERE owner_uid=? AND version=?)')
        .bind(pending.owner_uid,pending.owner_uid,pending.version),
      env.DB.prepare('DELETE FROM billing_access_projections WHERE owner_uid=? AND version=?')
        .bind(pending.owner_uid,pending.version),
    ]);
  }catch(error){
    const code=error instanceof ApiError?error.code:'billing_projection_unavailable';
    if(code==='account_deleting'||code==='billing_projection_superseded')return;
    await env.DB.prepare('UPDATE billing_access_projections SET attempts=attempts+1,next_attempt_at=?,last_error_code=? WHERE owner_uid=? AND version=? AND attempts=?')
      .bind(Date.now()+Math.min(3600000,60000*2**pending.attempts),code,pending.owner_uid,pending.version,pending.attempts).run();
    if(pending.attempts===9)console.error(JSON.stringify({event:'billing_projection_review'}));
  }
}
