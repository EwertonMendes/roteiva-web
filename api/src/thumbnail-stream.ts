/** Stream only uncompressed, length-bounded Google thumbnails.
 * Unknown-length responses continue through the fully validated buffer fallback.
 */
export function streamBoundedThumbnail(
  upstream:Response,mime:string,maxBytes:number,onComplete:(size:number)=>void,
):Response|null{
  const rawLength=upstream.headers.get('Content-Length');
  const declared=rawLength===null?NaN:Number(rawLength);
  if(!Number.isSafeInteger(declared)||declared<=0||declared>maxBytes||
    (upstream.headers.get('Content-Encoding')||'identity')!=='identity'||!upstream.body)return null;
  let received=0;
  const bounded=new TransformStream<Uint8Array,Uint8Array>({
    transform(chunk,controller){
      received+=chunk.byteLength;
      if(received>declared||received>maxBytes){
        controller.error(new Error('thumbnail_size_mismatch'));
        return;
      }
      controller.enqueue(chunk);
    },
    flush(controller){
      if(received!==declared){controller.error(new Error('thumbnail_size_mismatch'));return;}
      onComplete(received);
    },
  });
  return new Response(upstream.body.pipeThrough(bounded),{status:200,headers:{
    'Content-Type':mime,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff',
  }});
}
