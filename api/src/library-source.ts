import {ApiError} from './types.ts';

/** Provider observations are separate from authorization and connection state. */
export type SourceObservation = {
  available:boolean; reason:'available'|'source_trashed'|'source_unavailable'|'source_restricted'|'temporary_failure'|'rate_limited'|'reconnect_required';
  retryable:boolean;
};
export function sourceFailure(status:number,reason?:string):SourceObservation {
  if(status===429 || ['rateLimitExceeded','userRateLimitExceeded','dailyLimitExceeded','downloadQuotaExceeded','quotaExceeded'].includes(reason||''))
    return {available:false,reason:'rate_limited',retryable:true};
  if(status===401)return {available:false,reason:'reconnect_required',retryable:false};
  if(status===404 || status===410)return {available:false,reason:'source_unavailable',retryable:false};
  if(status===403)return {available:false,reason:'source_restricted',retryable:false};
  return {available:false,reason:'temporary_failure',retryable:true};
}
export type SourceVersion = {
  provider:'google_drive'|'dropbox'; fileId:string; revision:string;
  size:string; mimeType:string;
};
const googleId=/^[A-Za-z0-9_-]{10,200}$/;
const dropboxId=/^id:[A-Za-z0-9_-]{8,200}$/;
/** Revision is mandatory: never fall back to mutable head content in a review. */
export function revisionEndpoint(source:SourceVersion):{url:string;method:'GET'|'POST';headers:Record<string,string>} {
  if(!source || !/^[A-Za-z0-9_-]{1,200}$/.test(source.revision) ||
    !/^\d{1,16}$/.test(source.size) || BigInt(source.size)<1n ||
    !/^(image|audio|video)\/[a-zA-Z0-9!#$&^_.+-]+$|^application\/pdf$/.test(source.mimeType))
    throw new ApiError(400,'invalid_source_version');
  if(source.provider==='google_drive' && googleId.test(source.fileId))return {
    url:'https://www.googleapis.com/drive/v3/files/'+source.fileId+'/revisions/'+source.revision+'?alt=media',
    method:'GET',headers:{},
  };
  if(source.provider==='dropbox' && dropboxId.test(source.fileId))return {
    url:'https://content.dropboxapi.com/2/files/download',method:'POST',
    headers:{'Dropbox-API-Arg':JSON.stringify({path:'rev:'+source.revision})},
  };
  throw new ApiError(400,'invalid_source_version');
}

/** Bounded single ranges; a source snapshot cannot change size between chunks. */
export function sourceRange(value:string|null,size:string,max=8*1024*1024):string {
  if(!/^\d{1,16}$/.test(size)||BigInt(size)<1n||BigInt(size)>BigInt(Number.MAX_SAFE_INTEGER))throw new ApiError(400,'invalid_source_size');
  const length=Number(size);
  if(!Number.isSafeInteger(max)||max<1||max>8*1024*1024)throw new ApiError(400,'invalid_range_limit');
  if(!value)return 'bytes=0-'+Math.min(length-1,max-1);
  const match=/^bytes=(\d{1,16})-(\d{0,16})$/.exec(value),suffix=/^bytes=-(\d{1,16})$/.exec(value);
  if(suffix){const n=Number(suffix[1]);if(!Number.isSafeInteger(n)||n<1)throw new ApiError(416,'media_invalid_range');
    return 'bytes='+Math.max(0,length-Math.min(n,max))+'-'+(length-1);}
  if(!match)throw new ApiError(416,'media_invalid_range');
  const start=Number(match[1]),end=match[2]?Number(match[2]):Math.min(length-1,start+max-1);
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>=length||end<start)throw new ApiError(416,'media_invalid_range');
  return 'bytes='+start+'-'+Math.min(end,length-1,start+max-1);
}
