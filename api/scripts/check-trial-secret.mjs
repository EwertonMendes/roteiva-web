// Prevents publishing a Worker whose new-account and deletion routes would
// fail closed because their HMAC secret was never installed. No values logged.
import {spawnSync} from 'node:child_process';
const result=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js',
  'secret','list','--env','dev','--format','json'],{
  encoding:'utf8',env:{...process.env,WRANGLER_SEND_METRICS:'false',WRANGLER_WRITE_LOGS:'false'},
  maxBuffer:1000000
});
if(result.status!==0)throw new Error('Unable to verify Worker secret metadata; deployment stopped');
let secrets;
try{secrets=JSON.parse(result.stdout);}catch{throw new Error('Invalid Worker secret metadata');}
if(!Array.isArray(secrets)||!secrets.some(s=>s.name==='TRIAL_IDENTITY_HMAC_KEY'&&s.type==='secret_text'))
  throw new Error('DEV Worker missing TRIAL_IDENTITY_HMAC_KEY secret; deployment stopped before changing Worker code');
console.log('DEV trial identity protection secret exists; value was not read or logged.');
