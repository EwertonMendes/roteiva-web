import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {environments} from '../../shared/environments.ts';

export const target=process.argv[2];
assert.ok(target==='dev'||target==='prod','Explicit dev/prod required');
export const config=JSON.parse(readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8')).env[target];
const other=JSON.parse(readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8')).env[target==='dev'?'prod':'dev'];
const expected=environments[target];
assert.match(config.account_id,/^[0-9a-f]{32}$/);
assert.notEqual(config.account_id,'0'.repeat(32),'Account not provisioned');
assert.notEqual(config.account_id,other.account_id,'Cloudflare accounts must be isolated');
assert.equal(config.name,expected.workerName);
assert.equal(config.vars.ENVIRONMENT,target);
assert.equal(config.vars.FIREBASE_PROJECT_ID,expected.projectId);
assert.equal(config.vars.FRONTEND_ORIGIN,expected.frontendOrigin);
assert.equal(config.vars.OAUTH_REDIRECT_URI,expected.apiOrigin+'/oauth/drive/callback');
assert.equal(config.vars.DROPBOX_OAUTH_REDIRECT_URI,expected.apiOrigin+'/oauth/dropbox/callback');
assert.equal(config.d1_databases.length,1);
assert.equal(config.d1_databases[0].binding,'DB');
assert.equal(config.d1_databases[0].database_name,expected.databaseName);
assert.match(config.d1_databases[0].database_id,/^[0-9a-f]{8}-[0-9a-f-]{27}$/);
assert.notEqual(config.d1_databases[0].database_id,'00000000-0000-0000-0000-000000000000','D1 not provisioned');
assert.notEqual(config.d1_databases[0].database_id,other.d1_databases[0].database_id);
assert.equal(process.env.CLOUDFLARE_ACCOUNT_ID,config.account_id,'Protected account variable mismatch');
assert.equal(process.env.CLOUDFLARE_D1_DATABASE_ID,config.d1_databases[0].database_id,'Protected database variable mismatch');
assert.equal(process.env.API_BASE_URL,expected.apiOrigin,'Endpoint migration not acknowledged');

export function wrangler(args){
  const child=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js',...args],{
    encoding:'utf8',env:{...process.env,WRANGLER_SEND_METRICS:'false',WRANGLER_WRITE_LOGS:'false'},maxBuffer:8*1024*1024});
  if(child.status!==0)throw new Error('Cloudflare operation failed; sensitive output suppressed');
  return JSON.parse(child.stdout);
}
export async function remoteMetadata(){
  assert.ok(process.env.CLOUDFLARE_API_TOKEN,'Missing account-scoped deploy credential');
  const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${config.account_id}/d1/database/${config.d1_databases[0].database_id}`,{
    headers:{Authorization:'Bearer '+process.env.CLOUDFLARE_API_TOKEN},signal:AbortSignal.timeout(15000)});
  const body=await response.json();assert.ok(response.ok&&body.success,'Remote D1 metadata unavailable');
  assert.equal(body.result.uuid,config.d1_databases[0].database_id);assert.equal(body.result.name,expected.databaseName);
}
export function query(sql){
  const result=wrangler(['d1','execute','DB','--env',target,'--remote','--json','--command',sql]);
  assert.ok(result.every(item=>item.success));return result.flatMap(item=>item.results);
}
