import test from 'node:test';
import assert from 'node:assert/strict';
import {database} from './helpers/database.mjs';
import {feedbackRouter} from '../src/feedback.ts';

function request(key=crypto.randomUUID()){
  const form=new FormData();
  form.set('requestKey',key);form.set('kind','bug');
  form.set('title','Problema no painel');
  form.set('description','A página não está funcionando corretamente.');
  form.set('screen','/projetos');
  return new Request('https://api.roteiva.com/feedback',{method:'POST',body:form});
}
function production(db){
  let sent=0;
  const env={DB:db.DB,ENVIRONMENT:'prod',FEEDBACK_EMAIL:{
    async send(message){
      assert.equal(message.to,'suporte.roteiva@gmail.com');
      sent++;return {messageId:'cloudflare-'+sent};
    }
  }};
  return {env,get sent(){return sent;}};
}
function insertOld(db,uid,status,createdAt,key=crypto.randomUUID()){
  db.sql.prepare('INSERT INTO feedback_reports (id,owner_uid,request_key,kind,title,description,screen,status,attachment_count,created_at) VALUES (?,?,?,?,?,?,?,?,0,?)')
    .run(crypto.randomUUID(),uid,key,'bug','Um problema','Descrição do problema','/projetos',status,createdAt);
}
test('PROD accepts 20 per owner per rolling hour; rejects 21st without calling provider',async t=>{
  const db=database();t.after(db.close);
  const provider=production(db);
  const firstKey=crypto.randomUUID();
  assert.equal((await feedbackRouter(request(firstKey),provider.env,'owner-A','a@example.com')).status,201);
  for(let i=1;i<20;i++)
    assert.equal((await feedbackRouter(request(),provider.env,'owner-A','a@example.com')).status,201);
  assert.equal(provider.sent,20);
  await assert.rejects(
    ()=>feedbackRouter(request(),provider.env,'owner-A','a@example.com'),
    e=>e.status===429&&e.code==='feedback_hourly_limit'
  );
  assert.equal(provider.sent,20);
  const duplicate=await feedbackRouter(request(firstKey),provider.env,'owner-A','a@example.com');
  assert.equal(duplicate.status,200);
  assert.equal((await duplicate.json()).duplicate,true);
  assert.equal(provider.sent,20);
  assert.equal((await feedbackRouter(request(),provider.env,'owner-B','b@example.com')).status,201);
  assert.equal(provider.sent,21);
});
test('PROD resets quota when feedback falls outside the rolling 60-minute window',async t=>{
  const db=database();t.after(db.close);
  const provider=production(db);
  const now=Date.now();
  for(let i=0;i<19;i++)insertOld(db,'owner','sent',now-30000);
  insertOld(db,'owner','sent',now-61*60*1000);
  assert.equal((await feedbackRouter(request(),provider.env,'owner','owner@example.com')).status,201);
  await assert.rejects(()=>feedbackRouter(request(),provider.env,'owner','owner@example.com'),
    e=>e.code==='feedback_hourly_limit');
  assert.equal(provider.sent,1);
});
test('PROD counts in-flight sending reports as quota consumed',async t=>{
  const db=database();t.after(db.close);
  const provider=production(db);
  for(let i=0;i<20;i++)insertOld(db,'owner','sending',Date.now());
  await assert.rejects(()=>feedbackRouter(request(),provider.env,'owner','owner@example.com'),
    e=>e.code==='feedback_hourly_limit'&&e.status===429);
  assert.equal(provider.sent,0);
});
test('PROD separately throttles 40 rejected attempts per hour',async t=>{
  const db=database();t.after(db.close);
  const provider=production(db);
  for(let i=0;i<40;i++)insertOld(db,'owner','failed',Date.now());
  await assert.rejects(()=>feedbackRouter(request(),provider.env,'owner','owner@example.com'),
    e=>e.code==='feedback_hourly_limit'&&e.status===429);
  assert.equal(provider.sent,0);
  assert.equal((await feedbackRouter(request(),provider.env,'other','other@example.com')).status,201);
});
test('DEV ignores app quota even with prior records; provider quotas remain external',async t=>{
  const db=database();t.after(db.close);
  const oldFetch=globalThis.fetch;
  t.after(()=>{globalThis.fetch=oldFetch;});
  let sent=0;
  globalThis.fetch=async()=>Response.json({id:'dev-'+ ++sent});
  const env={DB:db.DB,ENVIRONMENT:'dev',RESEND_API_KEY:'re_mock_test_key_1234567890'};
  const now=Date.now();
  for(let i=0;i<45;i++)insertOld(db,'developer','sent',now);
  for(let i=0;i<7;i++)
    assert.equal((await feedbackRouter(request(),env,'developer','developer@example.com')).status,201);
  assert.equal(sent,7);
  assert.equal(db.sql.prepare("SELECT COUNT(*) AS n FROM feedback_reports WHERE owner_uid='developer'").get().n,52);
});
