import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

/** Audit remains blocking for known high/critical vulnerabilities or local errors.
 * Only transient registry-audit transport failures are warnings in DEV.
 */
export function evaluateAudit(result){
  let payload;
  try { payload=JSON.parse(result.stdout||''); }catch{ /* npm may return plain-text transport errors */ }
  const counts=payload?.metadata?.vulnerabilities;
  const high=Number(counts?.high||0),critical=Number(counts?.critical||0);
  if(counts&&high+critical>0){
    const affected=Object.entries(payload?.vulnerabilities||{}).filter(([,v])=>v&&['high','critical'].includes(v.severity))
      .map(([name,v])=>name+' ('+v.severity+', fix '+(v.fixAvailable?.name|| (v.fixAvailable===true?'available':'unavailable'))+')').slice(0,12);
    return {ok:false,warning:false,message:`Dependency audit failed: ${high} high and ${critical} critical vulnerabilities. ${affected.join(', ')}`};
  }
  if(result.status===0&&counts)return {ok:true,warning:false,message:'Dependency audit passed.'};
  const report=`${payload?.error?.code||''} ${payload?.error?.summary||''} ${result.stderr||''} ${result.error?.message||''}`;
  const remoteError=/ENOAUDIT|EAI_AGAIN|ECONNRESET|ETIMEDOUT|ETIMEDOUT|FETCH_ERROR|ERR_SOCKET_TIMEOUT|network timeout|audit endpoint returned an error|request to .*\/security\/audits\/quick failed|socket hang up/i.test(report);
  if(remoteError)return {ok:true,warning:true,message:'npm registry audit endpoint unavailable; DEV deployment may proceed, but the online vulnerability audit was deferred.'};
  return {ok:false,warning:false,message:`Audit did not provide a verifiable security result. ${report.slice(0,500)}`};
}
export function run(){
  const result=spawnSync('npm',['audit','--json','--audit-level=high','--fetch-retries=1','--fetch-timeout=20000'],{
    cwd:resolve(fileURLToPath(new URL('..',import.meta.url))),encoding:'utf8',timeout:70000,
    maxBuffer:4*1024*1024,env:{...process.env,npm_config_fund:'false'}
  });
  const evaluation=evaluateAudit(result);
  if(evaluation.warning){
    process.stdout.write('::warning::'+evaluation.message+'\n');
  }else if(!evaluation.ok){
    process.stderr.write('::error::'+evaluation.message+'\n');
  }else{
    process.stdout.write(evaluation.message+'\n');
  }
  if(!evaluation.ok)process.exitCode=1;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))run();
