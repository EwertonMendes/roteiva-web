import {ApiError,type Env} from './types.ts';
import {encrypt,decrypt,context} from './crypto.ts';
import {reviewManifestHash} from './review-manifest.ts';
import {readPublishedSource,type PublishedSource} from './review-source.ts';
import type {ReviewSession} from './review-sessions.ts';
type Round={id:string;owner_uid:string;current_version:number;token_hash:string};
type Proof={manifest:string;version:number;invite:string;checked:number;expires:number};
const WINDOW=60000;
const aad=(env:Env,r:Round,s:ReviewSession)=>context(env,r.owner_uid,r.id,'review-decision:'+s.id_hash);
const manifest=reviewManifestHash;
async function load(env:Env,r:Round,s:ReviewSession,files:PublishedSource[],value:unknown):Promise<Proof>{
 if(typeof value!=='string'||value.length>4096)throw new ApiError(409,'review_decision_check_required');
 let proof:Proof;
 try{proof=JSON.parse(await decrypt(env,value,aad(env,r,s))) as Proof;}catch{throw new ApiError(409,'review_decision_check_required');}
 if(proof.manifest!==await manifest(files)||proof.version!==r.current_version||proof.invite!==r.token_hash||
 !Number.isSafeInteger(proof.checked)||proof.checked<0||proof.checked>files.length||
 !Number.isSafeInteger(proof.expires)||proof.expires<=Date.now()||proof.expires>Date.now()+WINDOW)
 throw new ApiError(409,'review_decision_check_required');
 return proof;
}
/** A short authenticated receipt accumulates at most two provider probes per request.
 * It is bound to the live session, exact manifest and invite/version; it is never a media grant. */
export async function prepareReviewDecision(env:Env,r:Round,s:ReviewSession,files:PublishedSource[],previous:unknown){
 const proof:Proof=previous?await load(env,r,s,files,previous):{
 manifest:await manifest(files),version:r.current_version,invite:r.token_hash,checked:0,expires:Date.now()+WINDOW};
 const end=Math.min(files.length,proof.checked+2);
 for(let i=proof.checked;i<end;i++)await readPublishedSource(new Request('https://internal.invalid/probe'),env,r.owner_uid,files[i],true);
 if(proof.expires<=Date.now())throw new ApiError(409,'review_decision_check_required');
 proof.checked=end;
 return {ready:end===files.length,checked:end,total:files.length,proof:await encrypt(env,JSON.stringify(proof),aad(env,r,s))};
}
export async function assertReviewDecisionProof(env:Env,r:Round,s:ReviewSession,files:PublishedSource[],value:unknown){
 const proof=await load(env,r,s,files,value);
 if(proof.checked!==files.length)throw new ApiError(409,'review_decision_check_required');
 return proof.expires;
}
