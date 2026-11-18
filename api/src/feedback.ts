import {ApiError,type Env} from './types.ts';
import {feedbackEnabled,sendFeedbackEmail,FeedbackDeliveryFailure,type FeedbackAttachment} from './feedback-delivery.ts';

export const MAX_FEEDBACK_IMAGES=5;
export const MAX_FEEDBACK_FILE_BYTES=1024*1024;
export const MAX_FEEDBACK_BODY_BYTES=6*1024*1024;
// PROD counts confirmed or in-flight sends in a rolling hour. DEV has no
// application-level per-user quota; authentication and global API throttling stay on.
const PROD_HOURLY_LIMIT=20;
const PROD_HOURLY_ATTEMPT_LIMIT=40;
const HOUR_MS=60*60*1000;
type Kind='bug'|'idea'|'praise'|'other';
const kinds:Record<Kind,string>={bug:'Problema',idea:'Sugestão',praise:'Elogio',other:'Outro assunto'};


function one(form:FormData,name:string):string{
  const values=form.getAll(name);
  if(values.length!==1||typeof values[0]!=='string')throw new ApiError(400,'feedback_invalid_form');
  return values[0];
}
function text(value:string,min:number,max:number):string{
  const result=value.trim();
  if(result.length<min||result.length>max||/[\u0000-\u0008\u000b\u000e-\u001f\u007f]/.test(result))
    throw new ApiError(400,'feedback_invalid_form');
  return result;
}
function imageMime(bytes:Uint8Array):string|null{
  if(bytes.length>=8&&[137,80,78,71,13,10,26,10].every((b,i)=>bytes[i]===b))return 'image/png';
  if(bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';
  if(bytes.length>=12&&[82,73,70,70].every((b,i)=>bytes[i]===b)&&
    [87,69,66,80].every((b,i)=>bytes[i+8]===b))return 'image/webp';
  return null;
}
async function boundedForm(request:Request):Promise<FormData>{
  const type=request.headers.get('Content-Type')||'';
  if(!/^multipart\/form-data;\s*boundary=/i.test(type))throw new ApiError(415,'feedback_invalid_content_type');
  const size=Number(request.headers.get('Content-Length')||'0');
  if(!Number.isFinite(size)||size>MAX_FEEDBACK_BODY_BYTES)throw new ApiError(413,'feedback_too_large');
  const reader=request.body?.getReader();
  if(!reader)throw new ApiError(400,'feedback_invalid_form');
  let total=0;
  const chunks:Uint8Array[]=[];
  try{
    while(true){
      const {done,value}=await reader.read();
      if(done)break;
      total+=value.byteLength;
      if(total>MAX_FEEDBACK_BODY_BYTES)throw new ApiError(413,'feedback_too_large');
      chunks.push(value);
    }
  }catch(error){
    await reader.cancel().catch(()=>undefined);
    throw error;
  }finally{reader.releaseLock();}
  const buffer=new Uint8Array(total);
  let offset=0;
  for(const chunk of chunks){buffer.set(chunk,offset);offset+=chunk.byteLength;}
  try{return await new Response(buffer,{headers:{'Content-Type':type}}).formData();}
  catch{throw new ApiError(400,'feedback_invalid_form');}
}
export async function parseFeedback(request:Request){
  const form=await boundedForm(request);
  for(const key of form.keys()){
    if(!['kind','title','description','screen','requestKey','images'].includes(key))
      throw new ApiError(400,'feedback_invalid_form');
  }
  const kind=one(form,'kind');
  if(!Object.hasOwn(kinds,kind))throw new ApiError(400,'feedback_invalid_form');
  const title=text(one(form,'title'),5,120);
  const description=text(one(form,'description'),15,4000);
  const screen=one(form,'screen');
  if(!/^\/[a-zA-Z0-9_/-]{0,150}$/.test(screen))throw new ApiError(400,'feedback_invalid_form');
  const requestKey=one(form,'requestKey');
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestKey))
    throw new ApiError(400,'feedback_invalid_form');
  const files=form.getAll('images');
  if(files.length>MAX_FEEDBACK_IMAGES)throw new ApiError(400,'feedback_too_many_images');
  const attachments:FeedbackAttachment[]=[];
  for(let i=0;i<files.length;i++){
    const file=files[i];
    if(!(file instanceof File)||file.size<12||file.size>MAX_FEEDBACK_FILE_BYTES)
      throw new ApiError(413,'feedback_invalid_image');
    const bytes=new Uint8Array(await file.arrayBuffer());
    const mime=imageMime(bytes);
    if(!mime||file.type!==mime)throw new ApiError(415,'feedback_invalid_image');
    const ext=mime==='image/png'?'png':mime==='image/jpeg'?'jpg':'webp';
    attachments.push({content:bytes,filename:'captura-'+String(i+1).padStart(2,'0')+'.'+ext,type:mime,disposition:'attachment'});
  }
  return {kind:kind as Kind,title,description,screen,requestKey,attachments};
}
export async function feedbackRouter(request:Request,env:Env,uid:string,email:string):Promise<Response>{
  if(request.method!=='POST')throw new ApiError(405,'method_not_allowed');
  // Fail closed when the environment-specific delivery binding/key is absent.
  if(!feedbackEnabled(env))throw new ApiError(503,'feedback_unavailable');
  const feedback=await parseFeedback(request);
  const now=Date.now();
  let id=crypto.randomUUID();
  // Quota is evaluated in the D1 conditional write, not a separate read.
  // Existing sent requests stay idempotent even after the quota is reached.
  const isProd=env.ENVIRONMENT==='prod';
  const quotaPredicate=isProd
    ? "(SELECT COUNT(*) FROM feedback_reports WHERE owner_uid=? AND created_at>=? AND status IN ('sending','sent'))<? "+
      "AND (SELECT COUNT(*) FROM feedback_reports WHERE owner_uid=? AND created_at>=?)<?"
    : "1=1";
  const quotaValues=isProd
    ? [uid,now-HOUR_MS,PROD_HOURLY_LIMIT,uid,now-HOUR_MS,PROD_HOURLY_ATTEMPT_LIMIT]
    : [];
  let id=crypto.randomUUID();
  const created=await env.DB.prepare(
    "INSERT INTO feedback_reports (id,owner_uid,request_key,kind,title,description,screen,status,attachment_count,created_at) "+
    "SELECT ?,?,?,?,?,?,?,'sending',?,? WHERE "+quotaPredicate+
    " ON CONFLICT(owner_uid,request_key) DO NOTHING RETURNING id"
  ).bind(id,uid,feedback.requestKey,feedback.kind,feedback.title,feedback.description,
    feedback.screen,feedback.attachments.length,now,...quotaValues).first<{id:string}>();
  if(!created){
    const previous=await env.DB.prepare('SELECT id,status,retry_safe FROM feedback_reports WHERE owner_uid=? AND request_key=?')
      .bind(uid,feedback.requestKey).first<{id:string;status:string;retry_safe:number}>();
    if(previous?.status==='sent')return Response.json({id:previous.id,status:'received',duplicate:true});
    if(previous?.status==='failed'&&previous.retry_safe===1){
      // Only definitive provider rejections may retry, at most 3 tries per key.
      const renewed=await env.DB.prepare(
        "UPDATE feedback_reports SET status='sending',retry_safe=0,created_at=?,attempt_count=attempt_count+1,kind=?,title=?,description=?,screen=?,attachment_count=? "+
        "WHERE owner_uid=? AND request_key=? AND status='failed' AND retry_safe=1 AND attempt_count<3 AND "+
        quotaPredicate+" RETURNING id"
      ).bind(now,feedback.kind,feedback.title,feedback.description,feedback.screen,feedback.attachments.length,
        uid,feedback.requestKey,...quotaValues).first<{id:string}>();
      if(!renewed)throw new ApiError(429,isProd?'feedback_hourly_limit':'feedback_already_attempted');
      id=renewed.id;
    }else if(previous)throw new ApiError(409,'feedback_already_attempted');
    else throw new ApiError(429,isProd?'feedback_hourly_limit':'rate_limited');
  }
  let messageId:string;
  try{
    const receipt=await sendFeedbackEmail(env,{
      id,email,kindLabel:kinds[feedback.kind],title:feedback.title,description:feedback.description,
      attachments:feedback.attachments
    });
    messageId=receipt.messageId;
  }catch(error){
    const failure=error instanceof FeedbackDeliveryFailure?error:
      new FeedbackDeliveryFailure('feedback_delivery_unconfirmed',false);
    // Definitive provider rejections can be retried within the environment's guards.
    // Unknown outcomes stay 'sending' to avoid silently resending possibly accepted mail.
    if(failure.safeToRetry){
      await env.DB.prepare("UPDATE feedback_reports SET status='failed',retry_safe=1 WHERE id=? AND owner_uid=? AND status='sending'")
        .bind(id,uid).run().catch(()=>undefined);
    }
    throw new ApiError(failure.status,failure.code);
  }
  try{
    const result=await env.DB.prepare("UPDATE feedback_reports SET status='sent',message_id=?,sent_at=? WHERE id=? AND owner_uid=? AND status='sending'")
      .bind(messageId,Date.now(),id,uid).run();
    if(result.meta.changes!==1)throw new Error('status_not_persisted');
  }catch{
    // Provider accepted the message: never trigger another send as a fallback.
    console.error(JSON.stringify({event:'feedback_delivery_record_not_confirmed',reportId:id}));
    throw new ApiError(503,'feedback_delivery_unconfirmed');
  }
  return Response.json({id,status:'received'},{status:201});
}
