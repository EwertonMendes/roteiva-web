import type {Env} from './types.ts';
import {composeFeedbackEmail} from './feedback-email.ts';

export type FeedbackAttachment={content:Uint8Array;filename:string;type:string;disposition:'attachment'};
export type FeedbackMail={
  id:string;email:string;kindLabel:string;title:string;description:string;
  attachments:FeedbackAttachment[];
};

export class FeedbackDeliveryFailure extends Error{
  code:string;
  safeToRetry:boolean;
  status:number;
  constructor(code:string,safeToRetry:boolean,status=503){
    super(code);
    this.code=code;
    this.safeToRetry=safeToRetry;
    this.status=status;
  }
}

// DEV uses the Resend secret already configured on its Worker.
// PROD uses Cloudflare's free verified-destination email binding exclusively.
// Neither environment can silently fall back to the other's provider.
const DESTINATION='suporte.roteiva@gmail.com';
const RESEND_ENDPOINT='https://api.resend.com/emails';
const TEST_SENDER='onboarding@resend.dev';
const VERIFIED_SENDER='suporte@roteiva.com';

export function feedbackEnabled(env:Env):boolean{
  if(env.ENVIRONMENT==='prod')return !!env.FEEDBACK_EMAIL;
  if(env.ENVIRONMENT==='dev')return typeof env.RESEND_API_KEY==='string'&&env.RESEND_API_KEY.trim().length>0;
  return false;
}
function senderAddress(env:Env):string{
  if(!env.RESEND_FROM_EMAIL)return TEST_SENDER;
  if(env.RESEND_FROM_EMAIL!==VERIFIED_SENDER)
    throw new FeedbackDeliveryFailure('feedback_email_sender_setup',true);
  return VERIFIED_SENDER;
}
function toBase64(bytes:Uint8Array):string{
  // Chunk size is a multiple of 3 so independently base64-encoded chunks can
  // be concatenated without broken padding. Bounds peak string allocations.
  const chunks:string[]=[];
  for(let offset=0;offset<bytes.byteLength;offset+=8190){
    const slice=bytes.subarray(offset,offset+8190);
    let binary='';
    for(const byte of slice)binary+=String.fromCharCode(byte);
    chunks.push(btoa(binary));
  }
  return chunks.join('');
}

function classifyCloudflareError(error:unknown,reportId:string):FeedbackDeliveryFailure{
  const providerCode=error&&typeof error==='object'&&'code' in error&&
    typeof error.code==='string'&&/^E_[A-Z_]{3,65}$/.test(error.code)?error.code:'UNKNOWN';
  console.error(JSON.stringify({event:'feedback_delivery_rejected',provider:'cloudflare',providerCode,reportId}));
  if(error instanceof TypeError)return new FeedbackDeliveryFailure('feedback_email_provider_rejected',true);
  if(['E_SENDER_DOMAIN_NOT_AVAILABLE','E_SENDER_DOMAIN_NOT_CONFIGURED',
    'E_SENDER_NOT_VERIFIED','E_EMAIL_SENDING_NOT_READY'].includes(providerCode))
    return new FeedbackDeliveryFailure('feedback_email_sender_setup',true);
  if(['E_RECIPIENT_NOT_ALLOWED','E_RECIPIENT_PLAN_RESTRICTED','E_RECIPIENT_SUPPRESSED'].includes(providerCode))
    return new FeedbackDeliveryFailure('feedback_email_recipient_setup',true);
  if(['E_RATE_LIMIT_EXCEEDED','E_DAILY_LIMIT_EXCEEDED'].includes(providerCode))
    return new FeedbackDeliveryFailure('feedback_delivery_busy',true,429);
  if(['E_VALIDATION_ERROR','E_TOO_MANY_RECIPIENTS','E_TOO_MANY_ATTACHMENTS',
    'E_CONTENT_TOO_LARGE','E_FIELD_MISSING','E_HEADER_NOT_ALLOWED','E_HEADER_USE_API_FIELD',
    'E_HEADER_VALUE_INVALID','E_HEADER_VALUE_TOO_LONG','E_HEADER_NAME_INVALID',
    'E_HEADERS_TOO_LARGE','E_HEADERS_TOO_MANY'].includes(providerCode))
    return new FeedbackDeliveryFailure('feedback_email_provider_rejected',true);
  // Network/service failures may have occurred after acceptance. Never auto-resend.
  return new FeedbackDeliveryFailure('feedback_delivery_unconfirmed',false);
}
async function sendCloudflare(env:Env,mail:FeedbackMail):Promise<{messageId:string}>{
  if(!env.FEEDBACK_EMAIL)throw new FeedbackDeliveryFailure('feedback_unavailable',true);
  const body=composeFeedbackEmail(env.ENVIRONMENT,{...mail,attachmentCount:mail.attachments.length});
  try{
    const result=await env.FEEDBACK_EMAIL.send({
      from:VERIFIED_SENDER,to:DESTINATION,subject:body.subject,text:body.text,html:body.html,
      ...(body.replyTo?{replyTo:body.replyTo}:{}),
      attachments:mail.attachments
    });
    if(!result||typeof result.messageId!=='string'||!result.messageId)
      throw new FeedbackDeliveryFailure('feedback_delivery_unconfirmed',false);
    return {messageId:result.messageId};
  }catch(error){
    if(error instanceof FeedbackDeliveryFailure)throw error;
    throw classifyCloudflareError(error,mail.id);
  }
}
export async function sendFeedbackEmail(env:Env,mail:FeedbackMail):Promise<{messageId:string}>{
  if(!feedbackEnabled(env))throw new FeedbackDeliveryFailure('feedback_unavailable',true);
  if(env.ENVIRONMENT==='prod')return sendCloudflare(env,mail);
  if(env.ENVIRONMENT!=='dev')throw new FeedbackDeliveryFailure('feedback_unavailable',true);
  const body=composeFeedbackEmail(env.ENVIRONMENT,{...mail,attachmentCount:mail.attachments.length});
  const from=senderAddress(env);
  let response:Response;
  try{
    response=await fetch(RESEND_ENDPOINT,{
      method:'POST',
      // Workers does not support redirect:'error'. Manual prevents credentials leaking through redirects.
      redirect:'manual',
      headers:{
        'Authorization':'Bearer '+env.RESEND_API_KEY,
        'Content-Type':'application/json',
        'Idempotency-Key':'roteiva-feedback/'+mail.id
      },
      body:JSON.stringify({
        from:'Roteiva '+env.ENVIRONMENT.toUpperCase()+' <'+from+'>',
        to:[DESTINATION],
        subject:body.subject,
        text:body.text,
        html:body.html,
        ...(body.replyTo?{reply_to:body.replyTo}:{}),
        attachments:mail.attachments.map(item=>({
          filename:item.filename,
          content:toBase64(item.content)
        }))
      }),
      signal:AbortSignal.timeout(15000)
    });
  }catch(error){
    // Transport failure may happen after provider acceptance: no automatic retry.
    const transportError=error instanceof Error&&['TimeoutError','AbortError','TypeError'].includes(error.name)?error.name:'UNKNOWN';
    console.error(JSON.stringify({event:'feedback_delivery_uncertain',provider:'resend',transportError,reportId:mail.id}));
    throw new FeedbackDeliveryFailure('feedback_delivery_unconfirmed',false);
  }
  if(!response.ok){
    // Error-name only, never provider message/body/user content; bounded read.
    const raw=await response.text().then(body=>body.slice(0,512)).catch(()=>'');
    let parsed:unknown;
    try{parsed=JSON.parse(raw);}catch{parsed=null;}
    const candidate=parsed&&typeof parsed==='object'&&'name' in parsed?parsed.name:null;
    const providerName=typeof candidate==='string'&&/^[a-z_]{3,48}$/.test(candidate)?candidate:'UNKNOWN';
    const status=response.status;
    console.error(JSON.stringify({event:'feedback_delivery_rejected',provider:'resend',status,providerName,reportId:mail.id}));
    if(status===401)throw new FeedbackDeliveryFailure('feedback_dev_email_auth',true);
    if(status===403)throw new FeedbackDeliveryFailure('feedback_dev_email_setup',true);
    if(status===400||status===422)throw new FeedbackDeliveryFailure('feedback_email_provider_rejected',true);
    if(status===429)throw new FeedbackDeliveryFailure('feedback_delivery_busy',true,429);
    if(status>=500)throw new FeedbackDeliveryFailure('feedback_delivery_unconfirmed',false);
    throw new FeedbackDeliveryFailure('feedback_email_provider_rejected',true);
  }
  const receipt=await response.json().catch(()=>null) as {id?:unknown}|null;
  if(!receipt||typeof receipt.id!=='string'||!receipt.id){
    console.error(JSON.stringify({event:'feedback_resend_receipt_invalid',reportId:mail.id}));
    throw new FeedbackDeliveryFailure('feedback_delivery_unconfirmed',false);
  }
  return {messageId:receipt.id};
}
