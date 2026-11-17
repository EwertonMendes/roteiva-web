import test from 'node:test';
import assert from 'node:assert/strict';
import {database} from './helpers/database.mjs';
import {sendFeedbackEmail,FeedbackDeliveryFailure,feedbackEnabled} from '../src/feedback-delivery.ts';
import {feedbackRouter} from '../src/feedback.ts';
const baseMail={
  id:'b21c2af3-0d0a-4d87-9dfa-83c1eaa8ff01',email:'owner@example.com',kindLabel:'Problema',
  title:'Imagem não carregou',description:'O projeto ficou sem a imagem anexada.',screen:'/projetos',
  attachments:[{content:Uint8Array.from([0,1,2,3,4,5,6,7,8,9,10,11,12,13]),filename:'captura-01.png',type:'image/png',disposition:'attachment'}]
};
function req(key=crypto.randomUUID()){
  const form=new FormData();
  form.set('requestKey',key);form.set('kind','bug');form.set('title','Problema no projeto');
  form.set('description','O botão não respondeu como esperado.');form.set('screen','/projetos');
  return new Request('https://api.roteiva.com/feedback',{method:'POST',body:form});
}
test('Cloudflare distinguishes definitive sending errors from delivery uncertainty',async()=>{
  const base={ENVIRONMENT:'prod'};
  const domain={...base,FEEDBACK_EMAIL:{send:async()=>{throw Object.assign(new Error('do not log'),{code:'E_SENDER_DOMAIN_NOT_CONFIGURED'});}}};
  await assert.rejects(()=>sendFeedbackEmail(domain,baseMail),e=>
    e instanceof FeedbackDeliveryFailure&&e.safeToRetry&&e.code==='feedback_email_sender_setup');
  const unknown={...base,FEEDBACK_EMAIL:{send:async()=>{throw new Error('timeout');}}};
  await assert.rejects(()=>sendFeedbackEmail(unknown,baseMail),e=>
    e instanceof FeedbackDeliveryFailure&&!e.safeToRetry&&e.code==='feedback_delivery_unconfirmed');
  assert.equal(feedbackEnabled({ENVIRONMENT:'dev',RESEND_API_KEY:''}),false);
  assert.equal(feedbackEnabled({ENVIRONMENT:'dev',RESEND_API_KEY:'secret'}),true);
});
test('definitively rejected attempt can retry under the same key without spending quota',async t=>{
  const db=database();t.after(db.close);
  let calls=0;
  const env={ENVIRONMENT:'prod',DB:db.DB,FEEDBACK_EMAIL:{
    async send(){calls++;if(calls===1)throw Object.assign(new Error('domain'),{code:'E_SENDER_DOMAIN_NOT_CONFIGURED'});return {messageId:'accepted'};}
  }};
  const key=crypto.randomUUID();
  await assert.rejects(()=>feedbackRouter(req(key),env,'u1','u@example.com'),e=>e.code==='feedback_email_sender_setup');
  let row=db.sql.prepare('SELECT status,retry_safe FROM feedback_reports').get();
  assert.equal(row.status,'failed');assert.equal(row.retry_safe,1);
  const response=await feedbackRouter(req(key),env,'u1','u@example.com');
  assert.equal(response.status,201);assert.equal(calls,2);
  row=db.sql.prepare('SELECT status,retry_safe,message_id FROM feedback_reports').get();
  assert.equal(row.status,'sent');assert.equal(row.retry_safe,0);assert.equal(row.message_id,'accepted');
  const repeat=await feedbackRouter(req(key),env,'u1','u@example.com');
  assert.equal(repeat.status,200);assert.equal(calls,2);
});
test('Resend DEV sends directly to the fixed inbox with attachments and idempotency key',async()=>{
  const previous=globalThis.fetch;
  let captured;
  globalThis.fetch=async(url,options)=>{
    assert.equal(url,'https://api.resend.com/emails');
    captured={...options,body:JSON.parse(options.body)};
    return Response.json({id:'resend-message-id'},{status:200});
  };
  try{
    const result=await sendFeedbackEmail({ENVIRONMENT:'dev',RESEND_API_KEY:'secret-token'},baseMail);
    assert.equal(result.messageId,'resend-message-id');
    assert.equal(captured.headers.Authorization,'Bearer secret-token');
    assert.equal(captured.headers['Idempotency-Key'],'roteiva-feedback/'+baseMail.id);
    assert.equal(captured.body.from,'Roteiva DEV <onboarding@resend.dev>');
    assert.deepEqual(captured.body.to,['suporte.roteiva@gmail.com']);
    assert.equal(captured.body.reply_to,'owner@example.com');
    assert.deepEqual(new Uint8Array(Buffer.from(captured.body.attachments[0].content,'base64')),baseMail.attachments[0].content);
  }finally{globalThis.fetch=previous;}
});
test('DEV direct sender rejects unconfigured account with a safe, repeatable error',async()=>{
  const previous=globalThis.fetch;
  globalThis.fetch=async()=>Response.json({message:'Sandbox account mismatch'},{status:403});
  try{
    await assert.rejects(()=>sendFeedbackEmail({ENVIRONMENT:'dev',RESEND_API_KEY:'test'},baseMail),e=>
      e instanceof FeedbackDeliveryFailure&&e.safeToRetry&&e.code==='feedback_dev_email_setup');
  }finally{globalThis.fetch=previous;}
});
test('old ambiguous failed attempts never become eligible for same-key retry',async t=>{
  const db=database();t.after(db.close);
  const key=crypto.randomUUID();
  db.sql.prepare("INSERT INTO feedback_reports (id,owner_uid,request_key,kind,title,description,screen,status,attachment_count,created_at) VALUES (?,?,?,?,?,?,?,'failed',0,?)")
    .run(crypto.randomUUID(),'owner',key,'bug','example title','description of problem','/projetos',Date.now());
  let calls=0;
  const env={ENVIRONMENT:'prod',DB:db.DB,FEEDBACK_EMAIL:{send:async()=>{calls++;return {messageId:'x'};}}};
  await assert.rejects(()=>feedbackRouter(req(key),env,'owner','owner@example.com'),e=>e.code==='feedback_already_attempted');
  assert.equal(calls,0);
  assert.equal((await feedbackRouter(req(),env,'owner','owner@example.com')).status,201);
});
