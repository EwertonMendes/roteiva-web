import { mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
await mkdir('.wrangler', {recursive:true});
await writeFile('.wrangler/studio-migrations.json', JSON.stringify({name:'roteiva-local',compatibility_date:'2026-05-15',d1_databases:[{binding:'DB',database_name:'site-creator-d1',database_id:'00000000-0000-4000-8000-000000000000',migrations_dir:'../drizzle'}]}));
const result=spawnSync(process.execPath,['--import','./scripts/sites-env.mjs','./node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','DB','--local','--config','.wrangler/studio-migrations.json','--persist-to','.wrangler/state'],{stdio:'inherit',env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
if(result.error)throw result.error;
if(result.status) process.exit(result.status);
