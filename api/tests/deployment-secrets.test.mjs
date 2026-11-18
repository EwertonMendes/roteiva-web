import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomBytes} from 'node:crypto';
import {mkdtempSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const config=JSON.parse(readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8')).env.prod;
const privateKey=generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs8',format:'pem'});
function run(overrides={}) {
 const dir=mkdtempSync(join(tmpdir(),'roteiva-secrets-'));
 const secrets={TOKEN_KEYS:JSON.stringify({v1:randomBytes(32).toString('base64url')}),
  TRIAL_IDENTITY_HMAC_KEY:randomBytes(32).toString('base64url'),GOOGLE_CLIENT_SECRET:'synthetic-private-marker',
  GOOGLE_PICKER_API_KEY:'AIza'+'x'.repeat(35),DROPBOX_APP_KEY:'synthetic-dropbox-app',DROPBOX_APP_SECRET:'synthetic-dropbox-secret',
  FIREBASE_ADMIN_CREDENTIALS_JSON:JSON.stringify({type:'service_account',project_id:'roteiva-web-prod',client_email:'backend@roteiva-web-prod.iam.gserviceaccount.com',private_key:privateKey}),RESEND_API_KEY:'re_synthetic_abcdefghijklmnop',...overrides};
 const result=spawnSync(process.execPath,[fileURLToPath(new URL('../scripts/prepare-worker-secrets.mjs',import.meta.url)),'prod'],{
  cwd:fileURLToPath(new URL('..',import.meta.url)),encoding:'utf8',env:{...process.env,...secrets,
   CLOUDFLARE_ACCOUNT_ID:config.account_id,CLOUDFLARE_D1_DATABASE_ID:config.d1_databases[0].database_id,
   API_BASE_URL:'https://api.roteiva.com',RUNNER_TEMP:dir}});
 const output=result.stdout+result.stderr,path=join(dir,'roteiva-prod-secrets.json');
 const saved=existsSync(path)?JSON.parse(readFileSync(path,'utf8')):null;
 assert.equal(resolve(dirname(dir)),resolve(tmpdir()),'Cleanup must stay inside the temporary root');
 rmSync(dir,{recursive:true,force:true});return {status:result.status,output,saved,secrets};
}
test('PROD atomic bootstrap includes a valid optional Resend credential without printing it',()=>{
 const r=run();assert.equal(r.status,0);assert.deepEqual(r.saved,r.secrets);
 assert.ok(!r.output.includes('synthetic-private-marker'));assert.ok(!r.output.includes(privateKey));
});
test('PROD bootstrap rejects a Firebase DEV service identity without creating a file',()=>{
 const r=run({FIREBASE_ADMIN_CREDENTIALS_JSON:JSON.stringify({project_id:'roteiva-web-dev'})});
 assert.notEqual(r.status,0);assert.equal(r.saved,null);
});
test('malformed protected JSON cannot leak its source through a parser error',()=>{
 const marker='PRIVATE-MUST-NEVER-APPEAR-IN-LOGS';const r=run({TOKEN_KEYS:'{"'+marker+'"'});
 assert.notEqual(r.status,0);assert.equal(r.saved,null);assert.ok(!r.output.includes(marker));
});
test('invalid protected API key and missing required secret are rejected without logging values',()=>{
 for(const overrides of [{GOOGLE_PICKER_API_KEY:'PRIVATE-INVALID-KEY'},{DROPBOX_APP_SECRET:''},{RESEND_API_KEY:'PRIVATE-INVALID-KEY'}]){
  const r=run(overrides);assert.notEqual(r.status,0);assert.equal(r.saved,null);
  assert.ok(!r.output.includes('PRIVATE-INVALID-KEY'));
 }
});
test('PROD bootstrap succeeds without optional Resend and preserves all seven required secrets',()=>{
 for(const value of ['',undefined]){
  const r=run({RESEND_API_KEY:value});assert.equal(r.status,0);
  const expected={...r.secrets};delete expected.RESEND_API_KEY;
  assert.deepEqual(r.saved,expected);assert.equal(Object.keys(r.saved).length,7);
 }
});
