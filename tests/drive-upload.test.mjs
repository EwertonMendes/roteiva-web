import test from 'node:test';
import assert from 'node:assert/strict';
import {validSession,sendToDrive} from '../src/features/drive/drive-upload-client.ts';

const url='https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=opaque';
test('upload session URLs must be Google upload endpoints, not redirects or arbitrary hosts',()=>{
  assert.equal(validSession(url),url);
  for(const candidate of [
    'http://www.googleapis.com/upload/drive/v3/files?upload_id=x',
    'https://www.googleapis.com.evil.test/upload/drive/v3/files?upload_id=x',
    'https://www.googleapis.com/drive/v3/files?upload_id=x',
    'https://www.googleapis.com/upload/drive/v3/files?upload_id=x#fragment',
    'https://attacker:secret@www.googleapis.com/upload/drive/v3/files?upload_id=x',
    'https://www.googleapis.com/upload/drive/v3/files-evil?upload_id=x',
    'https://www.googleapis.com/upload/drive/v3/files?upload_id=',
  ])assert.throws(()=>validSession(candidate));
});

async function scenario(responses,run){
  const originalFetch=globalThis.fetch,originalTimer=globalThis.setTimeout;
  const calls=[];
  globalThis.setTimeout=(callback)=>{queueMicrotask(callback);return 0;};
  globalThis.fetch=async(target,options)=>{
    assert.equal(options.method,'PUT');assert.equal(target,url);
    assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit');
    const blob=options.body;
    calls.push({range:options.headers['Content-Range'],length:blob?.size||0,auth:options.headers.Authorization});
    const reply=responses.shift();assert.ok(reply,'unexpected additional transfer');
    if(reply==='network')throw new TypeError('synthetic network outage');
    if(reply==='pending')return new Promise((_,reject)=>{
      if(options.signal.aborted)reject(options.signal.reason);
      else options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true});
    });
    return new Response(reply.text||'',{status:reply.status,headers:reply.range?{Range:reply.range}:{}});
  };
  try{await run(calls);}finally{globalThis.fetch=originalFetch;globalThis.setTimeout=originalTimer;}
}

const done=size=>({status:201,text:JSON.stringify({id:'GOOGLE_FILE_12345678',name:'Demo.mp4',mimeType:'video/mp4',size:String(size)})});
const session={attemptId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',sessionUrl:url,chunkSize:262144};

test('uncertain write and failed status probes never resend bytes until the remote offset is confirmed',async()=>{
  await scenario(['network','network',{status:503},{status:308,range:'bytes=0-262143'},done(400000)],async calls=>{
    const progress=[];
    await sendToDrive(new File([new Uint8Array(400000)],'Demo.mp4'),session,new AbortController().signal,x=>progress.push(x));
    assert.deepEqual(calls.map(c=>c.range),['bytes 0-262143/400000','bytes */400000','bytes */400000','bytes */400000','bytes 262144-399999/400000']);
    assert.deepEqual(progress,[262144,400000]);
    assert.ok(calls.every(c=>!c.auth));
  });
});

test('lost final reply queries completion without uploading another file',async()=>{
  await scenario(['network',done(3)],async calls=>{
    const progress=[];
    await sendToDrive(new File(['abc'],'a.txt'),session,new AbortController().signal,x=>progress.push(x));
    assert.deepEqual(calls.map(c=>c.range),['bytes 0-2/3','bytes */3']);
    assert.deepEqual(progress,[3]);
  });
});

test('empty remote state restarts the same session; 403 rate limiting retries with a probe',async()=>{
  await scenario([{status:403,text:JSON.stringify({error:{errors:[{reason:'userRateLimitExceeded'}]}})},
    {status:308},done(3)],async calls=>{
    await sendToDrive(new File(['abc'],'a.txt'),session,new AbortController().signal,()=>{});
    assert.deepEqual(calls.map(c=>c.range),['bytes 0-2/3','bytes */3','bytes 0-2/3']);
  });
});

test('authorization, permission, expired session, quota and invalid confirmed range fail specifically',async()=>{
  for(const [reply,code] of [[{status:401},'authorization_expired'],[{status:403},'permission_denied'],
    [{status:404},'session_expired'],[{status:429},'retries_exhausted'],
    [{status:403,text:JSON.stringify({error:{errors:[{reason:'storageQuotaExceeded'}]}})},'storage_full'],
    [{status:308,range:'bytes=0-390000'},'invalid_range']]){
    await scenario(Array(6).fill(reply),async()=>{
      await assert.rejects(()=>sendToDrive(new File([new Uint8Array(400000)],'Demo.mp4'),session,new AbortController().signal,()=>{}),e=>e.code===code);
    });
  }
});

test('large file is sliced in bounded blocks without reading the whole file into memory',async()=>{
  const size=301*1024*1024,chunk=8*1024*1024;
  const responses=[];for(let at=chunk;at<size;at+=chunk)responses.push({status:308,range:'bytes=0-'+(at-1)});
  responses.push(done(size));
  const slices=[];
  const file={name:'synthetic-large.mp4',size,type:'video/mp4',slice:(start,end)=>{slices.push(end-start);return {size:end-start};}};
  await scenario(responses,async calls=>{
    await sendToDrive(file,{...session,chunkSize:chunk},new AbortController().signal,()=>{});
    assert.equal(calls.reduce((sum,c)=>sum+c.length,0),size);assert.ok(slices.every(length=>length<=chunk));
  });
});

test('cancellation aborts an in-flight request and starts no next block',async()=>{
  await scenario(['pending'],async calls=>{
    const controller=new AbortController();
    const sending=sendToDrive(new File(['abc'],'a.txt'),session,controller.signal,()=>{});
    controller.abort();await assert.rejects(()=>sending,e=>e.code==='cancelled');assert.equal(calls.length,1);
  });
});
test('resumable sends correct byte ranges, consumes confirmed 308 Range and never attaches OAuth headers',async()=>{
  await scenario([{status:308,range:'bytes=0-262143'},done(400000)],async calls=>{
    const progress=[];
    const result=await sendToDrive(new File([new Uint8Array(400000)],'Demo.mp4',{type:'video/mp4'}),
      session,new AbortController().signal,position=>progress.push(position));
    assert.equal(result.id,'GOOGLE_FILE_12345678');
    assert.deepEqual(calls,[{range:'bytes 0-262143/400000',length:262144,auth:undefined},
      {range:'bytes 262144-399999/400000',length:137856,auth:undefined}]);
    assert.deepEqual(progress,[262144,400000]);
  });
});

test('invalid chunk sizes are rejected before any transfer',async()=>{
  const file=new File([new Uint8Array(10)],'test.bin');
  await assert.rejects(()=>sendToDrive(file,{sessionUrl:url,chunkSize:100},new AbortController().signal,()=>{}),
    e=>e.code==='invalid_session');
});
