import {ApiError} from './types.ts';

/**
 * Authenticated progressive video relay. One HTTP 206 is streamed to the native
 * player continuously, while upstream reads use bounded ranges to avoid a long
 * provider connection. Never buffer an entire slice before releasing its bytes:
 * doing so introduced a periodic 8 MiB playback starvation in the former relay.
 */
const FIRST_BYTES=1024*1024;
const NEXT_BYTES=8*1024*1024;
const MAX_SLICE_RETRIES=2;
export const MAX_STITCHED_VIDEO=256*1024*1024;
type ReadSlice=(range:string,signal:AbortSignal)=>Promise<Response>;

async function openSlice(
 read:ReadSlice,start:number,end:number,total:number,signal:AbortSignal,
):Promise<ReadableStreamDefaultReader<Uint8Array>> {
 const expected='bytes '+start+'-'+end+'/'+total;
 for(let attempt=0;attempt<=MAX_SLICE_RETRIES;attempt++){
  if(signal.aborted)throw new ApiError(503,'media_cancelled');
  let response:Response|undefined;
  try{
   response=await read('bytes='+start+'-'+end,signal);
  }catch(error){
   if(!signal.aborted&&attempt<MAX_SLICE_RETRIES)continue;
   throw error;
  }
  if(response.status===429){await response.body?.cancel();throw new ApiError(429,'provider_rate_limited');}
  if(response.status>=500&&attempt<MAX_SLICE_RETRIES){await response.body?.cancel();continue;}
  if(response.status!==206||response.headers.get('Content-Range')!==expected||
    (response.headers.has('Content-Length')&&response.headers.get('Content-Length')!==String(end-start+1))||
    !response.body){
   await response.body?.cancel();
   throw new ApiError(502,'media_range_unsupported');
  }
  return response.body.getReader();
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
 const cleanup=()=>requestSignal?.removeEventListener('abort',onAbort);
 let cursor=start;
 let sliceEnd=Math.min(end,cursor+FIRST_BYTES-1);
 let failures=0;
 let reader:ReadableStreamDefaultReader<Uint8Array>|null=null;
 try{
  reader=await openSlice(read,cursor,sliceEnd,total,abort.signal);
  const body=new ReadableStream<Uint8Array>({
   async pull(controller){
    if(abort.signal.aborted){cleanup();controller.error(new Error('media_cancelled'));return;}
    if(cursor>end){cleanup();controller.close();return;}
    try{
     if(!reader){
      sliceEnd=Math.min(end,cursor+NEXT_BYTES-1);
      failures=0;
      reader=await openSlice(read,cursor,sliceEnd,total,abort.signal);
     }
     let part:ReadableStreamReadResult<Uint8Array>;
     try{part=await reader.read();}
     catch(error){
      try{await reader.cancel();}catch{/* reader was interrupted */}
      reader=null;
      if(!abort.signal.aborted&&++failures<=MAX_SLICE_RETRIES)return;
      throw error;
     }
     if(part.done){
      reader.releaseLock();reader=null;
      if(cursor<=sliceEnd){
       if(++failures<=MAX_SLICE_RETRIES)return;
       throw new Error('incomplete_provider_chunk');
      }
      return;
     }
     if(part.value.byteLength===0)return;
     if(part.value.byteLength>sliceEnd-cursor+1)throw new Error('provider_range_overflow');
     cursor+=part.value.byteLength;
     failures=0;
     controller.enqueue(part.value);
     if(cursor>sliceEnd){
      const completed=reader;reader=null;
      // Exact range consumed, release any transport resources immediately.
      await completed.cancel().catch(()=>{});
     }
    }catch(error){
     abort.abort();cleanup();
     if(reader){await reader.cancel().catch(()=>{});reader=null;}
     controller.error(error);
    }
   },
   cancel(){abort.abort();cleanup();if(reader)void reader.cancel().catch(()=>{});reader=null;},
  });
  return new Response(body,{status:206,headers:{
   'Content-Type':mimeType,'Accept-Ranges':'bytes',
   'Content-Range':'bytes '+start+'-'+end+'/'+total,
   'Content-Length':String(end-start+1),'Cache-Control':'private, no-store',
   'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
   'Access-Control-Expose-Headers':'Content-Length, Content-Range, Accept-Ranges',
  }});
 }catch(error){abort.abort();cleanup();throw error;}
}
