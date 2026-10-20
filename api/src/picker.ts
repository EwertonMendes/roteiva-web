import {ApiError,type Env} from './types.ts';
import {connection} from './repository.ts';
import {DRIVE_SCOPE} from './google.ts';
import {uploadBody} from './uploads.ts';

/** Inspect the newly issued GIS token before it may reach Picker. Never persist it. */
export async function verifyPickerToken(env:Env,uid:string,connectionId:string,request:Request,
  fetcher:typeof fetch=fetch):Promise<Response>{
  if(!env.GOOGLE_CLIENT_ID)throw new ApiError(503,'picker_not_configured');
  const data=await uploadBody(request) as {accessToken?:unknown}|null;
  if(!data||typeof data.accessToken!=='string'||data.accessToken.length<10||data.accessToken.length>4096)
    throw new ApiError(400,'invalid_picker_token');
  const row=await connection(env,uid,connectionId);
  if(row.status!=='connected')throw new ApiError(409,'reconnect_required');
  // Fixed Google endpoint, manual redirects, no logging of URL or provider body.
  const url=new URL('https://oauth2.googleapis.com/tokeninfo');
  let response:Response;
  try{response=await fetcher(url,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({access_token:data.accessToken}),redirect:'manual',signal:AbortSignal.timeout(10000)});}
  catch{throw new ApiError(503,'picker_verification_unavailable');}
  if(!response.ok)throw new ApiError(401,'invalid_picker_token');
  const info=await response.json() as {aud?:unknown;azp?:unknown;sub?:unknown;scope?:unknown;expires_in?:unknown};
  if(info.aud!==env.GOOGLE_CLIENT_ID || (info.azp!==undefined&&info.azp!==env.GOOGLE_CLIENT_ID))
    throw new ApiError(403,'picker_account_mismatch');
  const scopes=new Set(typeof info.scope==='string'?info.scope.trim().split(/\s+/):[]);
  if(scopes.size!==2||!scopes.has('openid')||!scopes.has(DRIVE_SCOPE) ||
     !Number.isFinite(Number(info.expires_in))||Number(info.expires_in)<60)
    throw new ApiError(403,'picker_scope_mismatch');
  let subject=info.sub;
  if(typeof subject!=='string'){
    // OIDC UserInfo guarantees sub with openid; do not depend on optional tokeninfo fields.
    let user:Response;
    try{user=await fetcher('https://openidconnect.googleapis.com/v1/userinfo',{headers:{Authorization:'Bearer '+data.accessToken},
      redirect:'manual',signal:AbortSignal.timeout(10000)});}
    catch{throw new ApiError(503,'picker_verification_unavailable');}
    if(!user.ok)throw new ApiError(401,'invalid_picker_token');
    subject=(await user.json() as {sub?:unknown}).sub;
  }
  if(subject!==row.google_account_id)throw new ApiError(403,'picker_account_mismatch');
  const current=await connection(env,uid,connectionId);
  if(current.status!=='connected'||current.revision!==row.revision)throw new ApiError(409,'connection_changed');
  return Response.json({verified:true});
}
