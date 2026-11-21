import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createPrivateKey} from 'node:crypto';
import {config,target} from './environment.mjs';
try {
assert.equal(target,'prod','Only explicit PROD bootstrap is supported');
for(const flag of ['OAUTH_ENABLED','DROPBOX_ENABLED','ACCOUNT_DELETION_ENABLED'])assert.equal(config.vars[flag],'true','PROD feature not provisioned: '+flag);
assert.match(config.vars.GOOGLE_CLIENT_ID,/^18860974410-[a-z0-9]+\.apps\.googleusercontent\.com$/,'PROD Google client must belong to its dedicated OAuth project');
const names=['TOKEN_KEYS','TRIAL_IDENTITY_HMAC_KEY','GOOGLE_CLIENT_SECRET','GOOGLE_PICKER_API_KEY','DROPBOX_APP_KEY','DROPBOX_APP_SECRET','FIREBASE_ADMIN_CREDENTIALS_JSON'];
const secrets={};
for(const name of names){
 const value=process.env[name];assert.ok(value&&(['TOKEN_KEYS','FIREBASE_ADMIN_CREDENTIALS_JSON'].includes(name)||value.trim()===value)&&!/REPLACE_WITH|PLACEHOLDER/.test(value),'Missing/invalid protected secret: '+name);
 secrets[name]=value;
}
// PROD email uses a Cloudflare binding restricted to one verified inbox.
// No Resend credentials are accepted or uploaded for PROD.
const keys=JSON.parse(secrets.TOKEN_KEYS);assert.equal(Buffer.from(keys[config.vars.TOKEN_KEY_VERSION]||'','base64url').length,32);
assert.equal(Buffer.from(secrets.TRIAL_IDENTITY_HMAC_KEY,'base64url').length,32);
assert.match(secrets.GOOGLE_PICKER_API_KEY,/^AIza[A-Za-z0-9_-]{30,}$/);
const account=JSON.parse(secrets.FIREBASE_ADMIN_CREDENTIALS_JSON);
assert.equal(account.type,'service_account');assert.equal(account.project_id,config.vars.FIREBASE_PROJECT_ID);
assert.ok(account.client_email?.endsWith('@roteiva-web-prod.iam.gserviceaccount.com'));createPrivateKey(account.private_key);
const billing=process.env.PRODUCTION_BILLING_ENABLED==='true';
const checkout=process.env.PRODUCTION_BILLING_CHECKOUT_ENABLED==='true';
const pix=process.env.PRODUCTION_BILLING_PIX_ENABLED==='true';
const publicRollout=process.env.PRODUCTION_BILLING_PUBLIC_ROLLOUT_ENABLED==='true';
const testPlanEnabled=process.env.PRODUCTION_BILLING_TEST_PLAN_ENABLED==='true';
const testPlanUid=process.env.BILLING_TEST_PLAN_UID??'';
assert.ok(!testPlanEnabled||billing&&checkout,'A private paid test plan requires active checkout');
assert.ok(!checkout||billing,'Billing must be configured before canary checkout');
assert.ok(!pix||billing,'PIX cannot be live without verified billing');
assert.ok(!publicRollout||checkout,'Public checkout requires an explicit separate checkout release');
if(billing){
 const key=process.env.ASAAS_API_KEY??'';
 const webhook=process.env.ASAAS_WEBHOOK_TOKEN??'';
 const configuredUsers=(process.env.BILLING_CHECKOUT_TEST_UIDS??'').split(',').map(uid=>uid.trim()).filter(Boolean);
 assert.match(key,/^\$aact_prod_[A-Za-z0-9_+=\/-]{16,}$/);
 assert.match(webhook,/^\S{32,255}$/);
 assert.notEqual(webhook,key);
 assert.ok(!checkout||configuredUsers.length>0||publicRollout,'Production checkout needs a tester or an explicitly approved public rollout');
 assert.ok(!pix||configuredUsers.length>0||publicRollout,'Production PIX requires a canary or explicit public rollout');
 for(const uid of configuredUsers)assert.match(uid,/^[A-Za-z0-9_-]{1,128}$/);
 if(testPlanEnabled){
  assert.match(testPlanUid,/^[A-Za-z0-9_-]{1,128}$/,'A single exact PROD Firebase Auth UID is required');
  assert.ok(configuredUsers.includes(testPlanUid),'Private plan UID must already be in the protected PROD canary checkout allowlist');
 }
 const provider=await fetch('https://api.asaas.com/v3/myAccount/accountNumber',{
  headers:{access_token:key,'User-Agent':'Roteiva/1.0'},redirect:'error',signal:AbortSignal.timeout(10000),
 });
 await provider.body?.cancel();
 assert.equal(provider.status,200,'Asaas PROD read-only authentication failed');
 Object.assign(secrets,{ASAAS_API_KEY:key,ASAAS_WEBHOOK_TOKEN:webhook,BILLING_ENABLED:'true',
  BILLING_CHECKOUT_ENABLED:String(checkout),BILLING_PIX_ENABLED:String(pix),
  BILLING_PUBLIC_ROLLOUT_ENABLED:String(publicRollout),
  BILLING_TEST_PLAN_ENABLED:String(testPlanEnabled)});
 if(testPlanEnabled)secrets.BILLING_TEST_PLAN_UID=testPlanUid;
 if(configuredUsers.length)secrets.BILLING_CHECKOUT_TEST_UIDS=configuredUsers.join(',');
 console.log('Asaas PROD read-only authentication passed. Bank details and credentials suppressed.');
}
assert.ok(process.env.RUNNER_TEMP,'GitHub private runner temporary directory required');
writeFileSync(join(process.env.RUNNER_TEMP,'roteiva-prod-secrets.json'),JSON.stringify(secrets),{mode:0o600});
console.log('Validated PROD secret structure and prepared additive atomic upload. No values logged.');
} catch {
 // Assertion and JSON parsing errors may otherwise echo protected input values.
 console.error('PROD secret validation failed. Check required names, key sizes and credential project. Values suppressed.');
 process.exitCode=1;
}
