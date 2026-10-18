import { ApiError, type Env } from './types.ts';
import { identity } from './auth.ts';
import { callback, start, launch, enabled } from './oauth.ts';
import { metadata, disconnect, about } from './drive.ts';
import { listFolders, listFolderItems } from './folders.ts';
import { deletionStatus, requestDeletion, assertNotDeleting, runPendingDeletions } from './account-deletion.ts';
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
    // Rate limiting per edge-provided source address prevents one user's traffic
    // from exhausting the entire DEV account's shared 60/minute bucket.
    const sourceIp = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (!(await env.API_RATE_LIMIT.limit({key:'dev:ip:'+sourceIp.slice(0,64)})).success) throw new ApiError(429,'rate_limited');
    if (request.method === 'OPTIONS') {
      if (!origin) throw new ApiError(403,'origin_required');
      response = new Response(null,{status:204,headers:{
        'Access-Control-Allow-Methods':'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Max-Age':'600',
      }});
    } else if (url.pathname === '/health' && request.method === 'GET') {
      await env.DB.prepare('SELECT 1 FROM d1_migrations LIMIT 1').first();
      response = Response.json({status:'ok',environment:'dev'});
    } else if (url.pathname === '/oauth/drive/launch' && request.method === 'GET') {
      response = await launch(request,env);
    } else if (url.pathname === '/oauth/drive/callback' && request.method === 'GET') {
      response = await callback(request,env);
     } else if (url.pathname === '/account/deletion/status' && request.method === 'GET') {
      const uid=await identity(request,env);
      response=await deletionStatus(env,uid);
    } else if (url.pathname === '/account/deletion' && request.method === 'POST') {
      if(origin!==env.FRONTEND_ORIGIN)throw new ApiError(403,'origin_required');
      const uid=await identity(request,env,300);
      if(!(await env.API_RATE_LIMIT.limit({key:'dev:delete:'+uid})).success)throw new ApiError(429,'rate_limited');
      response=await requestDeletion(request,env,uid);
    } else if (url.pathname === '/integrations/drive' && request.method === 'GET') {
      const uid = await identity(request,env);
      await assertNotDeleting(env,uid);
      if (!(await env.API_RATE_LIMIT.limit({key:'dev:uid:'+uid})).success) throw new ApiError(429,'rate_limited');
      const rows = await env.DB.prepare('SELECT id,google_email,status,scopes,updated_at FROM drive_connections WHERE owner_uid=? ORDER BY created_at LIMIT 20').bind(uid).all();
      response = Response.json({connections:rows.results});
    } else if (url.pathname === '/oauth/drive/start' && request.method === 'POST') {
      if (origin !== env.FRONTEND_ORIGIN) throw new ApiError(403,'origin_required');
      const uid = await identity(request,env);
      await assertNotDeleting(env,uid);
      if (!(await env.API_RATE_LIMIT.limit({key:'dev:uid:'+uid})).success) throw new ApiError(429,'rate_limited');
      response = await start(env,uid);
    } else if (/^\/integrations\/drive\/[^/]+\/folders(?:\/[^/]+\/items)?$/.test(url.pathname) && request.method==='GET') {
      enabled(env);
      const uid=await identity(request,env);
      await assertNotDeleting(env,uid);
      if (!(await env.API_RATE_LIMIT.limit({key:'dev:uid:'+uid})).success) throw new ApiError(429,'rate_limited');
      const parts=url.pathname.split('/');
      response=parts.length===5
        ? await listFolders(env,uid,parts[3],url.searchParams.get('parentId')||'root',url.searchParams.get('pageToken'))
        : await listFolderItems(env,uid,parts[3],parts[5],url.searchParams.get('pageToken'));
    } else if (/^\/integrations\/drive\/[^/]+\/(metadata|disconnect|about)$/.test(url.pathname)) {
      enabled(env);
      const uid = await identity(request,env);
      await assertNotDeleting(env,uid);
      if (!(await env.API_RATE_LIMIT.limit({key:'dev:uid:'+uid})).success) throw new ApiError(429,'rate_limited');
      const parts = url.pathname.split('/');
      if (parts[4] === 'about' && request.method === 'GET') {
        response = await about(env,uid,parts[3]);
      } else if (parts[4] === 'metadata' && request.method === 'GET') {
        response = await metadata(env,uid,parts[3],url.searchParams.get('fileId') || '');
      } else if (parts[4] === 'disconnect' && request.method === 'POST') {
        if (origin !== env.FRONTEND_ORIGIN) throw new ApiError(403,'origin_required');
        response = await disconnect(env,uid,parts[3]);
      } else throw new ApiError(405,'method_not_allowed');
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
export default {fetch:handle, scheduled(_controller:ScheduledController,env:Env,ctx:ExecutionContext){ctx.waitUntil(runPendingDeletions(env));}};
