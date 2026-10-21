import test from 'node:test';
import assert from 'node:assert/strict';
import {mintReviewMediaTicket,verifyReviewMediaTicket,streamReviewMedia} from '../src/review-media.ts';
import {base64url} from '../src/crypto.ts';
function env(){
  return {ENVIRONMENT:'dev',TOKEN_KEY_VERSION:'v1',
    TOKEN_KEYS:JSON.stringify({v1:base64url(crypto.getRandomValues(new Uint8Array(32)))})};
}
const review='12345678-1234-4234-8234-123456789012';
const file='FILE_REVIEW_12345678';
const inviteHash='a'.repeat(43);
test('minted media ticket is authenticated, scoped to a video, expiring and tamper evident',async()=>{
  const e=env(),token=await mintReviewMediaTicket(e,review,file,1,Date.now()+300000,inviteHash);
  assert.ok(token.includes('.'));
  const p=await verifyReviewMediaTicket(e,token);
  assert.equal(p.r,review);assert.equal(p.f,file);assert.equal(p.v,1);assert.equal(p.h,inviteHash);
  assert.ok(p.e<=Date.now()+12*60000);
  await assert.rejects(()=>verifyReviewMediaTicket(e,token.slice(0,-2)+'xx'),x=>x.status===404);
  await assert.rejects(()=>verifyReviewMediaTicket(env(),token),x=>x.status===404);
  await assert.rejects(()=>verifyReviewMediaTicket(e,'<script>'),x=>x.status===404);
});
test('expired media ticket never authorizes a range request',async()=>{
  const e=env(),ticket=await mintReviewMediaTicket(e,review,file,2,Date.now()-1000,inviteHash);
  await assert.rejects(()=>verifyReviewMediaTicket(e,ticket),x=>x.status===404);
  const request=new Request('https://roteiva-api-dev.ewertonmendes9.workers.dev/reviews/media?ticket='+ticket,
    {headers:{Range:'bytes=0-100'}});
  await assert.rejects(()=>streamReviewMedia(request,e,new URL(request.url)),x=>x.status===404);
});
test('wrong file type and a closed review cannot stream even with signed ticket',async()=>{
  const e=env(),ticket=await mintReviewMediaTicket(e,review,file,1,Date.now()+60000,inviteHash);
  let status='closed',mime='video/mp4';
  const DB={prepare(sql){
    return {bind(...args){
      return {async first(){
        if(sql.includes('FROM review_requests'))return {id:review,owner_uid:'alice',status,current_version:1,expires_at:Date.now()+60000,token_hash:inviteHash};
        if(sql.includes('FROM review_assets'))return {file_id:file,connection_id:'unused',mime_type:mime};
        return null;
      }};
    }};
  }};
  const scope={...e,DB};
  const request=new Request('https://roteiva-api-dev.ewertonmendes9.workers.dev/reviews/media?ticket='+ticket);
  await assert.rejects(()=>streamReviewMedia(request,scope,new URL(request.url)),x=>x.status===404);
  status='pending';mime='image/png';
  await assert.rejects(()=>streamReviewMedia(request,scope,new URL(request.url)),x=>x.status===404);
});
