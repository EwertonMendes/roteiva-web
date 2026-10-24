import {ApiError,type Env} from './types.ts';
import {context,decrypt,encrypt} from './crypto.ts';

export async function beginExchange(env:Env,uid:string,provider:'google_drive'|'dropbox'='google_drive'):Promise<string>{
  const id=crypto.randomUUID();
  await env.DB.prepare('INSERT INTO oauth_exchange_guards(exchange_id,owner_uid,started_at,provider) VALUES(?,?,?,?)')
    .bind(id,uid,Date.now(),provider).run();
  return id;
}
export async function rememberGrant(env:Env,uid:string,id:string,token:string):Promise<void>{
  const encrypted=await encrypt(env,token,context(env,uid,id,'oauth_revocation'));
  await env.DB.prepare('UPDATE oauth_exchange_guards SET encrypted_token=? WHERE exchange_id=? AND owner_uid=?')
    .bind(encrypted,id,uid).run();
}
export async function finishExchange(env:Env,uid:string,id:string):Promise<void>{
  await env.DB.prepare('DELETE FROM oauth_exchange_guards WHERE exchange_id=? AND owner_uid=?').bind(id,uid).run();
}
export async function revokeGuard(env:Env,uid:string):Promise<boolean>{
  const row=await env.DB.prepare('SELECT exchange_id,encrypted_token,started_at,provider FROM oauth_exchange_guards WHERE owner_uid=? LIMIT 1')
    .bind(uid).first<{exchange_id:string;encrypted_token:string|null;started_at:number;provider:'google_drive'|'dropbox'}>();
  if(!row)return true;
  if(!row.encrypted_token){
    // A process may have died after Google issued a credential but before it
    // could persist it. Never infer revocation or complete deletion in that case.
    if(Date.now()-row.started_at>120000)throw new ApiError(503,'oauth_exchange_unresolved');
    return false;
  }
  const token=await decrypt(env,row.encrypted_token,context(env,uid,row.exchange_id,'oauth_revocation'));
  let response:Response;
  if(row.provider==='dropbox'){
    try{response=await fetch('https://api.dropboxapi.com/2/auth/token/revoke',{
      method:'POST',redirect:'manual',
      headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(10000)})}
    catch{throw new ApiError(503,'dropbox_revocation_unavailable');}
    if(!response.ok&&response.status!==401)throw new ApiError(503,'dropbox_revocation_unavailable');
  }else{
    try{response=await fetch('https://oauth2.googleapis.com/revoke',{method:'POST',redirect:'manual',
      headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token}),signal:AbortSignal.timeout(10000)});}
    catch{throw new ApiError(503,'google_revocation_unavailable');}
    if(!response.ok){
      const body=await response.json().catch(()=>({})) as {error?:string};
      if(response.status!==400||body.error!=='invalid_token')throw new ApiError(503,'google_revocation_unavailable');
    }
  }
  await finishExchange(env,uid,row.exchange_id);
  return false; // Yield after one remote revocation; recheck on the next tick.
}
