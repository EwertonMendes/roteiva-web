import test from 'node:test';
import assert from 'node:assert/strict';
import {streamHeaders} from '../src/media-fetch.ts';

test('a provider header timeout never interrupts an already streaming media body',async()=>{
 const fetcher=async(url,init)=>new Response(new ReadableStream({
  start(controller){
   setTimeout(()=>{controller.enqueue(new TextEncoder().encode('video'));controller.close();},60);
  }
 }),{status:206,headers:{'Content-Range':'bytes 0-4/5'}});
 const result=await streamHeaders(fetcher,'https://provider.example/file',{method:'GET'},12);
 assert.equal(result.status,206);
 assert.equal(await result.text(),'video');
});

test('unresponsive provider header negotiation is still bounded',async()=>{
 const fetcher=async(url,init)=>new Promise((resolve,reject)=>{
  init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true});
 });
 await assert.rejects(streamHeaders(fetcher,'https://provider.example/file',{},12));
});
