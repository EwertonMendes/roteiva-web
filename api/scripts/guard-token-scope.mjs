import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {remoteMetadata,target} from './environment.mjs';
await remoteMetadata();
const other=JSON.parse(readFileSync('wrangler.jsonc','utf8')).env[target==='dev'?'prod':'dev'];
const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${other.account_id}/d1/database/${other.d1_databases[0].database_id}`,{
 headers:{Authorization:'Bearer '+process.env.CLOUDFLARE_API_TOKEN},signal:AbortSignal.timeout(15000)});
await response.body?.cancel();
assert.ok([401,403].includes(response.status),'Deploy credential must not access the other environment');
console.log('Valid '+target+' credential cannot access the other account/database.');
