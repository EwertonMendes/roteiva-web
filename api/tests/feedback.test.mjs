import test from 'node:test';
import assert from 'node:assert/strict';
import {database} from './helpers/database.mjs';
import {feedbackRouter,parseFeedback} from '../src/feedback.ts';

const png=new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0]);
function request(overrides={}){
  const {key=crypto.randomUUID(),kind='bug',title='Problema no projeto',description='A tela deixou de responder ao clicar no botão.',screen='/projetos',files=[]}=overrides;
  const form=new FormData();
  form.set('requestKey',key);form.set('kind',kind);form.set('title',title);
  form.set('description',description);form.set('screen',screen);
  for(const file of files)form.append('images',file,'captura.png');
  return new Request('https://api.roteiva.com/feedback',{method:'POST',body:form});
}
function configured(db){
  const sent=[];
  const env={DB:db.DB,ENVIRONMENT:'dev',FEEDBACK_EMAIL:{async send(message){
    sent.push(message);
    return {messageId:'mail-'+sent.length};
  }}};
  return {env,sent};
}
test('validated request sends fixed destination/sender; D1 stores no image bytes',async t=>{
  const db=database();t.after(db.close);
  const {env,sent}=configured(db);
  const image=new File([png],'private-screenshot.png',{type:'image/png'});
  const response=await feedbackRouter(request({files:[image]}),env,'owner-A','ownerA@gmail.com');
  assert.equal(response.status,201);
  const result=await response.json();
  assert.equal(result.status,'received');
  assert.equal(sent.length,1);
  assert.equal(sent[0].to,'suporte.roteiva@gmail.com');
  assert.equal(sent[0].from,'suporte@roteiva.com');
  assert.equal(sent[0].replyTo,'ownerA@gmail.com');
  assert.equal(sent[0].attachments.length,1);
  assert.equal(sent[0].attachments[0].type,'image/png');
  assert.equal(sent[0].attachments[0].filename,'captura-01.png');
  assert.deepEqual(sent[0].attachments[0].content,png);
  assert.ok(!sent[0].subject.includes('Problema no projeto'));
  const row=db.sql.prepare('SELECT * FROM feedback_reports').get();
  assert.equal(row.owner_uid,'owner-A');
  assert.equal(row.status,'sent');
  assert.equal(row.retry_safe,0);
  assert.equal(row.attachment_count,1);
  assert.equal(row.message_id,'mail-1');
  assert.ok(!JSON.stringify(row).includes('private-screenshot.png'));
  assert.ok(!JSON.stringify(row).includes('137,80,78,71'));
});
test('idempotency, daily quota and per-user history are enforced in SQLite',async t=>{
  const db=database();t.after(db.close);
  const {env,sent}=configured(db);
  const key=crypto.randomUUID();
  assert.equal((await feedbackRouter(request({key}),env,'A','a@gmail.com')).status,201);
  const dup=await feedbackRouter(request({key}),env,'A','a@gmail.com');
  assert.equal(dup.status,200);
  assert.equal((await dup.json()).duplicate,true);
  assert.equal(sent.length,1);
  await feedbackRouter(request(),env,'A','a@gmail.com');
  await feedbackRouter(request(),env,'A','a@gmail.com');
  await assert.rejects(()=>feedbackRouter(request(),env,'A','a@gmail.com'),error=>error.code==='feedback_daily_limit');
  await feedbackRouter(request(),env,'B','b@gmail.com');
  assert.equal(sent.length,4);
  const own=await feedbackRouter(new Request('https://api.roteiva.com/feedback'),env,'A','a@gmail.com');
  const reports=(await own.json()).items;
  assert.equal(reports.length,3);
  assert.ok(reports.every(row=>!('description' in row)&&!('message_id' in row)));
});
test('invalid text, MIME spoofing, too many images and missing binding reject before persistence',async t=>{
  const db=database();t.after(db.close);
  const {env,sent}=configured(db);
  const invalid=[
    request({title:'a'}),
    request({kind:'hack'}),
    request({description:'short'}),
    request({screen:'https://evil.example/'}),
    request({files:[new File([png],'fake.jpg',{type:'image/jpeg'})]}),
    request({files:Array.from({length:6},()=>new File([png],'img.png',{type:'image/png'}))}),
    request({files:[new File([new Uint8Array(1024*1024+1)],'large.png',{type:'image/png'})]})
  ];
  for(const sample of invalid)
    await assert.rejects(()=>feedbackRouter(sample,env,'A','a@gmail.com'),error=>error.status>=400&&error.status<500);
  await assert.rejects(()=>feedbackRouter(request(),{...env,FEEDBACK_EMAIL:undefined},'A','a@gmail.com'),error=>error.code==='feedback_unavailable');
  assert.equal(sent.length,0);
  assert.equal(db.sql.prepare('SELECT COUNT(*) n FROM feedback_reports').get().n,0);
});
test('failed provider never reports success and a repeated key does not resend',async t=>{
  const db=database();t.after(db.close);
  const key=crypto.randomUUID();
  let calls=0;
  const env={DB:db.DB,ENVIRONMENT:'dev',FEEDBACK_EMAIL:{async send(){calls++;throw Error('provider unavailable secret details');}}};
  await assert.rejects(()=>feedbackRouter(request({key}),env,'A','a@gmail.com'),error=>error.code==='feedback_delivery_unconfirmed');
  await assert.rejects(()=>feedbackRouter(request({key}),env,'A','a@gmail.com'),error=>error.code==='feedback_already_attempted');
  assert.equal(calls,1);
  assert.equal(db.sql.prepare('SELECT status FROM feedback_reports').get().status,'sending');
});
test('malformed content and oversized streams are rejected before multipart parsing',async()=>{
  await assert.rejects(()=>parseFeedback(new Request('https://api.roteiva.com/feedback',{method:'POST',body:'garbage',headers:{'Content-Type':'text/plain'}})),e=>e.status===415);
  const oversize=new Request('https://api.roteiva.com/feedback',{
    method:'POST',body:new Uint8Array(6*1024*1024+1),
    headers:{'Content-Type':'multipart/form-data; boundary=valid'}
  });
  await assert.rejects(()=>parseFeedback(oversize),e=>e.code==='feedback_too_large');
});
