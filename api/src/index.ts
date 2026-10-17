import { ApiError, type Env } from './types.ts';
import { identity } from './auth.ts';
import { callback, start } from './oauth.ts';
const headers = {
  'Cache-Control':'no-store', 'Referrer-Policy':'no-referrer',
  'X-Content-Type-Options':'nosniff', 'Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'",
};
export async function handle(request: Request, env: Env): Promise<Response> {
  const id = crypto.randomUUID();
  const url = new URL(request.url);
  const origin = request.headers.get('Origin');
  let response: Response;
  try {
    if (env.ENVIRONMENT !== 'dev' || env.FIREBASE_PROJECT_ID !== 'roteiva-web-dev' ||
        env.FRONTEND_ORIGIN !== 'https://roteiva-web-dev.web.app' ||
        env.OAUTH_REDIRECT_URI !== 'https://roteiva-api-dev.ewertonmendes9.workers.dev/oauth/drive/callback') throw new ApiError(503,'invalid_environment');
    if (origin && origin !== env.FRONTEND_ORIGIN) throw new ApiError(403,'origin_denied');
    if (request.method === 'OPTIONS') {
      if (!origin) throw new ApiError(403,'origin_required');
      response = new Response(null,{status:204,headers:{
        'Access-Control-Allow-Methods':'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Max-Age':'600',
      }});
    } else if (url.pathname === '/health' && request.method === 'GET') {
      await env.DB.prepare('SELECT 1 FROM d1_migrations LIMIT 1').first();
      response = Response.json({status:'ok',environment:'dev'});
    } else if (url.pathname === '/oauth/drive/callback' && request.method === 'GET') {
      response = await callback(request,env);
    } else if (url.pathname === '/integrations/drive' && request.method === 'GET') {
      const uid = await identity(request,env);
      const rows = await env.DB.prepare('SELECT id,google_email,status,scopes,updated_at FROM drive_connections WHERE owner_uid=? ORDER BY created_at LIMIT 20').bind(uid).all();
      response = Response.json({connections:rows.results});
    } else if (url.pathname === '/oauth/drive/start' && request.method === 'POST') {
      if (origin !== env.FRONTEND_ORIGIN) throw new ApiError(403,'origin_required');
      const uid = await identity(request,env);
      response = await start(env,uid);
    } else {
      throw new ApiError(404,'not_found');
    }
  } catch (error) {
    const known = error instanceof ApiError;
    const status = known ? error.status : 503;
    response = Response.json({error:{code:known ? error.code : 'service_unavailable',requestId:id}},{status});
    // Only categorical events. Never emit Request, URL, exception, headers or provider bodies.
    if (!known) console.error(JSON.stringify({event:'dependency_failure',requestId:id}));
  }
  const result = new Response(response.body,response);
  Object.entries(headers).forEach(([name,value])=>result.headers.set(name,value));
  result.headers.set('X-Request-Id',id);
  result.headers.set('Vary','Origin');
  if (origin === env.FRONTEND_ORIGIN) {
    result.headers.set('Access-Control-Allow-Origin',origin);
    result.headers.set('Access-Control-Allow-Credentials','true');
  }
  return result;
}
export default {fetch:handle};
