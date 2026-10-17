import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { ApiError, type Env } from './types.ts';
const firebaseKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'));
export async function verifyFirebase(token: string, project: string, keys: JWTVerifyGetKey = firebaseKeys): Promise<string> {
  try {
    const { payload } = await jwtVerify(token, keys, {
      algorithms:['RS256'], audience:project,
      issuer:'https://securetoken.google.com/' + project,
      requiredClaims:['sub','iat','exp','auth_time'], clockTolerance:5,
    });
    const now = Math.floor(Date.now()/1000);
    if (!payload.sub || payload.sub.length > 128 || typeof payload.iat !== 'number' ||
        payload.iat > now + 5 || typeof payload.auth_time !== 'number' || payload.auth_time > now + 5) throw new Error();
    return payload.sub;
  } catch { throw new ApiError(401, 'invalid_identity'); }
}
export async function identity(request: Request, env: Env): Promise<string> {
  const header = request.headers.get('Authorization') || '';
  if (!header.startsWith('Bearer ') || header.length > 8192) throw new ApiError(401, 'authentication_required');
  return verifyFirebase(header.slice(7), env.FIREBASE_PROJECT_ID);
}
