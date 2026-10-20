import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { ApiError, type Env } from './types.ts';
import type {TrialPrincipal} from './trial-identity.ts';
const firebaseKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'));
export async function verifyFirebase(token: string, project: string, keys: JWTVerifyGetKey = firebaseKeys, maxAgeSeconds?:number): Promise<string> {
  try {
    const { payload } = await jwtVerify(token, keys, {
      algorithms:['RS256'], audience:project,
      issuer:'https://securetoken.google.com/' + project,
      requiredClaims:['sub','iat','exp','auth_time'], clockTolerance:5,
    });
    const now = Math.floor(Date.now()/1000);
    if (!payload.sub || payload.sub.length > 128 || typeof payload.iat !== 'number' ||
        payload.iat > now + 5 || typeof payload.auth_time !== 'number' || payload.auth_time > now + 5 ||
        (maxAgeSeconds!==undefined && now-payload.auth_time>maxAgeSeconds)) throw new Error();
    return payload.sub;
  } catch { throw new ApiError(401, 'invalid_identity'); }
}
/**
 * Only a cryptographically verified Firebase token may provide the Google
 * identity used for one-time trials. Never trust the client profile email.
 */
export async function verifiedTrialPrincipal(request:Request,env:Env,maxAgeSeconds?:number,
  keys:JWTVerifyGetKey=firebaseKeys):Promise<TrialPrincipal>{
  const header=request.headers.get('Authorization')||'';
  if(!header.startsWith('Bearer ')||header.length>8192)
    throw new ApiError(401,'authentication_required');
  try{
    const {payload}=await jwtVerify(header.slice(7),keys,{
      algorithms:['RS256'],audience:env.FIREBASE_PROJECT_ID,
      issuer:'https://securetoken.google.com/'+env.FIREBASE_PROJECT_ID,
      requiredClaims:['sub','iat','exp','auth_time'],clockTolerance:5
    });
    const now=Math.floor(Date.now()/1000);
    if(typeof payload.sub!=='string'||!payload.sub||payload.sub.length>128||
       !/^[A-Za-z0-9_-]+$/.test(payload.sub)||
       typeof payload.iat!=='number'||payload.iat>now+5||
       typeof payload.auth_time!=='number'||payload.auth_time>now+5||
       (maxAgeSeconds!==undefined&&now-payload.auth_time>maxAgeSeconds)||
       payload.email_verified!==true||typeof payload.email!=='string')
      throw new Error('invalid verified claims');
    const firebase=payload.firebase as {sign_in_provider?:unknown;identities?:{'google.com'?:unknown}}|undefined;
    const google=firebase?.identities?.['google.com'];
    if(firebase?.sign_in_provider!=='google.com'||!Array.isArray(google)||
       typeof google[0]!=='string'||!google[0]||google[0].length>300)
      throw new Error('google provider identity missing');
    return {uid:payload.sub,verifiedEmail:payload.email,googleSubject:google[0]};
  }catch{throw new ApiError(401,'invalid_identity');}
}
export async function identity(request: Request, env: Env, maxAgeSeconds?:number): Promise<string> {
  const header = request.headers.get('Authorization') || '';
  if (!header.startsWith('Bearer ') || header.length > 8192) throw new ApiError(401, 'authentication_required');
  return verifyFirebase(header.slice(7), env.FIREBASE_PROJECT_ID,firebaseKeys,maxAgeSeconds);
}
