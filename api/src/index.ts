import {assertEnvironment,assertDatabaseEnvironment,allowedFrontend,legacyFrontendAllowed} from './environment.ts';
import {applyResponsePolicy} from './response-policy.ts';
import {listCoverImages,coverImage,dropboxCoverImage,fastCoverPreview} from './project-covers.ts';
import { ApiError, type Env } from './types.ts';
import { reviewRouter,cleanupExpiredReviews } from './reviews.ts';
import {DRIVE_SCOPE} from './google.ts';
import { identity,verifiedTrialPrincipal } from './auth.ts';
import { feedbackRouter } from './feedback.ts';
import { assertNotDeleting } from './account-deletion.ts';
import { callback, start, launch, enabled } from './oauth.ts';
import { metadata, disconnect, about } from './drive.ts';
import { listFolders, listFolderItems } from './folders.ts';
import { thumbnail } from './thumbnails.ts';
import {libraryRouter} from './library.ts';
import {projectDeletionStatus,requestProjectDeletion,runPendingProjectDeletions,drainProjectDeletion} from './project-deletion.ts';
import {streamIngest} from './stream-preview.ts';
import { startUpload, completeUpload, authorizeUploadFolder, cleanupUploads } from './uploads.ts';
import { verifyPickerToken,pickerConfiguration,pickedDriveFile } from './picker.ts';
import { deletionStatus, requestDeletion, runPendingDeletions, runDeletionMaintenance } from './account-deletion.ts';
import { monitorDeletionBacklog } from './deletion-monitor.ts';
import { ensureAccess, assertActiveAccess } from './access.ts';
import {billingPlansResponse,billingStatusResponse} from './billing.ts';
import {ingestAsaasWebhook} from './billing-webhook.ts';
import {createCheckout} from './billing-checkout.ts';
import {abandonUnpaidCheckout,checkoutRecoveryRouted} from './billing-checkout-change.ts';
import {requestCheckoutReturnCheck} from './billing-return.ts';
import {flushBillingProjection} from './billing-projection.ts';
import {readBillingJson} from './billing-webhook.ts';
import {asaasConfigured,billingRouted,checkoutRouted} from './billing-asaas.ts';
import {cancelRenewal,retryBillingCancellation} from './billing-management.ts';
import {reconcileBilling} from './billing-reconciliation.ts';
import {recoverUpgrade,requestUpgrade,upgradeRouted} from './billing-upgrade.ts';
import { backfillAccess } from './access-backfill.ts';
import {dropboxEnabled,dropboxStart,dropboxLaunch,dropboxCallback,dropboxConnections,dropboxList,dropboxMetadata,dropboxRevoke,dropboxThumbnail} from './dropbox.ts';
import {startDropboxUpload,appendDropboxUpload,finishDropboxUpload,cleanupDropboxUploads} from './dropbox-uploads.ts';
import {issueDropboxPreview,streamDropboxPreview} from './dropbox-preview.ts';
// A media player can request several chunks within seconds. Access checks
// remain mandatory on cache misses and non-media routes, but successful grants
// are reused very briefly for the same environment and signed-in owner.
// Account revocation may take at most 15 seconds to become visible to a player.
const mediaAccessChecks=new Map<string,number>();
async function requireLibraryAccess(env:Env,uid:string,streaming:boolean){
 const key=env.ENVIRONMENT+'|'+uid;
 if(streaming&&(mediaAccessChecks.get(key)||0)>Date.now())return;
 await assertActiveAccess(env,uid);
 if(streaming){
  if(mediaAccessChecks.size>=256)mediaAccessChecks.clear();
  mediaAccessChecks.set(key,Date.now()+15000);
 }
}
/** Route categories are intentionally static: never log tokens, file IDs or URL params. */
function mediaRoute(path:string){return path.endsWith('/thumbnail')||path.endsWith('/cover')||path==='/reviews/media'||path==='/integrations/dropbox/media'||/^\/(library\/projects\/[0-9]+\/nodes\/[0-9a-f-]{36}|reviews\/[0-9a-f-]{36})\/content$/.test(path);}
function libraryBatchRoute(path:string){return /^\/library\/projects\/[0-9]+\/(imports|inspect|structure|uploads\/destination)$/.test(path);}
function operationName(path:string):string{
  if(mediaRoute(path))return 'thumbnail_or_media';
  if(path==='/feedback')return 'feedback';
  if(path.startsWith('/billing/'))return 'billing';
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
export async function handle(request: Request, env: Env, ctx?:ExecutionContext): Promise<Response> {
  const began=performance.now();
  const id = crypto.randomUUID();
  const url = new URL(request.url);
  const origin = request.headers.get('Origin');
  let response: Response;
  try {
    assertEnvironment(env);
    if (origin && !allowedFrontend(env,origin)) throw new ApiError(403,'origin_denied');
    // Rate limiting per edge-provided source address prevents one user's traffic
    // from exhausting the environment account's shared 60/minute bucket.
    const sourceIp = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (request.method !== 'OPTIONS') {
      const limiter=mediaRoute(url.pathname) ? env.API_THUMB_LIMIT : libraryBatchRoute(url.pathname)?env.API_UPLOAD_LIMIT:env.API_RATE_LIMIT;
      if (!(await limiter.limit({key:env.ENVIRONMENT+':ip:'+sourceIp.slice(0,64)})).success) throw new ApiError(429,'rate_limited');
      await assertDatabaseEnvironment(env,mediaRoute(url.pathname));
    }
    if (request.method === 'OPTIONS') {
      if (!origin) throw new ApiError(403,'origin_required');
      response = new Response(null,{status:204,headers:{
        'Access-Control-Allow-Methods':'GET, HEAD, POST, OPTIONS',
        'Access-Control-Allow-Headers':'Authorization, Content-Type, X-Review-Token, X-Review-Session, Range','Access-Control-Max-Age':'3600',
      }});
    } else if (url.pathname === '/health' && request.method === 'GET') {
      response = Response.json({status:'ok',environment:env.ENVIRONMENT});
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
      if(!allowedFrontend(env,origin))throw new ApiError(403,'origin_required');
      const principal=await verifiedTrialPrincipal(request,env,300);
      if(!(await env.API_RATE_LIMIT.limit({key:env.ENVIRONMENT+':delete:'+principal.uid})).success)throw new ApiError(429,'rate_limited');
      response=await requestDeletion(request,env,principal.uid,principal);
    } else if (billingRouted(env) && url.pathname === '/billing/plans' && request.method === 'GET') {
      // Keep public commercial price discovery unchanged. Private canary offers
       // require an explicitly presented and verified Firebase PROD token.
       const uid=request.headers.has('Authorization')?await identity(request,env):undefined;
       response=billingPlansResponse(env,uid);
    } else if (checkoutRouted(env) && url.pathname === '/billing/checkout' && request.method === 'POST') {
      if(!allowedFrontend(env,origin))throw new ApiError(403,'origin_required');
      const uid=await identity(request,env);
      await assertNotDeleting(env,uid);
      if(!(await env.API_RATE_LIMIT.limit({key:env.ENVIRONMENT+':billing:'+uid})).success)throw new ApiError(429,'rate_limited');
      response=await createCheckout(request,env,uid);
    } else if (checkoutRecoveryRouted(env) && url.pathname==='/billing/checkout/abandon' && request.method==='POST') {
      if(!allowedFrontend(env,origin))throw new ApiError(403,'origin_required');
      const uid=await identity(request,env);
      await assertNotDeleting(env,uid);
      if(!(await env.API_RATE_LIMIT.limit({key:env.ENVIRONMENT+':billing:'+uid})).success)throw new ApiError(429,'rate_limited');
      response=await abandonUnpaidCheckout(request,env,uid);
      if(response.status===202){
        ctx?.waitUntil(reconcileBilling(env).catch(()=>console.error(JSON.stringify({event:'billing_checkout_close_retry'}))));
      }
    } else if (upgradeRouted(env) && url.pathname==='/billing/upgrade' && request.method==='POST') {
      if(!allowedFrontend(env,origin))throw new ApiError(403,'origin_required');
      const uid=await identity(request,env);
      await assertNotDeleting(env,uid);
      if(!(await env.API_RATE_LIMIT.limit({key:env.ENVIRONMENT+':billing:'+uid})).success)throw new ApiError(429,'rate_limited');
      response=await requestUpgrade(env,uid,request);
    } else if (asaasConfigured(env) && url.pathname==='/billing/cancel' && request.method==='POST') {
      if(!allowedFrontend(env,origin))throw new ApiError(403,'origin_required');
      const uid=await identity(request,env);
      await assertNotDeleting(env,uid);
      if(!(await env.API_RATE_LIMIT.limit({key:env.ENVIRONMENT+':billing:'+uid})).success)throw new ApiError(429,'rate_limited');
      response=await cancelRenewal(request,env,uid);
    } else if (billingRouted(env) && url.pathname==='/billing/return/verify' && request.method==='POST') {
      if(!allowedFrontend(env,origin))throw new ApiError(403,'origin_required');
      const uid=await identity(request,env);
      await assertNotDeleting(env,uid);
      if(!(await env.API_RATE_LIMIT.limit({key:env.ENVIRONMENT+':billing-return:'+uid})).success)
        throw new ApiError(429,'rate_limited');
      const data=await readBillingJson(request,1024) as {intentId?:unknown}|null;
      if(!data||typeof data!=='object'||Object.keys(data).length!==1||!Object.hasOwn(data,'intentId'))
        throw new ApiError(400,'billing_invalid_intent');
      response=await requestCheckoutReturnCheck(env,uid,data.intentId);
      if(response.status===202){
        // The leased inbox verifies the provider; do not wait for the cron.
        ctx?.waitUntil(reconcileBilling(env).catch(()=>console.error(JSON.stringify({event:'billing_return_reconciliation_retry'}))));
      }else if(response.ok){
        // The financial event can be settled while its Firestore projection
        // still awaits a retry. Publishing this user's pending projection is safe.
        ctx?.waitUntil(flushBillingProjection(env,uid).catch(()=>console.error(JSON.stringify({event:'billing_return_projection_retry'}))));
      }
    } else if (billingRouted(env) && url.pathname === '/billing/status' && request.method === 'GET') {
      const uid=await identity(request,env);
      await assertNotDeleting(env,uid);
      response=await billingStatusResponse(env,uid,Date.now(),url.searchParams.get('paymentCursor'));
    } else if (billingRouted(env) && url.pathname === '/billing/webhooks/asaas' && request.method === 'POST') {
      response=await ingestAsaasWebhook(request,env);
      // Acknowledge only after durable storage, then reconcile promptly.
      // Scheduled recovery remains the independent fallback.
      if(response.ok)ctx?.waitUntil(reconcileBilling(env).catch(()=>console.error(JSON.stringify({event:'billing_webhook_immediate_retry'}))));
    } else if (url.pathname === '/access/ensure' && request.method === 'POST') {
      if(!allowedFrontend(env,origin))throw new ApiError(403,'origin_required');
      const principal=await verifiedTrialPrincipal(request,env);
      if(!(await env.API_RATE_LIMIT.limit({key:env.ENVIRONMENT+':access:'+principal.uid})).success)throw new ApiError(429,'rate_limited');
      response=await ensureAccess(env,principal.uid,undefined,principal);
    } else if (url.pathname==='/feedback' && (request.method==='POST'||request.method==='GET')) {
      if(request.method==='POST'&&!allowedFrontend(env,origin))throw new ApiError(403,'origin_required');
      const principal=await verifiedTrialPrincipal(request,env);
      await assertNotDeleting(env,principal.uid);
      response=await feedbackRouter(request,env,principal.uid,principal.verifiedEmail);
    } else if (/^\/stream\/ingest\/[-_A-Za-z0-9.]+$/.test(url.pathname)) {
      // Signed ingest requests come from the Stream transcoder, not a browser.
      // Do not require a Firebase token for this narrowly scoped temporary URL.
      response=await streamIngest(request,env,url.pathname.slice('/stream/ingest/'.length));
    } else if (new RegExp('^/projects/[1-9][0-9]{0,14}/deletion$').test(url.pathname) && ['GET','POST'].includes(request.method)) {
      if(request.method==='POST'&&!allowedFrontend(env,origin))throw new ApiError(403,'origin_required');
      const uid=await identity(request,env);
      await assertActiveAccess(env,uid);
      const projectId=Number(url.pathname.split('/')[2]);
      if(!(await env.API_RATE_LIMIT.limit({key:env.ENVIRONMENT+':project-delete:'+uid})).success)
        throw new ApiError(429,'rate_limited');
      if(request.method==='POST'){
        response=await requestProjectDeletion(request,env,uid,projectId);
        // Continue cleanup after responding to the browser. The D1 lease guards
        // against simultaneous cron/status requests; the cron is the fallback
        // when an isolate ends or the user navigates away.
        ctx?.waitUntil(drainProjectDeletion(env,uid,projectId)
          .catch(error=>console.error(JSON.stringify({event:'project_deletion_background_failure',
            code:error instanceof ApiError?error.code:'dependency_failure'}))));
      }else response=await projectDeletionStatus(env,uid,projectId);
    } else if (url.pathname.startsWith('/library/')) {
      if(env.VIRTUAL_LIBRARY_ENABLED!=='true')throw new ApiError(404,'not_found');
      if(request.method==='POST'&&!allowedFrontend(env,origin))throw new ApiError(403,'origin_required');
      const uid=await identity(request,env);await requireLibraryAccess(env,uid,mediaRoute(url.pathname));
      response=await libraryRouter(request,env,uid,url);
    } else if (url.pathname === '/reviews' || url.pathname.startsWith('/reviews/')) {
      if (request.method === 'POST' && !allowedFrontend(env,origin)) throw new ApiError(403,'origin_required');
      if (url.pathname!=='/reviews/media'&&!(await env.API_RATE_LIMIT.limit({key:env.ENVIRONMENT+':reviews:'+sourceIp.slice(0,64)})).success) throw new ApiError(429,'rate_limited');
      response = await reviewRouter(request,env,url);
    } else if (url.pathname === '/oauth/dropbox/start' && request.method === 'POST') {
      dropboxEnabled(env);
      if(!allowedFrontend(env,origin))throw new ApiError(403,'origin_required');
      const uid=await identity(request,env);await assertActiveAccess(env,uid);
      response=await dropboxStart(env,uid);
    } else if (/^\/integrations\/dropbox\/[^/]+\/uploads\/start$/.test(url.pathname) && request.method==='POST') {
      dropboxEnabled(env);
      if(!allowedFrontend(env,origin))throw new ApiError(403,'origin_required');
      const uid=await identity(request,env);await assertActiveAccess(env,uid);
      if(!(await env.API_RATE_LIMIT.limit({key:env.ENVIRONMENT+':upload:'+uid})).success)throw new ApiError(429,'rate_limited');
      response=await startDropboxUpload(env,uid,url.pathname.split('/')[3],request);
    } else if (/^\/integrations\/dropbox\/[^/]+\/uploads\/[0-9a-f-]{36}\/(chunk|finish)$/.test(url.pathname) && request.method==='POST') {
      dropboxEnabled(env);
      if(!allowedFrontend(env,origin))throw new ApiError(403,'origin_required');
      const uid=await identity(request,env);await assertActiveAccess(env,uid);
      const parts=url.pathname.split('/');
      const limiter=parts[6]==='chunk'?env.API_UPLOAD_LIMIT:env.API_RATE_LIMIT;
      if(!(await limiter.limit({key:env.ENVIRONMENT+':dropbox-upload:'+uid})).success)throw new ApiError(429,'rate_limited');
      response=parts[6]==='chunk' ? await appendDropboxUpload(env,uid,parts[3],parts[5],request)
        : await finishDropboxUpload(env,uid,parts[3],parts[5],request);
    } else if (url.pathname === '/integrations/dropbox/media') {
      dropboxEnabled(env);
      response=await streamDropboxPreview(env,request,url);
    } else if (/^\/integrations\/dropbox\/[^/]+\/files\/[^/]+\/cover$/.test(url.pathname) && request.method==='GET') {
       dropboxEnabled(env);
       const uid=await identity(request,env);await assertActiveAccess(env,uid);
       if(!(await env.API_THUMB_LIMIT.limit({key:env.ENVIRONMENT+':thumb:'+uid})).success)throw new ApiError(429,'rate_limited');
       const parts=url.pathname.split('/');
       response=await dropboxCoverImage(env,uid,parts[3],decodeURIComponent(parts[5]));
    } else if (/^\/integrations\/dropbox\/[^/]+\/files\/[^/]+\/thumbnail$/.test(url.pathname) && request.method==='GET') {
      dropboxEnabled(env);
      const uid=await identity(request,env);await assertActiveAccess(env,uid);
      if(!(await env.API_THUMB_LIMIT.limit({key:env.ENVIRONMENT+':thumb:'+uid})).success)throw new ApiError(429,'rate_limited');
      const parts=url.pathname.split('/');
      response=await dropboxThumbnail(env,uid,parts[3],decodeURIComponent(parts[5]));
    } else if (/^\/integrations\/dropbox\/[^/]+\/preview-ticket$/.test(url.pathname) && request.method==='POST') {
      dropboxEnabled(env);
      if(!allowedFrontend(env,origin))throw new ApiError(403,'origin_required');
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
      if(!allowedFrontend(env,origin))throw new ApiError(403,'origin_required');
      const uid=await identity(request,env);await assertActiveAccess(env,uid);
      response=await dropboxRevoke(env,uid,url.pathname.split('/')[3]);
    } else if (url.pathname === '/integrations/drive' && request.method === 'GET') {
      const uid = await identity(request,env);
      await assertActiveAccess(env,uid);
      if (!(await env.API_RATE_LIMIT.limit({key:env.ENVIRONMENT+':uid:'+uid})).success) throw new ApiError(429,'rate_limited');
      const rows = await env.DB.prepare('SELECT id,google_email,status,scopes,updated_at FROM drive_connections WHERE owner_uid=? ORDER BY created_at,id').bind(uid).all();
      response = Response.json({connections:rows.results.map(row=>{
        const c=row as {status?:string;scopes?:string};
        return env.VIRTUAL_LIBRARY_ENABLED==='true'&&c.status==='connected'&&c.scopes?.trim()!==DRIVE_SCOPE?{...row,status:'minimum_reconsent_required'}:row;
      })});
    } else if (url.pathname === '/oauth/drive/start' && request.method === 'POST') {
      if (!allowedFrontend(env,origin)) throw new ApiError(403,'origin_required');
      const uid = await identity(request,env);
      await assertActiveAccess(env,uid);
      if (!(await env.API_RATE_LIMIT.limit({key:env.ENVIRONMENT+':uid:'+uid})).success) throw new ApiError(429,'rate_limited');
      response = await start(env,uid);
    } else if (/^\/integrations\/drive\/[^/]+\/folders(?:\/[^/]+\/items)?$/.test(url.pathname) && request.method==='GET') {
      enabled(env);
      const uid=await identity(request,env);
      await assertActiveAccess(env,uid);
      if (!(await env.API_RATE_LIMIT.limit({key:env.ENVIRONMENT+':uid:'+uid})).success) throw new ApiError(429,'rate_limited');
      const parts=url.pathname.split('/');
      response=parts.length===5
        ? await listFolders(env,uid,parts[3],url.searchParams.get('parentId')||'root',url.searchParams.get('pageToken'))
        : await listFolderItems(env,uid,parts[3],parts[5],url.searchParams.get('pageToken'),fetch,url.searchParams.get('search'));
    } else if (/^\/integrations\/drive\/[^/]+\/(?:cover-images|files\/[^/]+\/(?:cover|preview))$/.test(url.pathname) && request.method==='GET') {
      enabled(env);
      const uid=await identity(request,env);
      await assertActiveAccess(env,uid);
      if(!(await env.API_THUMB_LIMIT.limit({key:env.ENVIRONMENT+':uid:'+uid})).success)throw new ApiError(429,'rate_limited');
      const parts=url.pathname.split('/');
      response=parts[4]==='cover-images'?await listCoverImages(env,uid,parts[3],url.searchParams)
       :parts[6]==='preview'?await fastCoverPreview(env,uid,parts[3],parts[5])
       :await coverImage(env,uid,parts[3],parts[5]);
    } else if (/^\/integrations\/drive\/[^/]+\/picker\/config$/.test(url.pathname) && request.method==='GET'&&env.VIRTUAL_LIBRARY_ENABLED==='true') {
      enabled(env);
      const uid=await identity(request,env);await assertActiveAccess(env,uid);
      response=await pickerConfiguration(env,uid,url.pathname.split('/')[3]);
    } else if (/^\/integrations\/drive\/[^/]+\/picker\/(verify|file)$/.test(url.pathname) && request.method==='POST') {
      enabled(env);
      if(!allowedFrontend(env,origin))throw new ApiError(403,'origin_required');
      const uid=await identity(request,env);
      await assertActiveAccess(env,uid);
      if(!(await env.API_RATE_LIMIT.limit({key:env.ENVIRONMENT+':upload:'+uid})).success)throw new ApiError(429,'rate_limited');
      if(url.pathname.endsWith('/file')&&env.VIRTUAL_LIBRARY_ENABLED!=='true')throw new ApiError(404,'not_found');
      response=url.pathname.endsWith('/file')?await pickedDriveFile(env,uid,url.pathname.split('/')[3],request):await verifyPickerToken(env,uid,url.pathname.split('/')[3],request);
    } else if (/^\/integrations\/drive\/[^/]+\/folders\/[^/]+\/uploads(?:\/(?:complete|authorize))?$/.test(url.pathname) && request.method==='POST') {
      enabled(env);
      if(!allowedFrontend(env,origin))throw new ApiError(403,'origin_required');
      const uid=await identity(request,env);
      await assertActiveAccess(env,uid);
      if(!(await env.API_RATE_LIMIT.limit({key:env.ENVIRONMENT+':upload:'+uid})).success)throw new ApiError(429,'rate_limited');
      const parts=url.pathname.split('/');
      response=parts[7]==='authorize' ? await authorizeUploadFolder(env,uid,parts[3],parts[5],request) : parts[7]==='complete'
        ? await completeUpload(env,uid,parts[3],parts[5],request)
        : await startUpload(env,uid,parts[3],parts[5],request);
    } else if (/^\/integrations\/drive\/[^/]+\/files\/[^/]+\/thumbnail$/.test(url.pathname) && request.method==='GET') {
      enabled(env);
      const uid=await identity(request,env);
      await assertActiveAccess(env,uid);
      if (!(await env.API_THUMB_LIMIT.limit({key:env.ENVIRONMENT+':uid:'+uid})).success) throw new ApiError(429,'rate_limited');
      const parts=url.pathname.split('/');
      response=await thumbnail(env,uid,parts[3],parts[5],url.searchParams.get('ticket'));
    } else if (/^\/integrations\/drive\/[^/]+\/(metadata|disconnect|about)$/.test(url.pathname)) {
      enabled(env);
      const uid = await identity(request,env);
      await assertActiveAccess(env,uid);
      if (!(await env.API_RATE_LIMIT.limit({key:env.ENVIRONMENT+':uid:'+uid})).success) throw new ApiError(429,'rate_limited');
      const parts = url.pathname.split('/');
      if (parts[4] === 'about' && request.method === 'GET') {
        response = await about(env,uid,parts[3]);
      } else if (parts[4] === 'metadata' && request.method === 'GET') {
        response = await metadata(env,uid,parts[3],url.searchParams.get('fileId') || '');
      } else if (parts[4] === 'disconnect' && request.method === 'POST') {
        if (!allowedFrontend(env,origin)) throw new ApiError(403,'origin_required');
        response = await disconnect(env,uid,parts[3]);
      } else throw new ApiError(405,'method_not_allowed');
    } else {
      throw new ApiError(404,'not_found');
    }
  } catch (error) {
    const known = error instanceof ApiError;
    if(known && (url.pathname==='/access/ensure'||error.code.startsWith('access_')||error.code.startsWith('admin_')))
      console.error(JSON.stringify({event:'access_request_denied',code:error.code,status:error.status,requestId:id}));
    const status = known ? error.status : 503;
    response = Response.json({error:{
      code:known ? error.code : 'service_unavailable',
      requestId:id,
      ...(known&&url.pathname.startsWith('/reviews/')&&error.asset?{asset:error.asset}:{})
    }},{status});
    // Only categorical events. Never emit Request, URL, exception, headers or provider bodies.
    if (!known) console.error(JSON.stringify({event:'dependency_failure',requestId:id}));
  }
  const result = applyResponsePolicy(response,url.pathname,allowedFrontend(env,origin)?origin:env.FRONTEND_ORIGIN,legacyFrontendAllowed(env));
  result.headers.set('X-Request-Id',id);
  result.headers.set('Vary','Origin');
  if (allowedFrontend(env,origin)) {
    const exposed=result.headers.get('Access-Control-Expose-Headers');
    result.headers.set('Access-Control-Expose-Headers',exposed?exposed+', X-Request-Id':'X-Request-Id');
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
    assertEnvironment(env);
    if (!['* * * * *','*/15 * * * *'].includes(controller.cron)) {
      console.error(JSON.stringify({event:'unexpected_cron_trigger'})); return;
    }
    await assertDatabaseEnvironment(env);
    if(controller.cron==='* * * * *'){
      // Account cleanup failures must not starve project cleanup. Each durable
      // queue has its own lease, retry and failure isolation.
      try{await runPendingDeletions(env);}catch{console.error(JSON.stringify({event:'account_deletion_scheduler_failure'}));}
      try{await runPendingProjectDeletions(env);}catch{console.error(JSON.stringify({event:'project_deletion_scheduler_failure'}));}
      try{await cleanupExpiredReviews(env);}catch{console.error(JSON.stringify({event:'review_revocation_retry'}));}
      try{await reconcileBilling(env);}catch{console.error(JSON.stringify({event:'billing_scheduler_retry'}));}
      try{await retryBillingCancellation(env);}catch{console.error(JSON.stringify({event:'billing_cancellation_scheduler_retry'}));}
      try{await recoverUpgrade(env);}catch{console.error(JSON.stringify({event:'billing_upgrade_scheduler_retry'}));}
    }else if(controller.cron==='*/15 * * * *'){
      // D1 security backlog is observed inside the Worker; GitHub never polls it.
      try{await monitorDeletionBacklog(env);}catch{console.error(JSON.stringify({event:'security_backlog_monitor_failed'}));}
      try{await runDeletionMaintenance(env);}catch{console.error(JSON.stringify({event:'deletion_maintenance_retry'}));}
      try{await backfillAccess(env);}catch(error){console.error(JSON.stringify({event:'access_backfill_retry',code:error instanceof ApiError?error.code:'dependency_failure'}));}
      try{await cleanupUploads(env);}catch{console.error(JSON.stringify({event:'drive_upload_retention_retry'}));}
      try{await cleanupDropboxUploads(env);}catch{console.error(JSON.stringify({event:'dropbox_upload_retention_retry'}));}
    }else{
      console.error(JSON.stringify({event:'unexpected_cron_trigger'}));
    }
  })());
}};
