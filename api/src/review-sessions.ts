import {ApiError,type Env} from './types.ts';
import {hash,random} from './crypto.ts';
export type ReviewSession={id_hash:string;review_id:string;version:number;invite_hash:string;viewer_subject:string|null;expires_at:number;created_at:number};
export type SessionReview={id:string;current_version:number;token_hash:string;expires_at:number};
const ID=/^[A-Za-z0-9_-]{43}$/;
const IDLE=30*60*1000,MAX=8*60*60*1000;
export async function sessionSubject(uid:string,googleSubject:string){return hash('roteiva/review-session/subject/v1/'+uid+':'+googleSubject);}
export async function openReviewSession(env:Env,review:SessionReview,subject:string|null){
 const secret=random(),now=Date.now(),expiresAt=Math.min(review.expires_at,now+IDLE);
 const inserted=await env.DB.prepare(`INSERT INTO review_sessions(id_hash,review_id,version,invite_hash,viewer_subject,expires_at,created_at)
 SELECT ?,?,?,?,?,?,? WHERE (SELECT count(*) FROM review_sessions WHERE review_id=? AND expires_at>?)<500`)
 .bind(await hash(secret),review.id,review.current_version,review.token_hash,subject,expiresAt,now,review.id,now).run();
 if(inserted.meta.changes!==1)throw new ApiError(429,'review_session_limit');
 return Response.json({session:secret,expiresAt});
}
export async function loadReviewSession(env:Env,secret:string){
 if(!ID.test(secret))throw new ApiError(401,'review_session_required');
 const row=await env.DB.prepare('SELECT * FROM review_sessions WHERE id_hash=? AND expires_at>?').bind(await hash(secret),Date.now()).first<ReviewSession>();
 if(!row||row.created_at+MAX<=Date.now())throw new ApiError(401,'review_session_expired');
 return row;
}
export function assertReviewSession(session:ReviewSession,review:SessionReview,subject:string|null){
 if(session.review_id!==review.id||session.version!==review.current_version||session.invite_hash!==review.token_hash||session.viewer_subject!==subject)
  throw new ApiError(401,'review_session_expired');
}
export async function touchReviewSession(env:Env,session:ReviewSession,review:SessionReview){
 const expires=Math.min(review.expires_at,session.created_at+MAX,Date.now()+IDLE);
 if(expires>session.expires_at+10*60*1000){
  const result=await env.DB.prepare('UPDATE review_sessions SET expires_at=? WHERE id_hash=? AND expires_at>?')
   .bind(expires,session.id_hash,Date.now()).run();
  if(result.meta.changes!==1)throw new ApiError(401,'review_session_expired');
  session.expires_at=expires;
 }
}
export async function cleanupReviewSessions(env:Env){
 await env.DB.prepare('DELETE FROM review_sessions WHERE id_hash IN (SELECT id_hash FROM review_sessions WHERE expires_at<=? LIMIT 100)').bind(Date.now()).run();
}
