import {listCoverImages,coverImage} from './project-covers.ts';
import { ApiError, type Env } from './types.ts';
import { reviewRouter,cleanupExpiredReviews } from './reviews.ts';
import { identity,verifiedTrialPrincipal } from './auth.ts';
import { callback, start, launch, enabled } from './oauth.ts';
import { metadata, disconnect, about } from './drive.ts';
import { listFolders, listFolderItems } from './folders.ts';
import { thumbnail } from './thumbnails.ts';
import { startUpload, completeUpload, authorizeUploadFolder, cleanupUploads } from './uploads.ts';
import { verifyPickerToken } from './picker.ts';
import { deletionStatus, requestDeletion, runPendingDeletions, runDeletionMaintenance } from './account-deletion.ts';
import { ensureAccess, assertActiveAccess } from './access.ts';
import { backfillAccess } from './access-backfill.ts';
import {dropboxEnabled,dropboxStart,dropboxLaunch,dropboxCallback,dropboxConnections,dropboxList,dropboxMetadata,dropboxRevoke,dropboxThumbnail} from './dropbox.ts';
import {startDropboxUpload,appendDropboxUpload,finishDropboxUpload,cleanupDropboxUploads} from './dropbox-uploads.ts';
import {issueDropboxPreview,streamDropboxPreview} from './dropbox-preview.ts';
const headers = {
  'Cache-Control':'no-store', 'Referrer-Policy':'no-referrer',
  'X-Content-Type-Options':'nosniff', 'Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'",
};
/** Route categories are intentionally static: never log tokens, file IDs or URL params. */
function operationName(path:string):string{
  if(path.endsWith('/thumbnail')||path.endsWith('/cover')||path==='/reviews/media')return 'thumbnail_or_media';
  if(path.startsWith('/reviews'))return 'reviews';
  if(path.includes('/uploads/'))return 'drive_upload';
  if(path.startsWith('/integrations/drive'))return 'drive_metadata';
  if(path.startsWith('/integrations/dropbox'))return 'dropbox_metadata';
  if(path.startsWith('/oauth/'))return 'oauth';
  if(path.startsWith('/account/'))return 'account';
  if(path.startsWith('/access/'))return 'access';
  if(path==='/health')return 'health';
  return 'other';
}
export async function handle(request: Request, env: Env): Promise<Response> {
  const began=performance.now();
  const id = crypto.randomUUID();
  const url = new URL(request.url);
  const origin = request.headers.get('Origin');
  let response: Response;
  try {
    if (env.ENVIRONMENT !== 'dev' || env.FIREBASE_PROJECT_ID !== 'roteiva-web-dev' ||
        env.FRONTEND_ORIGIN !== 'https://roteiva-web-dev.web.app' ||
        env.OAUTH_REDIRECT_URI !== 'https://roteiva-api-dev.ewertonmendes9.workers.dev/oauth/drive/callback' ||
        (env.DROPBOX_ENABLED==='true' && env.DROPBOX_OAUTH_REDIRECT_URI !== 'https://roteiva-api-dev.ewertonmendes9.workers.dev/oauth/dropbox/callback')) throw new ApiError(503,'invalid_environment');
    if (origin && origin !== env.FRONTEND_ORIGIN) throw new ApiError(403,'origin_denied');
    // Rate limiting per edge-provided source address prevents one user's traffic
    // from exhausting the entire DEV account's shared 60/minute bucket.
    const sourceIp = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (request.method === 'OPTIONS') {
      if (!origin) throw new ApiError(403,'origin_required');
      response = new Response(null,{status:204,headers:{
        'Access-Control-Allow-Methods':'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers':'Authorization, Content-Type, X-Review-Token','Access-Control-Max-Age':'3600',
      }});
    } else if (!(await ((url.pathname.endsWith('/thumbnail')||url.pathname.endsWith('/cover')||url.pathname==='/reviews/media') ? env.API_THUMB_LIMIT : env.API_RATE_LIMIT)
        .limit({key:'dev:ip:'+sourceIp.slice(0,64)})).success) {
      throw new ApiError(429,'rate_limited');
    } else if (url.pathname === '/health' && request.method === 'GET') {
      await env.DB.prepare('SELECT 1 FROM d1_migrations LIMIT 1').first();
      response = Response.json({status:'ok',environment:'dev'});
      response.headers.set('X-Roteiva-Access-Version','1');
    } else if (url.pathname === '/oauth/dropbox/launch' && request.method === 'GET') {
      response=await dropboxLaunch(request,env);
    } else if (url.pathname === '/oauth/dropbox/callback' && request.method === 'GET') {
      response=await dropboxCallback(request,env);
    } else if (url.pathname === '/oauth/drive/launch' && request.method === 'GET') {
      response = await launch(request,env);
    } else if (url.pathname === '/oauth/drive/callback' && request.method === 'GET') {
      response = await callback(request,env);
     } else if (url.pathname === '/account/deletion/status' && request.method === 'GET') {
      const uid=await identity(request,env);
      response=await deletionStatus(env,uid);
    } else if (url.pathname === '/account/deletion' && request.method === 'POST') {
      if(origin!==env.FRONTEND_ORIGIN)throw new ApiError(403,'origin_required');
      const principal=await verifiedTrialPrincipal(request,env,300);
      if(!(await env.API_RATE_LIMIT.limit({key:'dev:delete:'+principal.uid})).success)throw new ApiError(429,'rate_limited');
      response=await requestDeletion(request,env,principal.uid,principal);
    } else if (url.pathname === '/access/ensure' && request.method === 'POST') {
      if(origin!==env.FRONTEND_ORIGIN)throw new ApiError(403,'origin_required');
      const principal=await verifiedTrialPrincipal(request,env);
      if(!(await env.API_RATE_LIMIT.limit({key:'dev:access:'+principal.uid})).success)throw new ApiError(429,'rate_limited');
      response=await ensureAccess(env,principal.uid,undefined,principal);
    } else if (url.pathname === '/reviews' || url.pathname.startsWith('/reviews/')) {
      if (request.method === 'POST' && origin !== env.FRONTEND_ORIGIN) throw new ApiError(403,'origin_required');
      if (url.pathname!=='/reviews/media'&&!(await env.API_RATE_LIMIT.limit({key:'dev:reviews:'+sourceIp.slice(0,64)})).success) throw new ApiError(429,'rate_limited');
      response = await reviewRouter(request,env,url);
    } else if (url.pathname === '/oauth/dropbox/start' && request.method === 'POST') {
      dropboxEnabled(env);
      if(origin!==env.FRONTEND_ORIGIN)throw new ApiError(403,'origin_required');
      const uid=await identity(request,env);await assertActiveAccess(env,uid);
      response=await dropboxStart(env,uid);
    } else if (/^\/integrations\/dropbox\/[^/]+\/uploads\/start$/.test(url.pathname) && request.method==='POST') {
      dropboxEnabled(env);
      if(origin!==env.FRONTEND_ORIGIN)throw new ApiError(403,'origin_required');
      const uid=await identity(request,env);await assertActiveAccess(env,uid);
      if(!(await env.API_RATE_LIMIT.limit({key:'dev:upload:'+uid})).success)throw new ApiError(429,'rate_limited');
      response=await startDropboxUpload(env,uid,url.pathname.split('/')[3],request);
    } else if (/^\/integrations\/dropbox\/[^/]+\/uploads\/[0-9a-f-]{36}\/(chunk|finish)$/.test(url.pathname) && request.method==='POST') {
      dropboxEnabled(env);
      if(origin!==env.FRONTEND_ORIGIN)throw new ApiError(403,'origin_required');
      const uid=await identity(request,env);await assertActiveAccess(env,uid);
      const parts=url.pathname.split('/');
      const limiter=parts[6]==='chunk'?env.API_UPLOAD_LIMIT:env.API_RATE_LIMIT;
      if(!(await limiter.limit({key:'dev:dropbox-upload:'+uid})).success)throw new ApiError(429,'rate_limited');
      response=parts[6]==='chunk' ? await appendDropboxUpload(env,uid,parts[3],parts[5],request)
        : await finishDropboxUpload(env,uid,parts[3],parts[5],request);
    } else if (url.pathname === '/integrations/dropbox/media') {
      dropboxEnabled(env);
      if(!(await env.API_THUMB_LIMIT.limit({key:'dev:media:'+sourceIp.slice(0,64)})).success)throw new ApiError(429,'rate_limited');
      response=await streamDropboxPreview(env,request,url);
    } else if (/^\/integrations\/dropbox\/[^/]+\/files\/[^/]+\/thumbnail$/.test(url.pathname) && request.method==='GET') {
      dropboxEnabled(env);
      const uid=await identity(request,env);await assertActiveAccess(env,uid);
      if(!(await env.API_THUMB_LIMIT.limit({key:'dev:thumb:'+uid})).success)throw new ApiError(429,'rate_limited');
      const parts=url.pathname.split('/');
      response=await dropboxThumbnail(env,uid,parts[3],decodeURIComponent(parts[5]));
    } else if (/^\/integrations\/dropbox\/[^/]+\/preview-ticket$/.test(url.pathname) && request.method==='POST') {
      dropboxEnabled(env);
      if(origin!==env.FRONTEND_ORIGIN)throw new ApiError(403,'origin_required');
      const uid=await identity(request,env);await assertActiveAccess(env,uid);
      response=await issueDropboxPreview(env,uid,url.pathname.split('/')[3],request);
    } else if (url.pathname === '/integrations/dropbox' && request.method === 'GET') {
      dropboxEnabled(env);
      const uid=await identity(request,env);await assertActiveAccess(env,uid);
      response=await dropboxConnections(env,uid);
    } else if (/^\/integrations\/dropbox\/[^/]+\/folders(?:\/[^/]+\/items)?$/.test(url.pathname) && request.method==='GET') {
      dropboxEnabled(env);
      const uid=await identity(request,env);await assertActiveAccess(env,uid);
      const parts=url.pathname.split('/');
      response=await dropboxList(env,uid,parts[3],parts.length>5?decodeURIComponent(parts[5]):url.searchParams.get('parentId')||'root',
       url.searchParams.get('pageToken'),url.searchParams.get('search'),url.searchParams.get('changesCursor'));
    } else if (/^\/integrations\/dropbox\/[^/]+\/metadata$/.test(url.pathname) && request.method==='GET') {
      dropboxEnabled(env);
      const uid=await identity(request,env);await assertActiveAccess(env,uid);
      const parts=url.pathname.split('/');
      response=Response.json({file:await dropboxMetadata(env,uid,parts[3],url.searchParams.get('fileId')||'')});
    } else if (/^\/integrations\/dropbox\/[^/]+\/disconnect$/.test(url.pathname) && request.method==='POST') {
      dropboxEnabled(env);
      if(origin!==env.FRONTEND_ORIGIN)throw new ApiError(403,'origin_required');
      const uid=await identity(request,env);await assertActiveAccess(env,uid);
      response=await dropboxRevoke(env,uid,url.pathname.split('/')[3]);
    } else if (url.pathname === '/integrations/drive' && request.method === 'GET') {
      const uid = await identity(request,env);
      await assertActiveAccess(env,uid);
      if (!(await env.API_RATE_LIMIT.limit({key:'dev:uid:'+uid})).success) throw new ApiError(429,'rate_limited');
      const rows = await env.DB.prepare('SELECT id,google_email,status,scopes,updated_at FROM drive_connections WHERE owner_uid=? ORDER BY created_at LIMIT 20').bind(uid).all();
      response = Response.json({connections:rows.results});
    } else if (url.pathname === '/oauth/drive/start' && request.method === 'POST') {
      if (origin !== env.FRONTEND_ORIGIN) throw new ApiError(403,'origin_required');
      const uid = await identity(request,env);
      await assertActiveAccess(env,uid);
      if (!(await env.API_RATE_LIMIT.limit({key:'dev:uid:'+uid})).success) throw new ApiError(429,'rate_limited');
      response = await start(env,uid);
    } else if (/^\/integrations\/drive\/[^/]+\/folders(?:\/[^/]+\/items)?$/.test(url.pathname) && request.method==='GET') {
      enabled(env);
      const uid=await identity(request,env);
      await assertActiveAccess(env,uid);
      if (!(await env.API_RATE_LIMIT.limit({key:'dev:uid:'+uid})).success) throw new ApiError(429,'rate_limited');
      const parts=url.pathname.split('/');
      response=parts.length===5
        ? await listFolders(env,uid,parts[3],url.searchParams.get('parentId')||'root',url.searchParams.get('pageToken'))
        : await listFolderItems(env,uid,parts[3],parts[5],url.searchParams.get('pageToken'),fetch,url.searchParams.get('search'));
    } else if (/^\/integrations\/drive\/[^/]+\/(?:cover-images|files\/[^/]+\/cover)$/.test(url.pathname) && request.method==='GET') {
      enabled(env);
      const uid=await identity(request,env);
      await assertActiveAccess(env,uid);
      if(!(await env.API_THUMB_LIMIT.limit({key:'dev:uid:'+uid})).success)throw new ApiError(429,'rate_limited');
      const parts=url.pathname.split('/');
      response=parts[4]==='cover-images'?await listCoverImages(env,uid,parts[3],url.searchParams):await coverImage(env,uid,parts[3],parts[5]);
    } else if (/^\/integrations\/drive\/[^/]+\/picker\/verify$/.test(url.pathname) && request.method==='POST') {
      enabled(env);
      if(origin!==env.FRONTEND_ORIGIN)throw new ApiError(403,'origin_required');
      const uid=await identity(request,env);
      await assertActiveAccess(env,uid);
      if(!(await env.API_RATE_LIMIT.limit({key:'dev:upload:'+uid})).success)throw new ApiError(429,'rate_limited');
      response=await verifyPickerToken(env,uid,url.pathname.split('/')[3],request);
    } else if (/^\/integrations\/drive\/[^/]+\/folders\/[^/]+\/uploads(?:\/(?:complete|authorize))?$/.test(url.pathname) && request.method==='POST') {
      enabled(env);
      if(origin!==env.FRONTEND_ORIGIN)throw new ApiError(403,'origin_required');
      const uid=await identity(request,env);
      await assertActiveAccess(env,uid);
      if(!(await env.API_RATE_LIMIT.limit({key:'dev:upload:'+uid})).success)throw new ApiError(429,'rate_limited');
      const parts=url.pathname.split('/');
      response=parts[7]==='authorize' ? await authorizeUploadFolder(env,uid,parts[3],parts[5],request) : parts[7]==='complete'
        ? await completeUpload(env,uid,parts[3],parts[5],request)
        : await startUpload(env,uid,parts[3],parts[5],request);
    } else if (/^\/integrations\/drive\/[^/]+\/files\/[^/]+\/thumbnail$/.test(url.pathname) && request.method==='GET') {
      enabled(env);
      const uid=await identity(request,env);
      await assertActiveAccess(env,uid);
      if (!(await env.API_THUMB_LIMIT.limit({key:'dev:uid:'+uid})).success) throw new ApiError(429,'rate_limited');
      const parts=url.pathname.split('/');
      response=await thumbnail(env,uid,parts[3],parts[5],url.searchParams.get('ticket'));
    } else if (/^\/integrations\/drive\/[^/]+\/(metadata|disconnect|about)$/.test(url.pathname)) {
      enabled(env);
      const uid = await identity(request,env);
      await assertActiveAccess(env,uid);
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
    if(known && (url.pathname==='/access/ensure'||error.code.startsWith('access_')||error.code.startsWith('admin_')))
      console.error(JSON.stringify({event:'access_request_denied',code:error.code,status:error.status}));
    const status = known ? error.status : 503;
    response = Response.json({error:{
      code:known ? error.code : 'service_unavailable',
      requestId:id,
      ...(known&&url.pathname.startsWith('/reviews/')&&error.asset?{asset:error.asset}:{})
    }},{status});
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
  // Wall-clock duration is not CPU time; compare against Cloudflare CPU percentiles.
  // Do not log raw URLs, headers, request/response bodies or identities.
  const elapsed=Math.round(performance.now()-began);
  if(result.status>=500||elapsed>=2000||Math.random()<0.05){
    console.info(JSON.stringify({event:'api_operation',operation:operationName(url.pathname),
      method:request.method,status:result.status,wallMs:elapsed,
      ...(result.status>=500?{requestId:id}:{})}));
  }
  return result;
}
export default {fetch:handle, scheduled(controller:ScheduledController,env:Env,ctx:ExecutionContext){
  // Revocations and deletion progress are security-critical: retain the one-minute cadence.
  ctx.waitUntil((async()=>{
    if(controller.cron==='* * * * *'){
      await runPendingDeletions(env);
      try{await cleanupExpiredReviews(env);}catch{console.error(JSON.stringify({event:'review_revocation_retry'}));}
    }else if(controller.cron==='*/15 * * * *'){
      try{await runDeletionMaintenance(env);}catch{console.error(JSON.stringify({event:'deletion_maintenance_retry'}));}
      try{await backfillAccess(env);}catch(error){console.error(JSON.stringify({event:'access_backfill_retry',code:error instanceof ApiError?error.code:'dependency_failure'}));}
      try{await cleanupUploads(env);}catch{console.error(JSON.stringify({event:'drive_upload_retention_retry'}));}
      try{await cleanupDropboxUploads(env);}catch{console.error(JSON.stringify({event:'dropbox_upload_retention_retry'}));}
    }else{
      console.error(JSON.stringify({event:'unexpected_cron_trigger'}));
    }
  })());
}};
