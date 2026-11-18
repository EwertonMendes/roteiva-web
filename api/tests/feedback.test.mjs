import test from 'node:test';
import assert from 'node:assert/strict';
import {database} from './helpers/database.mjs';
import {feedbackRouter,parseFeedback} from '../src/feedback.ts';

const png=new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0]);
function request(overrides={}){
  const {key=crypto.randomUUID(),kind='bug',title='Problema no projeto',
    description='A tela deixou de responder ao clicar no botão.',screen='/projetos',files=[]}=overrides;
  const form=new FormData();
  form.set('requestKey',key);form.set('kind',kind);form.set('title',title);
  form.set('description',description);form.set('screen',screen);
  for(const file of files)form.append('images',file,'captura.png');
  return new Request('https://api.roteiva.com/feedback',{method:'POST',body:form});
}
function configured(db,t){
  const sent=[],oldFetch=globalThis.fetch;
  globalThis.fetch=async(url,options)=>{
    assert.equal(url,'https://api.resend.com/emails');
    const message=JSON.parse(options.body);
    sent.push(message);
    return Response.json({id:'mail-'+sent.length});
  };
  t.after(()=>{globalThis.fetch=oldFetch;});
  const env={DB:db.DB,ENVIRONMENT:'dev',RESEND_API_KEY:'re_mock_secure_key_123456'};
  return {env,sent};
}

test('DEV without Resend and PROD without Cloudflare binding expose unavailable feedback and never send or persist a submission',async t=>{
  const db=database();t.after(db.close);
  t.mock.method(globalThis,'fetch',async()=>{throw Error('No provider request is allowed without a key');});
  for(const ENVIRONMENT of ['dev','prod']){
    const env={DB:db.DB,ENVIRONMENT};
    const status=await feedbackRouter(new Request('https://api.roteiva.com/feedback'),env,'qa','qa@example.com');
    assert.equal((await status.json()).available,false);
    await assert.rejects(()=>feedbackRouter(request(),env,'qa','qa@example.com'),e=>e.code==='feedback_unavailable'&&e.status===503);
  }
  assert.equal(db.sql.prepare('SELECT COUNT(*) AS n FROM feedback_reports').get().n,0);
});
test('authenticated request sends fixed destination; metadata D1 never stores attachment bytes',async t=>{
  const db=database();t.after(db.close);
  const {env,sent}=configured(db,t);
  const image=new File([png],'private-screenshot.png',{type:'image/png'});
  const response=await feedbackRouter(request({files:[image]}),env,'owner-A','ownerA@gmail.com');
  assert.equal(response.status,201);
  assert.equal((await response.json()).status,'received');
  assert.equal(sent.length,1);
  assert.deepEqual(sent[0].to,['suporte.roteiva@gmail.com']);
  assert.equal(sent[0].from,'Roteiva DEV <onboarding@resend.dev>');
  assert.equal(sent[0].reply_to,'ownerA@gmail.com');
  assert.equal(sent[0].attachments.length,1);
  assert.equal(sent[0].attachments[0].filename,'captura-01.png');
  assert.deepEqual(Buffer.from(sent[0].attachments[0].content,'base64'),Buffer.from(png));
  assert.ok(!sent[0].subject.includes('Problema no projeto'));
  const row=db.sql.prepare('SELECT * FROM feedback_reports').get();
  assert.equal(row.owner_uid,'owner-A');
  assert.equal(row.status,'sent');
  assert.equal(row.attachment_count,1);
  assert.equal(row.message_id,'mail-1');
  assert.ok(!JSON.stringify(row).includes('private-screenshot.png'));
  assert.ok(!JSON.stringify(row).includes('137,80,78,71'));
});
test('idempotency, user daily quota, and per-user history remain enforced',async t=>{
  const db=database();t.after(db.close);
  const {env,sent}=configured(db,t);
  const key=crypto.randomUUID();
  assert.equal((await feedbackRouter(request({key}),env,'A','a@gmail.com')).status,201);
  const dup=await feedbackRouter(request({key}),env,'A','a@gmail.com');
  assert.equal(dup.status,200);
  assert.equal((await dup.json()).duplicate,true);
  assert.equal(sent.length,1);
  await feedbackRouter(request(),env,'A','a@gmail.com');
  await feedbackRouter(request(),env,'A','a@gmail.com');
  await assert.rejects(()=>feedbackRouter(request(),env,'A','a@gmail.com'),e=>e.code==='feedback_daily_limit');
  await feedbackRouter(request(),env,'B','b@gmail.com');
  assert.equal(sent.length,4);
  const response=await feedbackRouter(new Request('https://api.roteiva.com/feedback'),env,'A','a@gmail.com');
  const rows=(await response.json()).items;
  assert.equal(rows.length,3);
  assert.ok(rows.every(r=>!('description' in r)&&!('message_id' in r)));
});
test('malformed text, MIME spoofing, size limits and absent API key reject before persistence',async t=>{
  const db=database();t.after(db.close);
  const {env,sent}=configured(db,t);
  const invalid=[
    request({title:'a'}),request({kind:'hack'}),request({description:'short'}),
    request({screen:'https://evil.example/'}),
    request({files:[new File([png],'fake.jpg',{type:'image/jpeg'})]}),
    request({files:Array.from({length:6},()=>new File([png],'img.png',{type:'image/png'}))}),
    request({files:[new File([new Uint8Array(1024*1024+1)],'large.png',{type:'image/png'})]})
  ];
  for(const sample of invalid)
    await assert.rejects(()=>feedbackRouter(sample,env,'A','a@gmail.com'),e=>e.status>=400&&e.status<500);
  await assert.rejects(()=>feedbackRouter(request(),{...env,RESEND_API_KEY:undefined},'A','a@gmail.com'),e=>e.code==='feedback_unavailable');
  assert.equal(sent.length,0);
  assert.equal(db.sql.prepare('SELECT COUNT(*) n FROM feedback_reports').get().n,0);
});
test('uncertain network failures never automatically resend the same key',async t=>{
  const db=database();t.after(db.close);
  const oldFetch=globalThis.fetch;
  t.after(()=>{globalThis.fetch=oldFetch;});
  let calls=0;
  globalThis.fetch=async()=>{calls++;throw Error('network lost after submission');};
  const env={DB:db.DB,ENVIRONMENT:'prod',RESEND_API_KEY:'re_mock_secure_key_123456'};
  const key=crypto.randomUUID();
  await assert.rejects(()=>feedbackRouter(request({key}),env,'A','a@gmail.com'),e=>e.code==='feedback_delivery_unconfirmed');
  await assert.rejects(()=>feedbackRouter(request({key}),env,'A','a@gmail.com'),e=>e.code==='feedback_already_attempted');
  assert.equal(calls,1);
  assert.equal(db.sql.prepare('SELECT status FROM feedback_reports').get().status,'sending');
});
test('malformed content and oversized streams are rejected before multipart parsing',async()=>{
  await assert.rejects(()=>parseFeedback(new Request('https://api.roteiva.com/feedback',{
    method:'POST',body:'garbage',headers:{'Content-Type':'text/plain'}
  })),e=>e.status===415);
  const tooLarge=new Request('https://api.roteiva.com/feedback',{
    method:'POST',body:new Uint8Array(6*1024*1024+1),
    headers:{'Content-Type':'multipart/form-data; boundary=valid'}
  });
  await assert.rejects(()=>parseFeedback(tooLarge),e=>e.code==='feedback_too_large');
});
