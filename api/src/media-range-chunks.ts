import {ApiError} from './types.ts';

/**
 * A single open-ended native video response is assembled from bounded,
 * individually verified provider reads. The player sees one continuous range,
 * but Google/Dropbox never have to keep one huge upstream body alive for minutes.
 * This is a DEV fallback while adaptive Stream encoding is unavailable.
 */
const FIRST_BYTES=1024*1024;
const NEXT_BYTES=8*1024*1024;
export const MAX_STITCHED_VIDEO=256*1024*1024;
type ReadSlice=(range:string,signal:AbortSignal)=>Promise<Response>;

async function verifiedSlice(
 read:ReadSlice,start:number,end:number,total:number,signal:AbortSignal,
):Promise<Uint8Array>{
 const requested='bytes='+start+'-'+end;
 for(let attempt=0;attempt<2;attempt++){
  if(signal.aborted)throw new ApiError(499,'media_cancelled');
  let response:Response|undefined;
  try{
   response=await read(requested,signal);
   if(!response.ok){
    const status=response.status;
    await response.body?.cancel();
    if(status===429)throw new ApiError(429,'provider_rate_limited');
    if(status>=500&&attempt===0)continue;
    throw new ApiError(502,'source_unavailable');
   }
   const range=response.headers.get('Content-Range');
   const expected='bytes '+start+'-'+end+'/'+total;
   if(response.status!==206||range!==expected||
      (response.headers.has('Content-Length')&&response.headers.get('Content-Length')!==String(end-start+1))){
    await response.body?.cancel();
    throw new ApiError(502,'media_range_unsupported');
   }
   const bytes=new Uint8Array(await response.arrayBuffer());
   if(bytes.byteLength!==end-start+1)throw new Error('incomplete_provider_chunk');
   return bytes;
  }catch(error){
   if(signal.aborted)throw error;
   if(attempt===1||error instanceof ApiError)throw error;
   // A failed short upstream can be retried without ever exposing a partial
   // chunk to the native media player.
  }
 }
 throw new ApiError(502,'source_unavailable');
}

/** Input has already passed playbackRange() validation. */
export async function stitchedVideoResponse(
 range:string,size:string,mimeType:string,read:ReadSlice,requestSignal?:AbortSignal,
):Promise<Response>{
 const total=Number(size);
 const match=/^bytes=(\d+)-(\d+)$/.exec(range);
 if(!match||!Number.isSafeInteger(total)||total<1||total>MAX_STITCHED_VIDEO)
  throw new ApiError(400,'invalid_video_range');
 const start=Number(match[1]),end=Number(match[2]);
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||end>=total)
  throw new ApiError(416,'media_invalid_range');
 const abort=new AbortController();
 const onAbort=()=>abort.abort();
 if(requestSignal?.aborted)abort.abort();
 else requestSignal?.addEventListener('abort',onAbort,{once:true});
 try{
  const firstEnd=Math.min(start+FIRST_BYTES-1,end);
  const first=await verifiedSlice(read,start,firstEnd,total,abort.signal);
  let cursor=firstEnd+1;
  const body=new ReadableStream<Uint8Array>({
   start(controller){controller.enqueue(first);},
   async pull(controller){
    if(abort.signal.aborted){controller.error(new Error('media_cancelled'));return;}
    if(cursor>end){requestSignal?.removeEventListener('abort',onAbort);controller.close();return;}
    const nextEnd=Math.min(cursor+NEXT_BYTES-1,end);
    try{
     const bytes=await verifiedSlice(read,cursor,nextEnd,total,abort.signal);
     if(abort.signal.aborted){controller.error(new Error('media_cancelled'));return;}
     cursor=nextEnd+1;
     controller.enqueue(bytes);
    }catch(error){abort.abort();controller.error(error);}
   },
   cancel(){abort.abort();requestSignal?.removeEventListener('abort',onAbort);},
  });
  return new Response(body,{status:206,headers:{
   'Content-Type':mimeType,'Accept-Ranges':'bytes',
   'Content-Range':'bytes '+start+'-'+end+'/'+total,
   'Content-Length':String(end-start+1),'Cache-Control':'private, no-store',
   'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
   'Access-Control-Expose-Headers':'Content-Length, Content-Range, Accept-Ranges',
  }});
 }catch(error){abort.abort();requestSignal?.removeEventListener('abort',onAbort);throw error;}
}
