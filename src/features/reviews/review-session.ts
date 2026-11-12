const KEY='roteiva-review-session-v1';
export type PortalSession={session:string;expiresAt:number};
export function readPortalSession():PortalSession|null{
 try{
  const value=JSON.parse(sessionStorage.getItem(KEY)||'null') as PortalSession|null;
  return value&&/^[A-Za-z0-9_-]{43}$/.test(value.session)&&Number.isFinite(value.expiresAt)&&value.expiresAt>Date.now()?value:null;
 }catch{return null;}
}
export function rememberPortalSession(value:PortalSession){
 try{sessionStorage.setItem(KEY,JSON.stringify(value));}catch{/* Tab memory still supports the current visit. */}
}
export function forgetPortalSession(){try{sessionStorage.removeItem(KEY);}catch{/* Optional tab persistence. */}}
