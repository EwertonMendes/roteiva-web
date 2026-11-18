import type {Env} from './types.ts';

export type FeedbackAttachment={content:Uint8Array;filename:string;type:string;disposition:'attachment'};
export type FeedbackMail={
  id:string;email:string;kindLabel:string;title:string;description:string;screen:string;
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

// No Cloudflare Email Sending binding or paid service: both Workers use the same
// free transactional API but keep independent, environment-scoped secret keys.
const DESTINATION='suporte.roteiva@gmail.com';
const RESEND_ENDPOINT='https://api.resend.com/emails';
const TEST_SENDER='onboarding@resend.dev';
const VERIFIED_SENDER='suporte@roteiva.com';

export function feedbackEnabled(env:Env):boolean{
  return (env.ENVIRONMENT==='dev'||env.ENVIRONMENT==='prod')&&
    typeof env.RESEND_API_KEY==='string'&&env.RESEND_API_KEY.trim().length>0;
}
function verifiedReplyTo(email:string):string|undefined{
  return /^[^\s<>@\r\n]{1,64}@[^\s<>@\r\n]{1,253}$/.test(email)?email:undefined;
}
function senderAddress(env:Env):string{
  if(!env.RESEND_FROM_EMAIL)return TEST_SENDER;
  if(env.RESEND_FROM_EMAIL!==VERIFIED_SENDER)
    throw new FeedbackDeliveryFailure('feedback_email_sender_setup',true);
  return VERIFIED_SENDER;
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

export async function sendFeedbackEmail(env:Env,mail:FeedbackMail):Promise<{messageId:string}>{
  if(!feedbackEnabled(env))throw new FeedbackDeliveryFailure('feedback_unavailable',true);
  const body=summary(env,mail);
  const from=senderAddress(env);
  let response:Response;
  try{
    response=await fetch(RESEND_ENDPOINT,{
      method:'POST',
      redirect:'error',
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
        ...(body.replyTo?{reply_to:body.replyTo}:{}),
        attachments:mail.attachments.map(item=>({
          filename:item.filename,
          content:toBase64(item.content)
        }))
      }),
      signal:AbortSignal.timeout(15000)
    });
  }catch{
    // A broken connection may happen after Resend accepted the message.
    console.error(JSON.stringify({event:'feedback_delivery_uncertain',provider:'resend',reportId:mail.id}));
    throw new FeedbackDeliveryFailure('feedback_delivery_unconfirmed',false);
  }
  if(!response.ok){
    // Never log the provider error body, message text, personal data or API key.
    console.error(JSON.stringify({event:'feedback_delivery_rejected',provider:'resend',status:response.status,reportId:mail.id}));
    if([400,401,403,422].includes(response.status))
      throw new FeedbackDeliveryFailure('feedback_email_sender_setup',true);
    if(response.status===429)
      throw new FeedbackDeliveryFailure('feedback_delivery_busy',true,429);
    if(response.status>=500)
      throw new FeedbackDeliveryFailure('feedback_delivery_unconfirmed',false);
    throw new FeedbackDeliveryFailure('feedback_email_provider_rejected',true);
  }
  const receipt=await response.json().catch(()=>null) as {id?:unknown}|null;
  if(!receipt||typeof receipt.id!=='string'||!receipt.id)
    throw new FeedbackDeliveryFailure('feedback_delivery_unconfirmed',false);
  return {messageId:receipt.id};
}
