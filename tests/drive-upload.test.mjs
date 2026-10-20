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
  ])assert.throws(()=>validSession(candidate));
});
test('resumable sends correct byte ranges, consumes confirmed 308 Range and never attaches OAuth headers',async()=>{
  const original=globalThis.XMLHttpRequest;
  const spans=[];
  const responses=[
    {status:308,range:'bytes=0-262143',text:''},
    {status:201,range:null,text:JSON.stringify({id:'GOOGLE_FILE_12345678',name:'Demo.mp4',mimeType:'video/mp4',size:'400000'})},
  ];
  globalThis.XMLHttpRequest=class {
    upload={onprogress:null};
    headers={};
    open(method,target){assert.equal(method,'PUT');assert.equal(target,url);}
    setRequestHeader(k,v){this.headers[k]=v;}
    getResponseHeader(k){return k==='Range'?this.range:null;}
    send(blob){
      spans.push({range:this.headers['Content-Range'],length:blob.size,authorization:this.headers.Authorization});
      const next=responses.shift();
      this.status=next.status;this.range=next.range;this.responseText=next.text;
      this.upload.onprogress?.({lengthComputable:true,loaded:blob.size});
      queueMicrotask(()=>this.onload());
    }
    abort(){this.onabort?.();}
  };
  try{
    const file=new File([new Uint8Array(400000)],'Demo.mp4',{type:'video/mp4'});
    const positions=[];
    const result=await sendToDrive(file,{sessionUrl:url,chunkSize:262144},new AbortController().signal,
      position=>positions.push(position));
    assert.equal(result.id,'GOOGLE_FILE_12345678');
    assert.deepEqual(spans,[
      {range:'bytes 0-262143/400000',length:262144,authorization:undefined},
      {range:'bytes 262144-399999/400000',length:137856,authorization:undefined},
    ]);
    assert.equal(positions.at(-1),400000);
  }finally{globalThis.XMLHttpRequest=original;}
});
test('invalid chunk sizes are rejected before any transfer',async()=>{
  const file=new File([new Uint8Array(10)],'test.bin');
  await assert.rejects(()=>sendToDrive(file,{sessionUrl:url,chunkSize:100},new AbortController().signal,()=>{}),
    e=>e.code==='invalid_session');
});
