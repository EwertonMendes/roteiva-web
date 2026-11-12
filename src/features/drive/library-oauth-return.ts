/** Short-lived UI navigation hint across a top-level provider OAuth redirect.
 * Never use this hint for access control: Worker/Firestore revalidate the project
 * and the selected virtual folder when the library is reloaded. */
export type LibraryOAuthReturnIntent={projectId:number;parentId:string};
type Store=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
const KEY='roteiva:library-oauth-return:v1';
const MAX_AGE_MS=10*60*1000;
const NODE=/^(?:root|[0-9a-f-]{36})$/;

function getStore(store?:Store):Store|undefined{
 try{return store??window.sessionStorage;}catch{return undefined;}
}
export function rememberLibraryOAuthReturn(uid:string,projectId:number,parentId:string,store?:Store,now=Date.now()):boolean{
 if(!uid||!Number.isSafeInteger(projectId)||projectId<=0||!NODE.test(parentId))return false;
 try{
  const target=getStore(store);if(!target)return false;
  target.setItem(KEY,JSON.stringify({uid,projectId,parentId,expiresAt:now+MAX_AGE_MS}));
  return true;
 }catch{return false;}
}
export function readLibraryOAuthReturn(uid:string,store?:Store,now=Date.now()):LibraryOAuthReturnIntent|null{
 try{
  const target=getStore(store);if(!target)return null;
  const raw=target.getItem(KEY);if(!raw)return null;
  const data=JSON.parse(raw) as Record<string,unknown>;
  if(!uid||data.uid!==uid||!Number.isSafeInteger(data.projectId)||Number(data.projectId)<=0||
   typeof data.parentId!=='string'||!NODE.test(data.parentId)||
   typeof data.expiresAt!=='number'||!Number.isFinite(data.expiresAt)||data.expiresAt<=now||data.expiresAt>now+MAX_AGE_MS){
   target.removeItem(KEY);return null;
  }
  return {projectId:Number(data.projectId),parentId:data.parentId};
 }catch{
  forgetLibraryOAuthReturn(store);return null;
 }
}
export function forgetLibraryOAuthReturn(store?:Store):void{
 try{getStore(store)?.removeItem(KEY);}catch{/* Storage may be unavailable. */}
}
