import test from 'node:test';
import assert from 'node:assert/strict';
import {database} from './helpers/database.mjs';
import {sendFeedbackEmail,FeedbackDeliveryFailure,feedbackEnabled} from '../src/feedback-delivery.ts';
import {feedbackRouter} from '../src/feedback.ts';

const image=Uint8Array.from({length:8203},(_,i)=>i%256);
const baseMail={
  id:'b21c2af3-0d0a-4d87-9dfa-83c1eaa8ff01',
  email:'owner@example.com',kindLabel:'Problema',title:'Imagem não carregou',
  description:'O projeto ficou sem a imagem anexada.',screen:'/projetos',
  attachments:[{content:image,filename:'captura-01.png',type:'image/png',disposition:'attachment'}]
};
const token='re_mock_test_secret_1234567890';
function req(key=crypto.randomUUID()){
  const form=new FormData();
  form.set('requestKey',key);form.set('kind','bug');form.set('title','Problema no projeto');
  form.set('description','O botão não respondeu como esperado.');form.set('screen','/projetos');
  return new Request('https://api.roteiva.com/feedback',{method:'POST',body:form});
}
test('Resend Free delivers only in DEV with correct image Base64 and idempotency',async t=>{
  const previous=globalThis.fetch;t.after(()=>{globalThis.fetch=previous;});
  const captured=[];
  globalThis.fetch=async(url,options)=>{
    assert.equal(url,'https://api.resend.com/emails');
    assert.equal(options.redirect,'manual');
    assert.equal(options.headers.Authorization,'Bearer '+token);
    assert.equal(options.headers['Idempotency-Key'],'roteiva-feedback/'+baseMail.id);
    captured.push(JSON.parse(options.body));
    return Response.json({id:'resend-confirmed-id'});
  };
  assert.equal(feedbackEnabled({ENVIRONMENT:'prod',RESEND_API_KEY:token}),false);
  assert.equal(feedbackEnabled({ENVIRONMENT:'dev',RESEND_API_KEY:token}),true);
  assert.equal(feedbackEnabled({ENVIRONMENT:'prod',RESEND_API_KEY:''}),false);
  for(const environment of ['dev']){
    const receipt=await sendFeedbackEmail({ENVIRONMENT:environment,RESEND_API_KEY:token},baseMail);
    assert.equal(receipt.messageId,'resend-confirmed-id');
  }
  assert.equal(captured.length,1);
  for(const [index,mail] of captured.entries()){
    const env='DEV';
    assert.equal(mail.from,'Roteiva '+env+' <onboarding@resend.dev>');
    assert.deepEqual(mail.to,['suporte.roteiva@gmail.com']);
    assert.equal(mail.reply_to,'owner@example.com');
    assert.match(mail.subject,new RegExp('Roteiva '+env));
    assert.deepEqual(Buffer.from(mail.attachments[0].content,'base64'),Buffer.from(image));
  }
});
test('sender can change only to explicitly allowlisted support address after domain verification',async t=>{
  const previous=globalThis.fetch;t.after(()=>{globalThis.fetch=previous;});
  let calls=0,from;
  globalThis.fetch=async(_url,options)=>{
    calls++;from=JSON.parse(options.body).from;
    return Response.json({id:'sent'});
  };
  await assert.rejects(()=>sendFeedbackEmail({
    ENVIRONMENT:'dev',RESEND_API_KEY:token,RESEND_FROM_EMAIL:'attacker@unknown.example'
  },baseMail),e=>e instanceof FeedbackDeliveryFailure&&e.safeToRetry&&e.code==='feedback_email_sender_setup');
  assert.equal(calls,0);
  await sendFeedbackEmail({ENVIRONMENT:'dev',RESEND_API_KEY:token,RESEND_FROM_EMAIL:'suporte@roteiva.com'},baseMail);
  assert.equal(from,'Roteiva DEV <suporte@roteiva.com>');
});
test('definite provider rejection allows bounded repeat and never reports success early',async t=>{
  const db=database();t.after(db.close);
  const previous=globalThis.fetch;t.after(()=>{globalThis.fetch=previous;});
  let calls=0;
  globalThis.fetch=async()=>{
    calls++;return calls===1?Response.json({message:'invalid sender'},{status:403}):Response.json({id:'accepted'});
  };
  const env={ENVIRONMENT:'dev',DB:db.DB,RESEND_API_KEY:token};
  const key=crypto.randomUUID();
  await assert.rejects(()=>feedbackRouter(req(key),env,'owner','owner@example.com'),e=>
    e.code==='feedback_dev_email_setup');
  let row=db.sql.prepare('SELECT status,retry_safe,attempt_count FROM feedback_reports').get();
  assert.equal(row.status,'failed');assert.equal(row.retry_safe,1);assert.equal(row.attempt_count,1);
  assert.equal((await feedbackRouter(req(key),env,'owner','owner@example.com')).status,201);
  row=db.sql.prepare('SELECT status,retry_safe,message_id,attempt_count FROM feedback_reports').get();
  assert.equal(row.status,'sent');assert.equal(row.retry_safe,0);
  assert.equal(row.message_id,'accepted');assert.equal(row.attempt_count,2);
  assert.equal((await feedbackRouter(req(key),env,'owner','owner@example.com')).status,200);
  assert.equal(calls,2);
});
test('provider 5xx and transport errors are uncertain, no automatic repeats',async t=>{
  const previous=globalThis.fetch;t.after(()=>{globalThis.fetch=previous;});
  for(const value of [Response.json({message:'server busy'},{status:503}),null]){
    globalThis.fetch=async()=>{if(value)return value;throw Error('network lost');};
    await assert.rejects(()=>sendFeedbackEmail({ENVIRONMENT:'dev',RESEND_API_KEY:token},baseMail),e=>
      e instanceof FeedbackDeliveryFailure&&!e.safeToRetry&&e.code==='feedback_delivery_unconfirmed');
  }
});
test('legacy ambiguous failed records are not upgraded to retry-safe',async t=>{
  const db=database();t.after(db.close);
  const key=crypto.randomUUID();
  db.sql.prepare("INSERT INTO feedback_reports (id,owner_uid,request_key,kind,title,description,screen,status,attachment_count,created_at) VALUES (?,?,?,?,?,?,?,'failed',0,?)")
    .run(crypto.randomUUID(),'owner',key,'bug','example title','description of problem','/projetos',Date.now());
  const previous=globalThis.fetch;t.after(()=>{globalThis.fetch=previous;});
  let calls=0;globalThis.fetch=async()=>{calls++;return Response.json({id:'sent'});};
  const env={ENVIRONMENT:'dev',DB:db.DB,RESEND_API_KEY:token};
  await assert.rejects(()=>feedbackRouter(req(key),env,'owner','owner@example.com'),e=>e.code==='feedback_already_attempted');
  assert.equal(calls,0);
  assert.equal((await feedbackRouter(req(),env,'owner','owner@example.com')).status,201);
});
