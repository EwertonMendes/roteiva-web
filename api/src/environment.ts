import { environment, isEnvironmentFrontend } from '../../shared/environments.ts';
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

/** Durable identity is sealed during provisioning, never inferred from user data. */
export async function assertDatabaseEnvironment(env: Env): Promise<void> {
  const identity = await env.DB.prepare('SELECT environment FROM deployment_identity WHERE singleton=1').first<{environment:string}>();
  if (identity?.environment !== env.ENVIRONMENT) throw new ApiError(503, 'invalid_database_environment');
}

export function apiOrigin(env: Env): string {
  return environment(env.ENVIRONMENT).apiOrigin;
}

export function allowedFrontend(env:Env,origin:string|null):origin is string {
  try{return origin!==null&&isEnvironmentFrontend(origin,env.ENVIRONMENT);}
  catch{return false;}
}
