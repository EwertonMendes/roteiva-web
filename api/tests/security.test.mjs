import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, SignJWT, createLocalJWKSet, exportJWK } from 'jose';
import { encrypt, decrypt, context, base64url } from '../src/crypto.ts';
import { verifyFirebase } from '../src/auth.ts';
import { handle } from '../src/index.ts';
import { accessToken } from '../src/google.ts';
import { connection, consumeState } from '../src/repository.ts';
const env = {
 API_RATE_LIMIT:{limit:async()=>({success:true})},
 ENVIRONMENT:'dev', FIREBASE_PROJECT_ID:'roteiva-web-dev',
 FRONTEND_ORIGIN:'https://roteiva-web-dev.web.app',
 OAUTH_REDIRECT_URI:'https://roteiva-api-dev.ewertonmendes9.workers.dev/oauth/drive/callback',
 OAUTH_ENABLED:'false', TOKEN_KEY_VERSION:'v1',
 TOKEN_KEYS:JSON.stringify({v1:base64url(crypto.getRandomValues(new Uint8Array(32)))}),
};
test('AES-GCM rejects another user, account, environment, wrong key and modified ciphertext', async()=>{
 const aad=context(env,'A','google-A');
 const sealed=await encrypt(env,'synthetic-refresh-token',aad);
 assert.equal(await decrypt(env,sealed,aad),'synthetic-refresh-token');
 assert.ok(!sealed.includes('synthetic-refresh-token'));
 for (const bad of [context(env,'B','google-A'),context(env,'A','google-B'),context({...env,ENVIRONMENT:'prod'},'A','google-A')])
   await assert.rejects(()=>decrypt(env,sealed,bad));
 await assert.rejects(()=>decrypt({...env,TOKEN_KEYS:JSON.stringify({v1:base64url(new Uint8Array(32))})},sealed,aad));
 const tampered=JSON.parse(sealed); tampered.data=(tampered.data[0]==='A'?'B':'A')+tampered.data.slice(1);
 await assert.rejects(()=>decrypt(env,JSON.stringify(tampered),aad));
 assert.notEqual((await encrypt(env,'same',aad)),(await encrypt(env,'same',aad)));
});
test('Firebase signed JWT validates issuer, audience, expiry, signature and auth_time', async()=>{
 const {privateKey,publicKey}=await generateKeyPair('RS256');
 const jwk=await exportJWK(publicKey); jwk.kid='test';
 const keys=createLocalJWKSet({keys:[jwk]});
 const now=Math.floor(Date.now()/1000);
 async function token(options={}) {
   return new SignJWT({auth_time:now,...options.claims}).setProtectedHeader({alg:'RS256',kid:'test'})
    .setSubject('A').setIssuer(options.issuer||'https://securetoken.google.com/roteiva-web-dev')
    .setAudience(options.audience||'roteiva-web-dev').setIssuedAt()
    .setExpirationTime(options.exp||now+300).sign(options.key||privateKey);
 }
 assert.equal(await verifyFirebase(await token(),'roteiva-web-dev',keys),'A');
 for (const bad of ['malformed',await token({audience:'other'}),await token({issuer:'https://evil.example'}),
   await token({exp:now-100}),await token({claims:{auth_time:now+3600}}),
   await token({key:(await generateKeyPair('RS256')).privateKey})])
   await assert.rejects(()=>verifyFirebase(bad,'roteiva-web-dev',keys),e=>e.status===401);
});
test('HTTP rejects missing identity, wrong CORS origin and disabled OAuth without leaking details', async()=>{
 const request=(path,options={})=>new Request('https://api.example'+path,options);
 assert.equal((await handle(request('/integrations/drive'),env)).status,401);
 assert.equal((await handle(request('/integrations/drive',{headers:{Authorization:'Bearer invalid'}}),env)).status,401);
 const denied=await handle(request('/health',{headers:{Origin:'https://evil.example'}}),env);
 assert.equal(denied.status,403); assert.equal(denied.headers.get('Access-Control-Allow-Origin'),null);
 const allowed=await handle(request('/oauth/drive/start',{method:'OPTIONS',headers:{Origin:env.FRONTEND_ORIGIN}}),env);
 assert.equal(allowed.status,204); assert.equal(allowed.headers.get('Access-Control-Allow-Origin'),env.FRONTEND_ORIGIN);
 const health=await handle(request('/health'),{...env,DB:{prepare:()=>({first:async()=>({})})}});
 assert.equal(health.status,200); assert.deepEqual(await health.json(),{status:'ok',environment:'dev'});
 assert.equal(health.headers.get('Referrer-Policy'),'no-referrer');
 const unavailable=await handle(request('/health'),env);
 assert.equal(unavailable.status,503); assert.ok(!(await unavailable.text()).includes('TypeError'));
 assert.equal((await handle(request('/health'),{...env,ENVIRONMENT:'prod'})).status,503);
});
test('connection lookup binds owner; state consumption is atomic, browser-bound and rejects replay', async()=>{
 let args,query;
 const DB={prepare(sql){query=sql;return {bind(...values){args=values;return {first:async()=>null}}}}};
 await assert.rejects(()=>connection({...env,DB},'B','connection-A'),e=>e.status===404);
 assert.deepEqual(args,['connection-A','B']); assert.ok(query.includes('owner_uid = ?'));
 assert.equal(await consumeState({...env,DB},'hash','browserHash'),null);
 assert.ok(query.startsWith('DELETE')); assert.ok(query.includes('RETURNING'));
 assert.deepEqual(args.slice(0,2),['hash','browserHash']);
});
test('refresh stays backend-only; transient error preserves token; invalid_grant clears ciphertext', async()=>{
 let invalidated=false;
 const row={id:'c',owner_uid:'A',google_account_id:'g',status:'connected',revision:1,
 encrypted_refresh_token:await encrypt(env,'synthetic',context(env,'A','g'))};
 const DB={prepare:()=>({bind:()=>({run:async()=>{invalidated=true;return {meta:{changes:1}}}})})};
 const configured={...env,DB,GOOGLE_CLIENT_ID:'test',GOOGLE_CLIENT_SECRET:'synthetic'};
 const ok=async(url,options)=>{
   assert.equal(url,'https://oauth2.googleapis.com/token');
   assert.equal(options.body.get('refresh_token'),'synthetic');
   return Response.json({access_token:'short-lived',token_type:'Bearer',expires_in:3600});
 };
 assert.equal(await accessToken(configured,row,ok),'short-lived');
 assert.equal(invalidated,false);
 await assert.rejects(()=>accessToken(configured,row,async()=>Response.json({error:'server_error'},{status:503})),e=>e.status===502);
 assert.equal(invalidated,false);
 await assert.rejects(()=>accessToken(configured,row,async()=>Response.json({error:'invalid_grant'},{status:400})),e=>e.code==='reconnect_required');
 assert.equal(invalidated,true);
});

test('rate limit rejects before touching D1',async()=>{
 const response=await handle(new Request('https://api.example/health'),{...env,API_RATE_LIMIT:{limit:async()=>({success:false})}});
 assert.equal(response.status,429);
});
test('OAuth first-party launch uses one-time ticket, PKCE and Lax callback cookie',async()=>{
 const {start,launch,callback}=await import('../src/oauth.ts');
 let inserted,used=false,insertCount=0;
 const DB={prepare:sql=>({bind:(...args)=>{
   if(sql.startsWith('INSERT INTO oauth_transactions')) return {run:async()=>{inserted=args;insertCount++;return {meta:{changes:1}};}};
   if(sql.startsWith('UPDATE oauth_transactions')) return {first:async()=>{
     if(used || !inserted || args[2]!==inserted[6]) return null;
     used=true;
     return {owner_uid:'A',state_hash:inserted[0],encrypted_verifier:inserted[2],nonce:inserted[3],encrypted_state:inserted[7]};
   }};
   return {run:async()=>({meta:{changes:1}})};
 }})};
 const configured={...env,DB,OAUTH_ENABLED:'true',GOOGLE_CLIENT_ID:'test',GOOGLE_CLIENT_SECRET:'synthetic'};
 const response=await start(configured,'A');
 const {launchUrl}=await response.json();
 assert.equal(response.headers.get('Set-Cookie'),null);
 assert.equal(new URL(launchUrl).origin,'https://roteiva-api-dev.ewertonmendes9.workers.dev');
 assert.equal(new URL(launchUrl).pathname,'/oauth/drive/launch');
 assert.equal(new URL(launchUrl).searchParams.get('ticket').length,43);
 assert.equal(insertCount,1);
 const launched=await launch(new Request(launchUrl),configured);
 assert.equal(launched.status,303);
 assert.match(launched.headers.get('Set-Cookie'),/HttpOnly; Secure; SameSite=Lax/);
 const target=new URL(launched.headers.get('Location'));
 assert.equal(target.origin,'https://accounts.google.com');
 assert.equal(target.searchParams.get('access_type'),'offline');
 assert.equal(target.searchParams.get('code_challenge_method'),'S256');
 assert.equal(target.searchParams.get('scope'),'openid email https://www.googleapis.com/auth/drive.file');
 assert.equal(target.searchParams.get('state').length,43);
 assert.equal(await hashTest(target.searchParams.get('state')),inserted[0]);
 await assert.rejects(()=>launch(new Request(launchUrl),configured),e=>e.code==='expired_or_used_launch');
 await assert.rejects(()=>callback(new Request(configured.OAUTH_REDIRECT_URI+'?state='+target.searchParams.get('state')),configured),e=>e.code==='invalid_oauth_state');
 await assert.rejects(()=>start(env,'A'),e=>e.code==='oauth_not_configured');
});

async function hashTest(value) {
 const {hash}=await import('../src/crypto.ts');
 return hash(value);
}

test('source rate limit does not use shared all-users bucket',async()=>{
 const keys=[];
 const limited={...env,DB:{prepare:()=>({first:async()=>({})})},API_RATE_LIMIT:{limit:async({key})=>{keys.push(key);return {success:true};}}};
 const response=await handle(new Request('https://api.example/health',{headers:{'CF-Connecting-IP':'203.0.113.9'}}),limited);
 assert.equal(response.status,200);
 assert.deepEqual(keys,['dev:ip:203.0.113.9']);
});
