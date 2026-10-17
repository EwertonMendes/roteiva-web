import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, SignJWT, createLocalJWKSet, exportJWK } from 'jose';
import { encrypt, decrypt, context, base64url } from '../src/crypto.ts';
import { verifyFirebase } from '../src/auth.ts';
import { handle } from '../src/index.ts';
import { accessToken } from '../src/google.ts';
import { connection, consumeState } from '../src/repository.ts';
const env = {
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
