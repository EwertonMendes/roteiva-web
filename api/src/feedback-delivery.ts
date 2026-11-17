import type {Env} from './types.ts';

export type FeedbackAttachment={content:Uint8Array;filename:string;type:string;disposition:'attachment'};
export type FeedbackMail={
  id:string;email:string;kindLabel:string;title:string;description:string;screen:string;
  attachments:FeedbackAttachment[];
};

export class FeedbackDeliveryFailure extends Error{
  constructor(public code:string,public safeToRetry:boolean,public status=503){
    super(code);
  }
}
const DESTINATION='suporte.roteiva@gmail.com';
export function feedbackEnabled(env:Env):boolean{
  return env.ENVIRONMENT==='prod'?!!env.FEEDBACK_EMAIL:
    env.ENVIRONMENT==='dev'?!!env.RESEND_API_KEY:false;
}
function verifiedReplyTo(email:string):string|undefined{
  return /^[^\s<>@\r\n]{1,64}@[^\s<>@\r\n]{1,253}$/.test(email)?email:undefined;
}
function summary(env:Env,mail:FeedbackMail):{subject:string;text:string;replyTo?:string}{
  return {
    subject:'[Roteiva '+env.ENVIRONMENT.toUpperCase()+'] '+mail.kindLabel+' #'+mail.id.slice(0,8),
    replyTo:verifiedReplyTo(mail.email),
    text:[
      'Novo feedback do Roteiva','Protocolo: '+mail.id,
      'Categoria: '+mail.kindLabel,'Assunto: '+mail.title,
      'E-mail verificado: '+mail.email,'Ambiente: '+env.ENVIRONMENT,
      'Tela: '+mail.screen,'Capturas anexadas: '+mail.attachments.length,
      '',mail.description
    ].join('\n')
  };
}
const DEFINITE_REJECTIONS=new Set([
  'E_VALIDATION_ERROR','E_FIELD_MISSING','E_TOO_MANY_RECIPIENTS','E_TOO_MANY_ATTACHMENTS',
  'E_SENDER_NOT_VERIFIED','E_SENDER_DOMAIN_NOT_AVAILABLE','E_SENDER_DOMAIN_NOT_CONFIGURED',
  'E_EMAIL_SENDING_NOT_READY','E_RECIPIENT_NOT_ALLOWED','E_CONTENT_TOO_LARGE',
  'E_HEADER_NOT_ALLOWED','E_HEADER_USE_API_FIELD','E_HEADER_VALUE_INVALID',
  'E_HEADER_VALUE_TOO_LONG','E_HEADER_NAME_INVALID','E_HEADERS_TOO_LARGE','E_HEADERS_TOO_MANY',
  'E_RATE_LIMIT_EXCEEDED','E_DAILY_LIMIT_EXCEEDED'
]);
function providerErrorCode(error:unknown):string{
  if(error&&typeof error==='object'&&'code' in error&&typeof error.code==='string'&&
    /^E_[A-Z_]{3,65}$/.test(error.code))return error.code;
  return error instanceof TypeError?'INVALID_ARGUMENT':'UNKNOWN';
}
function classifyCloudflare(error:unknown,id:string):FeedbackDeliveryFailure{
  const providerCode=providerErrorCode(error);
  console.error(JSON.stringify({event:'feedback_email_send_rejected',provider:'cloudflare',providerCode,reportId:id}));
  if(providerCode.includes('SENDER_DOMAIN')||providerCode==='E_SENDER_NOT_VERIFIED'||providerCode==='E_EMAIL_SENDING_NOT_READY')
    return new FeedbackDeliveryFailure('feedback_email_sender_setup',true);
  if(providerCode==='E_RECIPIENT_NOT_ALLOWED')
    return new FeedbackDeliveryFailure('feedback_email_recipient_setup',true);
  if(providerCode==='E_RATE_LIMIT_EXCEEDED'||providerCode==='E_DAILY_LIMIT_EXCEEDED')
    return new FeedbackDeliveryFailure('feedback_delivery_busy',true,429);
  if(providerCode==='INVALID_ARGUMENT'||DEFINITE_REJECTIONS.has(providerCode))
    return new FeedbackDeliveryFailure('feedback_email_provider_rejected',true);
  // Transport errors or delivery uncertainty must not be retried automatically.
  return new FeedbackDeliveryFailure('feedback_delivery_unconfirmed',false);
}
function toBase64(bytes:Uint8Array):string{
  const parts:string[]=[];
  for(let i=0;i<bytes.byteLength;i+=8190){
    const data=bytes.subarray(i,i+8190);
    let chunk='';
    for(const byte of data)chunk+=String.fromCharCode(byte);
    parts.push(btoa(chunk));
  }
  // Each individual chunk is encoded independently; strip padding except final chunk
  // before concatenating to produce a single valid Base64 stream.
  return parts.map((part,index)=>index<parts.length-1?part.replace(/=+$/,''):part).join('');
}
async function sendDevResend(env:Env,mail:FeedbackMail):Promise<{messageId:string}>{
  const key=env.RESEND_API_KEY;
  if(!key)throw new FeedbackDeliveryFailure('feedback_unavailable',true);
  const body=summary(env,mail);
  let response:Response;
  try{
    response=await fetch('https://api.resend.com/emails',{
      method:'POST',
      headers:{
        Authorization:'Bearer '+key,'Content-Type':'application/json',
        'Idempotency-Key':'roteiva-feedback/'+mail.id
      },
      body:JSON.stringify({
        from:'Roteiva DEV <onboarding@resend.dev>',to:[DESTINATION],
        subject:body.subject,text:body.text,
        ...(body.replyTo?{reply_to:body.replyTo}:{}),
        attachments:mail.attachments.map(attachment=>({
          filename:attachment.filename,content:toBase64(attachment.content)
        }))
      }),
      signal:AbortSignal.timeout(15000)
    });
  }catch{
    console.error(JSON.stringify({event:'feedback_email_send_uncertain',provider:'resend',reportId:mail.id}));
    throw new FeedbackDeliveryFailure('feedback_delivery_unconfirmed',false);
  }
  if(!response.ok){
    // Do not store/log provider response text: it may echo sensitive message content.
    const status=response.status;
    console.error(JSON.stringify({event:'feedback_email_send_rejected',provider:'resend',status,reportId:mail.id}));
    if(status===401||status===403||status===422||status===400)
      throw new FeedbackDeliveryFailure('feedback_dev_email_setup',true);
    if(status===429)throw new FeedbackDeliveryFailure('feedback_delivery_busy',true,429);
    if(status>=500)throw new FeedbackDeliveryFailure('feedback_delivery_unconfirmed',false);
    throw new FeedbackDeliveryFailure('feedback_email_provider_rejected',true);
  }
  const result=await response.json().catch(()=>null) as {id?:unknown}|null;
  if(!result||typeof result.id!=='string'||!result.id)
    throw new FeedbackDeliveryFailure('feedback_delivery_unconfirmed',false);
  return {messageId:result.id};
}
export async function sendFeedbackEmail(env:Env,mail:FeedbackMail):Promise<{messageId:string}>{
  if(env.ENVIRONMENT==='dev')return sendDevResend(env,mail);
  if(env.ENVIRONMENT!=='prod'||!env.FEEDBACK_EMAIL)
    throw new FeedbackDeliveryFailure('feedback_unavailable',true);
  const body=summary(env,mail);
  try{
    return await env.FEEDBACK_EMAIL.send({
      to:DESTINATION,from:'suporte@roteiva.com',
      subject:body.subject,text:body.text,
      ...(body.replyTo?{replyTo:body.replyTo}:{}),
      attachments:mail.attachments
    });
  }catch(error){throw classifyCloudflare(error,mail.id);}
}
