import assert from 'node:assert/strict';
import {config,wrangler,target} from './environment.mjs';
const secrets=wrangler(['secret','list','--env',target,'--format','json']);
const names=new Set(secrets.map(item=>item.name));
const required=['TOKEN_KEYS','TRIAL_IDENTITY_HMAC_KEY','FIREBASE_ADMIN_CREDENTIALS_JSON'];
assert.equal(config.vars.OAUTH_ENABLED,'true','OAuth must be configured before promotion');
assert.equal(config.vars.DROPBOX_ENABLED,'true','Dropbox must be configured before promotion');
assert.equal(config.vars.ACCOUNT_DELETION_ENABLED,'true','Account deletion must be configured before promotion');
assert.match(config.vars.GOOGLE_CLIENT_ID,/^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/);
required.push('GOOGLE_CLIENT_SECRET','GOOGLE_PICKER_API_KEY','DROPBOX_APP_KEY','DROPBOX_APP_SECRET');
if(target==='prod'&&process.env.PRODUCTION_BILLING_ENABLED==='true'){
 required.push('ASAAS_API_KEY','ASAAS_WEBHOOK_TOKEN','BILLING_ENABLED','BILLING_CHECKOUT_ENABLED');
 const publicRollout=process.env.PRODUCTION_BILLING_PUBLIC_ROLLOUT_ENABLED==='true';
 if(process.env.PRODUCTION_BILLING_CHECKOUT_ENABLED==='true'&&!publicRollout)required.push('BILLING_CHECKOUT_TEST_UIDS');
 if(process.env.PRODUCTION_BILLING_TEST_PLAN_ENABLED==='true'){
  required.push('BILLING_TEST_PLAN_ENABLED');
  if(!publicRollout)required.push('BILLING_TEST_PLAN_UID');
 }
}
for(const name of required)assert.ok(names.has(name),'Missing Worker secret: '+name);
console.log('Required '+target+' secret names verified. Values were not read.');
