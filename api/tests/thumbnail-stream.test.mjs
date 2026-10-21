import test from 'node:test';
import assert from 'node:assert/strict';
import {streamBoundedThumbnail} from '../src/thumbnail-stream.ts';
const max=1024*1024;
function response(chunks,headers={}){
  const body=new ReadableStream({pull(controller){
    if(!chunks.length){controller.close();return;}
    controller.enqueue(chunks.shift());
  }});
  return new Response(body,{headers:{'Content-Type':'image/jpeg',...headers}});
}
test('known length is streamed with matching contents and private headers',async()=>{
  const upstream=response([new Uint8Array([1,2]),new Uint8Array([3,4])],{'Content-Length':'4'});
  let completed=0;
  const result=streamBoundedThumbnail(upstream,'image/jpeg',max,n=>completed=n);
  assert.equal(result.status,200);
  assert.equal(result.headers.get('Cache-Control'),'private, no-store');
  assert.deepEqual([...new Uint8Array(await result.arrayBuffer())],[1,2,3,4]);
  assert.equal(completed,4);
});
test('unknown and compressed lengths keep fully validated buffered fallback available',async()=>{
  const a=response([new Uint8Array([1])]);
  const b=response([new Uint8Array([1])],{'Content-Length':'1','Content-Encoding':'gzip'});
  assert.equal(streamBoundedThumbnail(a,'image/jpeg',max,()=>{}),null);
  assert.equal(streamBoundedThumbnail(b,'image/jpeg',max,()=>{}),null);
  assert.equal((await a.arrayBuffer()).byteLength,1);
  assert.equal((await b.arrayBuffer()).byteLength,1);
});
test('misleading Content-Length aborts the streamed response',async()=>{
  const extra=response([new Uint8Array([1,2,3])],{'Content-Length':'2'});
  const result=streamBoundedThumbnail(extra,'image/jpeg',max,()=>{});
  await assert.rejects(result.arrayBuffer());
  const short=response([new Uint8Array([1])],{'Content-Length':'2'});
  await assert.rejects(streamBoundedThumbnail(short,'image/jpeg',max,()=>{}).arrayBuffer());
});
test('oversized declarations and zero-length streams cannot use the streaming fast path',()=>{
  const huge=response([new Uint8Array([1])],{'Content-Length':String(max+1)});
  const empty=response([new Uint8Array([1])],{'Content-Length':'0'});
  assert.equal(streamBoundedThumbnail(huge,'image/jpeg',max,()=>{}),null);
  assert.equal(streamBoundedThumbnail(empty,'image/jpeg',max,()=>{}),null);
});
