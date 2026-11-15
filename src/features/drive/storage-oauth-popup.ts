/**
 * Storage OAuth runs in its own user-initiated top-level tab. PKCE, state,
 * cookies, token exchange and identity checks remain in the Worker.
 * Only a short-lived UI correlation nonce/result crosses back to the app.
 */
export type StorageOAuthProvider='drive'|'dropbox';
export type StorageOAuthStatus={provider:StorageOAuthProvider;status:string};
export type StorageOAuthWindow={id:string;popup:Window};
const WINDOW_KEY='roteiva:storage-oauth-popup:v1';
const CHANNEL='roteiva:storage-oauth-result:v1';
const MESSAGE='roteiva:storage-oauth-complete';
const VALID_STATUS=/^[a-z][a-z_]{0,63}$/;
const EXPIRES=10*60*1000;

export function openStorageOAuthWindow():StorageOAuthWindow|null{
 const id=crypto.randomUUID(),width=560,height=700;
 const left=Math.max(0,Math.round((window.screen.width-width)/2));
 const top=Math.max(0,Math.round((window.screen.height-height)/2));
 const popup=window.open('','roteiva-storage-'+id,
  'popup=yes,width='+width+',height='+height+',left='+left+',top='+top+',resizable=yes,scrollbars=yes');
 if(!popup)return null;
 try{
  // Initial about:blank inherits our origin; popup sessionStorage is preserved
  // through the external OAuth redirect until it returns to the same origin.
  popup.sessionStorage.setItem(WINDOW_KEY,JSON.stringify({id,expiresAt:Date.now()+EXPIRES}));
  popup.document.title='Conectando armazenamento — Roteiva';
  popup.document.body.textContent='Abrindo a autorização da conta…';
  popup.document.body.style.cssText='background:#111;color:#f1f1f1;font:16px system-ui;padding:32px';
  popup.focus();
  return {id,popup};
 }catch{popup.close();return null;}
}
type Message={type:typeof MESSAGE;id:string;provider:StorageOAuthProvider;status:string};
function validMessage(value:unknown,id:string):value is Message{
 if(!value||typeof value!=='object')return false;
 const data=value as Partial<Message>;
 return data.type===MESSAGE&&data.id===id&&(data.provider==='drive'||data.provider==='dropbox')&&
  typeof data.status==='string'&&VALID_STATUS.test(data.status);
}
export function awaitStorageOAuthWindow(session:StorageOAuthWindow,signal:AbortSignal):Promise<StorageOAuthStatus|null>{
 return new Promise(resolve=>{
  let finished=false;let channel:BroadcastChannel|null=null;
  const done=(out:StorageOAuthStatus|null)=>{
   if(finished)return;finished=true;
   window.removeEventListener('message',onMessage);
   signal.removeEventListener('abort',onAbort);
   if(channel){channel.removeEventListener('message',onBroadcast);channel.close();}
   window.clearTimeout(timeout);
   window.clearInterval(closeCheck);
   resolve(out);
  };
  const onMessage=(event:MessageEvent)=>{
   if(event.origin!==window.location.origin||event.source!==session.popup)return;
   if(validMessage(event.data,session.id))done({provider:event.data.provider,status:event.data.status});
  };
  const onBroadcast=(event:MessageEvent)=>{
   if(validMessage(event.data,session.id))done({provider:event.data.provider,status:event.data.status});
  };
  const onAbort=()=>done(null);
  window.addEventListener('message',onMessage);
  try{channel=new BroadcastChannel(CHANNEL);channel.addEventListener('message',onBroadcast);}catch{/* postMessage fallback */}
  signal.addEventListener('abort',onAbort,{once:true});
  const timeout=window.setTimeout(()=>done(null),EXPIRES);
  // OAuth providers can reject access on their own origin and never redirect
  // back to Roteiva. Closing that tab must release the UI immediately.
  const closeCheck=window.setInterval(()=>{if(session.popup.closed)done(null);},700);
  if(signal.aborted)onAbort();
 });
}
/** Called in a successful/cancelled OAuth popup before bootstrapping React. */
export function completeStorageOAuthPopupReturn():boolean{
 const params=new URLSearchParams(window.location.search);
 const provider=params.has('drive')?'drive':params.has('dropbox')?'dropbox':null;
 if(!provider)return false;
 let raw:string|null=null;
 try{raw=window.sessionStorage.getItem(WINDOW_KEY);}catch{return false;}
 if(!raw)return false;
 let id='';
 try{
  const item=JSON.parse(raw) as {id?:unknown;expiresAt?:unknown};
  if(typeof item.id!=='string'||!/^[0-9a-f-]{36}$/i.test(item.id)||
    typeof item.expiresAt!=='number'||item.expiresAt<Date.now()||item.expiresAt>Date.now()+EXPIRES)return false;
  id=item.id;
 }catch{return false;}
 const status=params.get(provider)||'';
 if(!VALID_STATUS.test(status))return false;
 try{window.sessionStorage.removeItem(WINDOW_KEY);}catch{/* best effort */}
 const data:Message={type:MESSAGE,id,provider,status};
 try{window.opener?.postMessage(data,window.location.origin);}catch{/* COOP may sever opener */}
 try{const channel=new BroadcastChannel(CHANNEL);channel.postMessage(data);channel.close();}catch{/* postMessage fallback */}
 const root=document.getElementById('root');
 if(root)root.textContent=status==='connected'?'Conta autorizada. Você pode fechar esta janela.':
  'Autorização encerrada. Você pode fechar esta janela.';
 window.close();
 return true;
}
