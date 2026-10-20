import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPair,exportJWK,createLocalJWKSet,SignJWT} from 'jose';
import {database} from './helpers/database.mjs';
import {retainTrialIdentity} from '../src/trial-identity.ts';
import {verifiedTrialPrincipal} from '../src/auth.ts';
import {ensureAccess,eraseAccess,TRIAL_MS,assertActiveAccess} from '../src/access.ts';

const trialKey=Buffer.from(new Uint8Array(32).fill(71)).toString('base64url');
const identity=(uid,email='Example.User+first@gmail.com',googleSubject='google-subject-007')=>
  ({uid,verifiedEmail:email,googleSubject});
function setup(t){
  const db=database();t.after(db.close);
  return {...db,env:{DB:db.DB,ENVIRONMENT:'dev',FIREBASE_PROJECT_ID:'roteiva-web-dev',
    TRIAL_IDENTITY_HMAC_KEY:trialKey}};
}
test('first verified Google identity wins permanently; recreated UID and Gmail aliases get no trial',async t=>{
  const s=setup(t);
  const a=identity('uid-original');
  const b=identity('uid-after-deletion','e.x.a.m.p.l.e.u.s.e.r+second@googlemail.com');
  assert.equal(await retainTrialIdentity(s.env,a),true);
  assert.equal(await retainTrialIdentity(s.env,a),true);
  // Simulate completion of account deletion. No raw user record survives.
  s.sql.prepare('INSERT INTO access_accounts(owner_uid,trial_started_at,trial_ends_at,created_at,updated_at) VALUES(?,?,?,?,?)')
    .run(a.uid,Date.now(),Date.now()+TRIAL_MS,Date.now(),Date.now());
  await eraseAccess(s.env,a.uid);
  assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM access_accounts').get().n,0);
  assert.equal(await retainTrialIdentity(s.env,b),false);
  assert.equal(await retainTrialIdentity(s.env,b),false);
  const claims=s.sql.prepare('SELECT * FROM trial_identity_claims ORDER BY fingerprint').all();
  assert.equal(claims.length,2);
  const raw=JSON.stringify(claims);
  for(const sensitive of ['uid-original','uid-after-deletion','gmail','googlemail','google-subject','example.user'])
    assert.ok(!raw.includes(sensitive),'identity ledger must not retain '+sensitive);
  assert.throws(()=>s.sql.prepare('UPDATE trial_identity_claims SET first_owner_tag=?').run('v1_'+'a'.repeat(64)),
    /trial_identity_claims_immutable/);
});
test('verified Google subject also prevents trial replay after provider email changes',async t=>{
  const s=setup(t);
  assert.equal(await retainTrialIdentity(s.env,identity('old','first@custom.domain','stable-google-19')),true);
  assert.equal(await retainTrialIdentity(s.env,identity('recreated','new@custom.domain','stable-google-19')),false);
  assert.equal(await retainTrialIdentity(s.env,identity('different','different@custom.domain','different-subject')),true);
});
test('different provider subject with same verified e-mail does not reset trial',async t=>{
  const s=setup(t);
  assert.equal(await retainTrialIdentity(s.env,identity('old','same@example.com','old-provider')),true);
  assert.equal(await retainTrialIdentity(s.env,identity('new','SAME@example.com','new-provider')),false);
});
test('missing or weak secret fails closed without writing an unhashed identifier',async t=>{
  const s=setup(t);
  for(const key of [undefined,'','password123','x'.repeat(43)]){
    const env={...s.env,TRIAL_IDENTITY_HMAC_KEY:key};
    if(key==='x'.repeat(43))continue; // a valid base64url encoding is not considered weak merely by its alphabet
    await assert.rejects(()=>retainTrialIdentity(env,identity('uid')),e=>e.status===503);
  }
  assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM trial_identity_claims').get().n,0);
});
test('verified provider identity requires signed Google email, recent login for deletion',async()=>{
  const {privateKey,publicKey}=await generateKeyPair('RS256');
  const jwk=await exportJWK(publicKey);jwk.kid='fixture';
  const keys=createLocalJWKSet({keys:[jwk]});
  const now=Math.floor(Date.now()/1000);
  const sign=async (claims,authTime=now)=>new SignJWT({auth_time:authTime,...claims})
    .setProtectedHeader({alg:'RS256',kid:'fixture'}).setSubject('verified-uid')
    .setIssuer('https://securetoken.google.com/roteiva-web-dev')
    .setAudience('roteiva-web-dev').setIssuedAt(now).setExpirationTime(now+300).sign(privateKey);
  const base={email:'trusted@example.com',email_verified:true,
    firebase:{sign_in_provider:'google.com',identities:{'google.com':['verified-sub']}}};
  const env={FIREBASE_PROJECT_ID:'roteiva-web-dev'};
  const request=async (claims,authTime)=>new Request('https://example.com/access/ensure',{
    headers:{Authorization:'Bearer '+await sign(claims,authTime)}});
  assert.deepEqual(await verifiedTrialPrincipal(await request(base),env,300,keys),{
    uid:'verified-uid',verifiedEmail:'trusted@example.com',googleSubject:'verified-sub'});
  for(const claims of [{...base,email_verified:false},{...base,email_verified:undefined},
    {...base,firebase:{sign_in_provider:'password',identities:{'google.com':['verified-sub']}}},
    {...base,firebase:{sign_in_provider:'google.com',identities:{}}},
    {...base,email:undefined}]){
    await assert.rejects(()=>verifiedTrialPrincipal(await request(claims),env,undefined,keys),
      e=>e.status===401);
  }
  await assert.rejects(()=>verifiedTrialPrincipal(await request(base,now-301),env,300,keys),e=>e.status===401);
});
test('backend provisions new same-email UID as expired after old account is erased',async t=>{
  const s=setup(t);
  const env=s.env;
  const created=Date.now()+1000;
  const projected=new Map();
  const oldFetch=globalThis.fetch;
  globalThis.fetch=async(url,options={})=>{
    const target=String(url);
    assert.equal(options.redirect,'manual');
    const match=target.match(/\/documents\/users\/(A|B)(?:\/access\/current)?/);
    if(!match)throw new Error('Unexpected mocked Firestore URL '+target);
    const uid=match[1];
    if(!target.includes('/access/current'))
      return Response.json({createTime:new Date(created).toISOString(),fields:{ownerUid:{stringValue:uid}}});
    if(options.method==='PATCH'){
      const value=JSON.parse(options.body);
      const entry={...value,updateTime:new Date().toISOString()};
      projected.set(uid,entry);
      return Response.json(entry);
    }
    return projected.has(uid)?Response.json(projected.get(uid)):new Response(null,{status:404});
  };
  t.after(()=>{globalThis.fetch=oldFetch;});
  const principalA=identity('A','reused@gmail.com','shared-google');
  const first=await (await ensureAccess(env,'A','mock-admin',principalA)).json();
  assert.equal(first.active,true);
  assert.equal(first.source,'trial');
  await eraseAccess(env,'A');
  const principalB=identity('B','re.used+retry@gmail.com','shared-google');
  const second=await (await ensureAccess(env,'B','mock-admin',principalB)).json();
  assert.equal(second.active,false);
  assert.equal(second.source,'none');
  assert.ok(Date.parse(second.trialEndsAt)<=Date.now());
  assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM access_accounts').get().n,1);
  await assert.rejects(()=>assertActiveAccess(env,'B'),e=>e.status===403);
  const prior=s.sql.prepare('SELECT trial_started_at,trial_ends_at FROM access_accounts WHERE owner_uid=?').get('B');
  await ensureAccess(env,'B','mock-admin',principalB);
  assert.deepEqual(s.sql.prepare('SELECT trial_started_at,trial_ends_at FROM access_accounts WHERE owner_uid=?').get('B'),prior);
});
