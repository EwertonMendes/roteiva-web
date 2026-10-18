import { ApiError, type Connection, type Env } from './types.ts';
import { accessCredential } from './google.ts';
import { rejectCachedToken } from './token-store.ts';

const QUOTA_REASONS = new Set(['rateLimitExceeded','userRateLimitExceeded','dailyLimitExceeded','quotaExceeded','downloadQuotaExceeded','sharingRateLimitExceeded']);
interface GoogleError { error?: { errors?: Array<{reason?:string}>; status?:string }; }

/** Only fixed-host Drive GETs: never retry a write or follow an arbitrary URL with credentials. */
export async function driveJson(env: Env, row: Connection, url: URL, fetcher: typeof fetch = fetch,
  notFoundCode = 'drive_file_not_found'): Promise<Record<string,unknown>> {
  if (url.origin !== 'https://www.googleapis.com' || !url.pathname.startsWith('/drive/v3/') ||
      url.username || url.password || url.searchParams.get('alt') === 'media') throw new ApiError(400,'invalid_drive_endpoint');
  let token = await accessCredential(env,row,fetcher);
  for (let attempt=0;attempt<2;attempt++) {
    let response: Response;
    try {
      response = await fetcher(url,{
        method:'GET',headers:{Authorization:'Bearer '+token.value},
        redirect:'error',signal:AbortSignal.timeout(12000),
      });
    } catch { throw new ApiError(502,'google_unavailable'); }
    if (response.status === 401) {
      await response.body?.cancel();
      await rejectCachedToken(env,row,token.version);
      if (attempt === 0) {
        token = await accessCredential(env,row,fetcher);
        continue;
      }
      throw new ApiError(401,'drive_access_rejected');
    }
    if (!response.ok) {
      const body = await response.json().catch(()=>null) as GoogleError | null;
      const reasons = body?.error?.errors?.map(error=>error.reason) || [];
      if (response.status === 429 || (response.status === 403 && reasons.some(reason=>reason && QUOTA_REASONS.has(reason)))) {
        throw new ApiError(429,'drive_rate_limited');
      }
      if (response.status === 403 && reasons.includes('insufficientPermissions')) throw new ApiError(409,'drive_read_permission_missing');
      if (response.status === 403) throw new ApiError(403,'drive_permission_denied');
      if (response.status === 404) throw new ApiError(404,notFoundCode);
      throw new ApiError(502,'drive_unavailable');
    }
    try {
      const data: unknown = await response.json();
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
      return data as Record<string,unknown>;
    } catch { throw new ApiError(502,'invalid_google_response'); }
  }
  throw new ApiError(401,'drive_access_rejected');
}
