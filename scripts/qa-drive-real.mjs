// Opt-in Google integration proof. No mocks, proxy, saved browser profile or traces.
// Requires a disposable, already linked/authorized test folder and an active test UID.
import {chromium} from '@playwright/test';
import ts from 'typescript';
import {readFile,stat} from 'node:fs/promises';

const names=['ROTEIVA_QA_FIREBASE_TOKEN','ROTEIVA_QA_DRIVE_CONNECTION','ROTEIVA_QA_DRIVE_FOLDER',
  'ROTEIVA_QA_DRIVE_LINKED_FOLDER','ROTEIVA_QA_PROJECT_ID','ROTEIVA_QA_VIDEO_FILE'];
if(names.some(name=>!process.env[name]) || process.env.ROTEIVA_QA_DISPOSABLE_FOLDER!=='yes'){
  console.error('BLOCKED: configure the documented disposable DEV fixture and environment variables.');
  process.exit(2);
}
const size=(await stat(process.env.ROTEIVA_QA_VIDEO_FILE)).size;
if(size<=250*1024*1024)throw new Error('Use a test video larger than 250 MiB.');
const source=ts.transpileModule(await readFile(new URL('../src/features/drive/drive-upload-client.ts',import.meta.url),'utf8'),
  {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const origin='https://roteiva-web-dev.web.app';
const browser=await chromium.launch({headless:true});
const statuses={};let incompleteRanges=0;
try{
  const page=await browser.newPage();
  page.on('response',response=>{
    const url=new URL(response.url());
    if(url.hostname==='www.googleapis.com'&&url.pathname==='/upload/drive/v3/files'){
      const status=response.status();statuses[status]=(statuses[status]||0)+1;
      if(status===308 && response.headers().range)incompleteRanges++;
    }
  });
  await page.goto(origin,{waitUntil:'domcontentloaded'});
  await page.evaluate(()=>{
    const input=document.createElement('input');input.type='file';input.dataset.realDriveQa='';document.body.append(input);
  });
  await page.locator('input[data-real-drive-qa]').setInputFiles(process.env.ROTEIVA_QA_VIDEO_FILE);
  const result=await page.evaluate(async config=>{
    const {sendToDrive}=await import(URL.createObjectURL(new Blob([config.source],{type:'text/javascript'})));
    const input=document.querySelector('input[data-real-drive-qa]');const file=input.files[0];
    const api='https://roteiva-api-dev.ewertonmendes9.workers.dev';
    const endpoint=api+'/integrations/drive/'+encodeURIComponent(config.connection)+'/folders/'+encodeURIComponent(config.folder)+'/uploads';
    const call=async(path,payload)=>{
      const response=await fetch(path,{method:'POST',cache:'no-store',headers:{Authorization:'Bearer '+config.token,
        'Content-Type':'application/json'},body:JSON.stringify(payload)});
      if(!response.ok){const error=await response.json();throw new Error('Worker: '+(error?.error?.code||response.status));}
      return response.json();
    };
    const metadata={attemptId:crypto.randomUUID(),projectId:Number(config.project),linkedFolderId:config.linked,
      name:file.name,size:file.size,mimeType:file.type||'application/octet-stream'};
    const session=await call(endpoint,metadata);
    let deliberatelyLostReply=false;
    if(config.interrupt){
      const nativeFetch=window.fetch.bind(window);
      window.fetch=async(...args)=>{
        const response=await nativeFetch(...args);
        if(new URL(String(args[0])).hostname==='www.googleapis.com'&&response.status===308&&!deliberatelyLostReply){
          deliberatelyLostReply=true;await response.body?.cancel();throw new TypeError('Intentionally lost acknowledgement');
        }
        return response;
      };
    }
    let confirmed=0,updates=0,monotonic=true;
    const uploaded=await sendToDrive(file,session,new AbortController().signal,bytes=>{
      monotonic=monotonic&&bytes>=confirmed;confirmed=bytes;updates++;
    });
    const verified=await call(endpoint+'/complete',{attemptId:session.attemptId,projectId:metadata.projectId,
      linkedFolderId:metadata.linkedFolderId,fileId:uploaded.id,size:file.size});
    return {verified:verified.file.id===uploaded.id,bytes:file.size,confirmed,updates,monotonic,deliberatelyLostReply};
  },{source,token:process.env.ROTEIVA_QA_FIREBASE_TOKEN,connection:process.env.ROTEIVA_QA_DRIVE_CONNECTION,
    folder:process.env.ROTEIVA_QA_DRIVE_FOLDER,linked:process.env.ROTEIVA_QA_DRIVE_LINKED_FOLDER,
    project:process.env.ROTEIVA_QA_PROJECT_ID,interrupt:process.env.ROTEIVA_QA_INTERRUPT==='yes'});
  if(!result.verified||result.confirmed!==size||!incompleteRanges||!result.monotonic||
    (process.env.ROTEIVA_QA_INTERRUPT==='yes'&&!result.deliberatelyLostReply))throw new Error('Incomplete real integration evidence.');
  console.log(JSON.stringify({environment:'dev',provider:'Google Drive real',...result,statuses,incompleteRanges,
    caveat:'One acknowledgement can be intentionally lost locally; Google responses and uploaded bytes are real. File retained in disposable folder.'}));
}catch(error){
  // Do not print raw exceptions: browser errors can include session URLs or tokens.
  console.error(JSON.stringify({status:'FAILED',statuses,incompleteRanges,reason:'Inspect the application error locally; no credentials or URLs are recorded.'}));
  process.exitCode=1;
}finally{await browser.close();}
