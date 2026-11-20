import { environment, isEnvironmentFrontend, legacyProdFrontendOrigin } from '../../shared/environments.ts';
import { ApiError, type Env } from './types.ts';

export function assertEnvironment(env: Env): void {
  try {
    const expected = environment(env.ENVIRONMENT);
    if (env.FIREBASE_PROJECT_ID !== expected.projectId || env.FRONTEND_ORIGIN !== expected.frontendOrigin ||
        env.OAUTH_REDIRECT_URI !== expected.apiOrigin + '/oauth/drive/callback' ||
        (env.DROPBOX_ENABLED === 'true' && env.DROPBOX_OAUTH_REDIRECT_URI !== expected.apiOrigin + '/oauth/dropbox/callback'))
      throw new Error('Environment mismatch');
  } catch { throw new ApiError(503, 'invalid_environment'); }
}

/** The deployment identity is immutable for the lifetime of a Worker version.
 * On media GETs, a 30-second isolate-local memo avoids burning a D1 read on
 * every video segment; configuration changes still revalidate after deployment.
 */
const deploymentMediaChecks=new Map<string,number>();
export async function assertDatabaseEnvironment(env: Env,media=false): Promise<void> {
  const key=env.ENVIRONMENT+'|'+env.FIREBASE_PROJECT_ID;
  if(media&&(deploymentMediaChecks.get(key)||0)>Date.now())return;
  const identity = await env.DB.prepare('SELECT environment FROM deployment_identity WHERE singleton=1').first<{environment:string}>();
  if (identity?.environment !== env.ENVIRONMENT) throw new ApiError(503, 'invalid_database_environment');
  if(media){
    if(deploymentMediaChecks.size>16)deploymentMediaChecks.clear();
    deploymentMediaChecks.set(key,Date.now()+30000);
  }
}

export function apiOrigin(env: Env): string {
  return environment(env.ENVIRONMENT).apiOrigin;
}

/** Only the protected cutover workflow supplies an expiry. */
export function legacyFrontendAllowed(env:Env,now=Date.now()):boolean {
  if(env.ENVIRONMENT!=='prod'||!env.LEGACY_FRONTEND_UNTIL)return false;
  const until=Date.parse(env.LEGACY_FRONTEND_UNTIL);
  return until>now&&until-now<=24*60*60*1000;
}

export function allowedFrontend(env:Env,origin:string|null):origin is string {
  try{return origin!==null&&(isEnvironmentFrontend(origin,env.ENVIRONMENT)||
    (origin===legacyProdFrontendOrigin&&legacyFrontendAllowed(env)));}
  catch{return false;}
}
