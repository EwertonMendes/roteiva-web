/** Time out only while establishing a provider response (receiving headers).
 * AbortSignal.timeout on the whole fetch also aborts an active streaming body,
 * producing the exact "first frame then media error" failure on slow chunks.
 */
export async function streamHeaders(
  fetcher: typeof fetch,
  url: string,
  options: RequestInit,
  timeoutMs=24000,
): Promise<Response> {
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  const incoming=options.signal;
  const abort=()=>controller.abort();
  if(incoming?.aborted)controller.abort();
  else incoming?.addEventListener('abort',abort,{once:true});
  try{
    return await fetcher(url,{...options,signal:controller.signal});
  }finally{
    clearTimeout(timer);
    incoming?.removeEventListener('abort',abort);
  }
}
