import test from 'node:test';
import assert from 'node:assert/strict';
import {database} from './helpers/database.mjs';
import {sendFeedbackEmail,feedbackEnabled,FeedbackDeliveryFailure} from '../src/feedback-delivery.ts';
import {feedbackRouter} from '../src/feedback.ts';

const png=new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0]);
const mail={
  id:'950f6b51-a331-427d-940c-4e21ed5d86e5',
  email:'owner@example.com',
  kindLabel:'Problema',
  title:'Tela não abre',
  description:'O erro aparece ao abrir o calendário de projetos.',
  screen:'/projetos',
  attachments:[{content:png,filename:'captura-01.png',type:'image/png',disposition:'attachment'}]
};
function request(key=crypto.randomUUID()){
  const form=new FormData();
  form.set('requestKey',key);
  form.set('kind','bug');
  form.set('title','Problema com o calendário');
  form.set('description','O botão não responde no modal de projetos.');
  form.set('screen','/projetos');
  return new Request('https://api.roteiva.com/feedback',{method:'POST',body:form});
}
test('production is enabled by Cloudflare binding, not by Resend key',async()=>{
  assert.equal(feedbackEnabled({ENVIRONMENT:'prod',RESEND_API_KEY:'re_not_used'}),false);
  assert.equal(feedbackEnabled({ENVIRONMENT:'dev',FEEDBACK_EMAIL:{send(){throw Error('not used');}}}),false);
  assert.equal(feedbackEnabled({ENVIRONMENT:'prod',FEEDBACK_EMAIL:{send(){}}}),true);
  assert.equal(feedbackEnabled({ENVIRONMENT:'dev',RESEND_API_KEY:'re_dev'}),true);
  await assert.rejects(
    ()=>sendFeedbackEmail({ENVIRONMENT:'prod',RESEND_API_KEY:'re_no_fallback'},mail),
    e=>e instanceof FeedbackDeliveryFailure&&e.code==='feedback_unavailable'
  );
});
test('Cloudflare PROD delivers with fixed sender, sole verified Gmail, and raw attachments; never calls Resend',async t=>{
  const original=globalThis.fetch;
  t.after(()=>{globalThis.fetch=original;});
  globalThis.fetch=async()=>{throw Error('PROD must not call external Resend API');};
  const calls=[];
  const env={ENVIRONMENT:'prod',RESEND_API_KEY:'re_should_be_ignored',
    FEEDBACK_EMAIL:{async send(message){calls.push(message);return {messageId:'cf-message-1'};}}};
  const receipt=await sendFeedbackEmail(env,mail);
  assert.equal(receipt.messageId,'cf-message-1');
  assert.equal(calls.length,1);
  const message=calls[0];
  assert.equal(message.from,'suporte@roteiva.com');
  assert.equal(message.to,'suporte.roteiva@gmail.com');
  assert.equal(message.replyTo,'owner@example.com');
  assert.match(message.subject,/Roteiva PROD/);
  assert.equal(message.attachments.length,1);
  assert.equal(message.attachments[0].filename,'captura-01.png');
  assert.deepEqual(message.attachments[0].content,png);
});
test('Cloudflare error codes preserve safe retry and never log private payloads',async()=>{
  for(const [code,expected,safeToRetry,status] of [
    ['E_SENDER_DOMAIN_NOT_CONFIGURED','feedback_email_sender_setup',true,503],
    ['E_SENDER_DOMAIN_NOT_AVAILABLE','feedback_email_sender_setup',true,503],
    ['E_RECIPIENT_PLAN_RESTRICTED','feedback_email_recipient_setup',true,503],
    ['E_RECIPIENT_NOT_ALLOWED','feedback_email_recipient_setup',true,503],
    ['E_RATE_LIMIT_EXCEEDED','feedback_delivery_busy',true,429],
    ['E_CONTENT_TOO_LARGE','feedback_email_provider_rejected',true,503],
    ['E_INTERNAL_SERVER_ERROR','feedback_delivery_unconfirmed',false,503]
  ]){
    await assert.rejects(
      ()=>sendFeedbackEmail({ENVIRONMENT:'prod',FEEDBACK_EMAIL:{async send(){
        throw Object.assign(new Error('contains sensitive user data'),{code});
      }}},mail),
      e=>e instanceof FeedbackDeliveryFailure&&e.code===expected&&e.safeToRetry===safeToRetry&&e.status===status
    );
  }
  await assert.rejects(
    ()=>sendFeedbackEmail({ENVIRONMENT:'prod',FEEDBACK_EMAIL:{async send(){throw Error('network unknown');}}},mail),
    e=>e instanceof FeedbackDeliveryFailure&&e.code==='feedback_delivery_unconfirmed'&&!e.safeToRetry
  );
});
test('PROD feedback router stores owner metadata only and respects idempotency',async t=>{
  const db=database();t.after(db.close);
  let sent=0;
  const env={ENVIRONMENT:'prod',DB:db.DB,FEEDBACK_EMAIL:{async send(message){
    sent++;
    assert.equal(message.to,'suporte.roteiva@gmail.com');
    return {messageId:'cloudflare-'+sent};
  }}};
  const key=crypto.randomUUID();
  const response=await feedbackRouter(request(key),env,'owner1','owner@example.com');
  assert.equal(response.status,201);
  assert.equal((await response.json()).status,'received');
  const repeated=await feedbackRouter(request(key),env,'owner1','owner@example.com');
  assert.equal(repeated.status,200);
  assert.equal(sent,1);
  const row=db.sql.prepare('SELECT owner_uid,status,message_id FROM feedback_reports').get();
  assert.equal(row.owner_uid,'owner1');
  assert.equal(row.status,'sent');
  assert.equal(row.message_id,'cloudflare-1');
  assert.equal(db.sql.prepare('SELECT COUNT(*) n FROM feedback_reports').get().n,1);
});
