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
const keys=JSON.parse(secrets.TOKEN_KEYS);assert.equal(Buffer.from(keys[config.vars.TOKEN_KEY_VERSION]||'','base64url').length,32);
assert.equal(Buffer.from(secrets.TRIAL_IDENTITY_HMAC_KEY,'base64url').length,32);
assert.match(secrets.GOOGLE_PICKER_API_KEY,/^AIza[A-Za-z0-9_-]{30,}$/);
const account=JSON.parse(secrets.FIREBASE_ADMIN_CREDENTIALS_JSON);
assert.equal(account.type,'service_account');assert.equal(account.project_id,config.vars.FIREBASE_PROJECT_ID);
assert.ok(account.client_email?.endsWith('@roteiva-web-prod.iam.gserviceaccount.com'));createPrivateKey(account.private_key);
assert.ok(process.env.RUNNER_TEMP,'GitHub private runner temporary directory required');
writeFileSync(join(process.env.RUNNER_TEMP,'roteiva-prod-secrets.json'),JSON.stringify(secrets),{mode:0o600});
console.log('Validated PROD secret structure and prepared additive atomic upload. No values logged.');
} catch {
 // Assertion and JSON parsing errors may otherwise echo protected input values.
 console.error('PROD secret validation failed. Check required names, key sizes and credential project. Values suppressed.');
 process.exitCode=1;
}
