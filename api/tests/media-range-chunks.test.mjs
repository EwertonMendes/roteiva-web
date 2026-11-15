import test from 'node:test';
import assert from 'node:assert/strict';
import {stitchedVideoResponse} from '../src/media-range-chunks.ts';

const MB=1024*1024;
function provider(total,requests,interrupt=false){
 let interrupted=false;
 return async(range)=>{
  requests.push(range);
  const m=/^bytes=(\d+)-(\d+)$/.exec(range);
  assert.ok(m);
  const start=Number(m[1]),end=Number(m[2]);
  if(interrupt&&start===MB&&!interrupted){interrupted=true;throw new Error('temporary_disconnect');}
  const bytes=new Uint8Array(end-start+1).fill(start%251);
  return new Response(bytes,{status:206,headers:{
   'Content-Range':'bytes '+start+'-'+end+'/'+total,
   'Content-Length':String(bytes.length),
  }});
 };
}

test('one native 206 delivers complete verified bytes across short provider reads',async()=>{
 const size=13*MB+123,requests=[];
 const response=await stitchedVideoResponse('bytes=0-'+(size-1),String(size),'video/mp4',provider(size,requests));
 assert.equal(response.status,206);
 assert.equal(response.headers.get('Content-Range'),'bytes 0-'+(size-1)+'/'+size);
 assert.equal(response.headers.get('Content-Length'),String(size));
 const all=new Uint8Array(await response.arrayBuffer());
 assert.equal(all.length,size);
 assert.deepEqual(requests,[
  'bytes=0-'+(MB-1),
  'bytes='+MB+'-'+(9*MB-1),
  'bytes='+(9*MB)+'-'+(size-1),
 ]);
 assert.equal(all[0],0);
 assert.equal(all[MB],MB%251);
 assert.equal(all[9*MB],(9*MB)%251);
});

test('transient provider disconnect retries a complete slice, not corrupted partial output',async()=>{
 const size=3*MB,requests=[];
 const response=await stitchedVideoResponse('bytes=0-'+(size-1),String(size),'video/mp4',provider(size,requests,true));
 assert.equal((await response.arrayBuffer()).byteLength,size);
 assert.equal(requests.filter(x=>x.startsWith('bytes='+MB+'-')).length,2);
});

test('provider range mismatch is rejected before publishing the native response',async()=>{
 const size=12*MB;
 const invalid=async()=>new Response(new Uint8Array(MB),{status:206,headers:{
  'Content-Range':'bytes 2-'+(MB+1)+'/'+size,
  'Content-Length':String(MB),
 }});
 await assert.rejects(stitchedVideoResponse('bytes=0-'+(size-1),String(size),'video/mp4',invalid),e=>e.code==='media_range_unsupported');
});

test('request cancellation prevents any more upstream reads',async()=>{
 const size=12*MB,requests=[],controller=new AbortController();
 const response=await stitchedVideoResponse('bytes=0-'+(size-1),String(size),'video/mp4',
  provider(size,requests),controller.signal);
 controller.abort();
 await assert.rejects(response.arrayBuffer());
 assert.equal(requests.length,1);
});
