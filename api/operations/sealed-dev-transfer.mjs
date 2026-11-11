// Maintenance-only module. Never imported by the normal Worker entrypoint.
// The wrapper is deployed briefly to the source DEV and restored in finally.
const names=['TOKEN_KEYS','TRIAL_IDENTITY_HMAC_KEY','GOOGLE_CLIENT_SECRET','GOOGLE_PICKER_API_KEY',
  'DROPBOX_APP_KEY','DROPBOX_APP_SECRET','FIREBASE_ADMIN_CREDENTIALS_JSON'];
const bytes=value=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
const base64=value=>btoa(String.fromCharCode(...new Uint8Array(value)));
export function transferHandler({path,expiresAt,signingPublicKey,encryptionPublicKey}) {
  return async function transfer(request,env){
    const url=new URL(request.url);
    if(url.pathname!==path)return null;
    const denied=()=>new Response(null,{status:404,headers:{'Cache-Control':'no-store'}});
    if(request.method!=='POST'||url.search||request.headers.has('Origin')||Date.now()>expiresAt||
      env.ENVIRONMENT!=='dev'||env.FIREBASE_PROJECT_ID!=='roteiva-web-dev')return denied();
    const message=new TextEncoder().encode('POST\n'+path+'\n'+expiresAt);
    try{
      const key=await crypto.subtle.importKey('jwk',signingPublicKey,{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
      if(!await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},key,bytes(request.headers.get('X-Migration-Signature')||''),message))return denied();
    }catch{return denied();}
    const payload={};for(const name of names){
      if(typeof env[name]!=='string'||!env[name])throw new Error('Missing required DEV credential');
      payload[name]=env[name];
    }
    const recipient=await crypto.subtle.importKey('jwk',encryptionPublicKey,{name:'RSA-OAEP',hash:'SHA-256'},false,['encrypt']);
    const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},true,['encrypt']);
    const iv=crypto.getRandomValues(new Uint8Array(12));
    const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:message},key,new TextEncoder().encode(JSON.stringify(payload)));
    const wrapped=await crypto.subtle.encrypt({name:'RSA-OAEP'},recipient,await crypto.subtle.exportKey('raw',key));
    return Response.json({iv:base64(iv),wrapped:base64(wrapped),encrypted:base64(encrypted)},
      {headers:{'Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'",'Referrer-Policy':'no-referrer'}});
  };
}
