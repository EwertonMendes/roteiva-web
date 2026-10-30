import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import worker from '../src/index.ts';

const settings=JSON.parse(readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8'));
function environment(){
  const sql=[];
  const DB={prepare(query){
    sql.push(query);
    const stmt={bind(){return stmt;},first:async()=>query.includes('AS oauth_without_token')?{
      manual_review:0,stalled:0,oauth_without_token:0,oauth_with_token:0}:null,
      all:async()=>({results:[]}),
      run:async()=>({meta:{changes:0}})};
    return stmt;
  }};
  const cred={type:'service_account',project_id:'roteiva-web-dev',
    client_email:'unit-test@test.iam.gserviceaccount.com',
    private_key:'-----BEGIN PRIVATE KEY-----test',
    token_uri:'https://oauth2.googleapis.com/token'};
  return {env:{DB,ENVIRONMENT:'dev',FIREBASE_PROJECT_ID:'roteiva-web-dev',
    ACCOUNT_DELETION_ENABLED:'true',FIREBASE_ADMIN_CREDENTIALS_JSON:JSON.stringify(cred)},sql};
}
async function run(cron,env){
  let task;
  worker.scheduled({cron},env,{waitUntil(value){task=value;}});
  assert.ok(task,'scheduled callback must retain task');
  await task;
}
test('DEV config retains both urgent and routine Cron triggers',()=>{
  assert.deepEqual(settings.env.dev.triggers.crons,['* * * * *','*/15 * * * *']);
});
test('one-minute cron preserves revocation and deletion checks but skips routine housekeeping',async()=>{
  const {env,sql}=environment();
  await run('* * * * *',env);
  assert.ok(sql.some(x=>x.includes('oauth_exchange_guards')));
  assert.ok(sql.some(x=>x.includes('account_deletions')));
  assert.ok(sql.some(x=>x.includes('review_requests')));
  assert.equal(sql.some(x=>x.includes('drive_upload_attempts')),false);
  assert.equal(sql.some(x=>x.includes('access_rollout')),false);
  assert.equal(sql.some(x=>x.includes('AS oauth_without_token')),false);
});
test('15-minute cron executes retention, monitoring, backfill and upload cleanup only',async()=>{
  const {env,sql}=environment();
  await run('*/15 * * * *',env);
  assert.ok(sql.some(x=>x.includes('drive_upload_attempts')));
  assert.ok(sql.some(x=>x.includes('access_rollout')));
  assert.ok(sql.some(x=>x.includes('AS oauth_without_token')));
  assert.equal(sql.some(x=>x.includes('review_requests')),false);
  assert.ok(sql.some(x=>x.includes('oauth_exchange_guards')));
});
test('unknown Cron schedule fails closed without touching D1',async()=>{
  const {env,sql}=environment();
  const original=console.error;console.error=()=>{};
  try{await run('30 5 * * *',env);}finally{console.error=original;}
  assert.equal(sql.length,0);
});

test('idle D1 polling would fall by over 50 percent based on actual SQL statements',async()=>{
  const frequent=environment(),routine=environment();
  await run('* * * * *',frequent.env);
  await run('*/15 * * * *',routine.env);
  const before=1440*(frequent.sql.length+routine.sql.length);
  const after=1440*frequent.sql.length+96*routine.sql.length;
  console.log(JSON.stringify({check:'cron_idle_d1_estimate',oldPerDay:before,newPerDay:after,
    savedPerDay:before-after,percentReduction:+((1-after/before)*100).toFixed(1)}));
  assert.ok(after<before*0.5,'idle D1 queries should drop by at least half');
});
