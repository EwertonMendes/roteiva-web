// Explicit, short-lived maintenance operation. No normal deployment imports this.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';

const [sourceAccount,sourceOrigin,outputDirectory,expectedVersion,backupFile,backupSha256]=process.argv.slice(2);
assert.match(sourceAccount||'',/^[a-f0-9]{32}$/);
assert.match(expectedVersion||'',/^[a-f0-9-]{36}$/);
assert.equal(new URL(sourceOrigin).pathname,'/');assert.equal(new URL(sourceOrigin).protocol,'https:');
assert.ok(outputDirectory&&resolve(outputDirectory)===outputDirectory,'Absolute private output directory required');
assert.ok(backupFile&&resolve(backupFile)===backupFile,'Reviewed original multipart backup path required');
assert.match(backupSha256||'',/^[a-f0-9]{64}$/,'Reviewed original backup SHA-256 required');
const backup=readFileSync(backupFile);
assert.equal(createHash('sha256').update(backup).digest('hex'),backupSha256,'Original backup changed');
const backupHeaders=JSON.parse(readFileSync(backupFile.replace(/\.bin$/,'.headers.json'),'utf8')).headers;
const credential=process.env.CLOUDFLARE_API_TOKEN;assert.ok(credential,'Source-account deploy token required');
const base=`https://api.cloudflare.com/client/v4/accounts/${sourceAccount}/workers/scripts/roteiva-api-dev`;
const call=async(path,options={})=>{
 const r=await fetch(base+path,{...options,headers:{Authorization:'Bearer '+credential,...options.headers}});
 if(!r.ok)throw new Error('Source Worker operation failed: HTTP '+r.status);
 const data=await r.json();assert.equal(data.success,true,'Source operation rejected');return data.result;
};
const deployments=await call('/deployments');assert.equal(deployments.deployments[0].versions.length,1);
assert.equal(deployments.deployments[0].versions[0].version_id,expectedVersion,'Source changed; refuse maintenance');
const settings=await call('/settings');
const values=Object.fromEntries(settings.bindings.filter(b=>b.type==='plain_text').map(b=>[b.name,b.text]));
assert.equal(values.ENVIRONMENT,'dev');assert.equal(values.FIREBASE_PROJECT_ID,'roteiva-web-dev');
// content/v2 can return the latest upload instead of the active deployment.
// Use the operator-reviewed backup associated with expectedVersion, never that endpoint.
const response=new Response(backup,{headers:backupHeaders});
const original=await response.formData(),entry=response.headers.get('cf-entrypoint');assert.ok(entry);
mkdirSync(outputDirectory,{recursive:true});
const signing=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
const recipient=await crypto.subtle.generateKey({name:'RSA-OAEP',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['encrypt','decrypt']);
const config={path:'/__ops/'+crypto.randomUUID(),expiresAt:Date.now()+300000,
 signingPublicKey:await crypto.subtle.exportKey('jwk',signing.publicKey),encryptionPublicKey:await crypto.subtle.exportKey('jwk',recipient.publicKey)};
const keyfile=resolve(outputDirectory,'transfer-recipient.private.json');
writeFileSync(keyfile,JSON.stringify(await crypto.subtle.exportKey('jwk',recipient.privateKey)),{mode:0o600});
const form=new FormData();
for(const [name,part] of original)if(name!=='metadata')form.set(name,part);
form.set('sealed-transfer.mjs',new File([readFileSync(new URL('./sealed-dev-transfer.mjs',import.meta.url))],'sealed-transfer.mjs',{type:'application/javascript+module'}));
form.set('migration-entry.mjs',new File([
 `import original from './${entry}'; export * from './${entry}';\nimport {transferHandler} from './sealed-transfer.mjs';\nconst transfer=transferHandler(${JSON.stringify(config)});\nexport default {...original, async fetch(request,env,ctx){return await transfer(request,env)||original.fetch(request,env,ctx);}};`
],'migration-entry.mjs',{type:'application/javascript+module'}));
const metadata={main_module:'migration-entry.mjs',compatibility_date:settings.compatibility_date,
 compatibility_flags:settings.compatibility_flags||[],keep_bindings:['secret_text','secret_key'],
 bindings:settings.bindings.filter(b=>!['secret_text','secret_key'].includes(b.type)),observability:settings.observability};
form.set('metadata',JSON.stringify(metadata));
writeFileSync(resolve(outputDirectory,'transfer-rollback.json'),JSON.stringify({sourceAccount,expectedVersion,config},null,2));
let attempted=false;
try{
 attempted=true;await call('',{method:'PUT',body:form});
 const message=new TextEncoder().encode('POST\n'+config.path+'\n'+config.expiresAt);
 const signature=Buffer.from(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},signing.privateKey,message)).toString('base64');
 let result;
 for(let n=0;n<12;n++){
  const r=await fetch(new URL(config.path,sourceOrigin),{method:'POST',headers:{'X-Migration-Signature':signature},signal:AbortSignal.timeout(15000)});
  if(r.ok){result=await r.json();break;}
  await new Promise(done=>setTimeout(done,1000));
 }
 assert.ok(result?.encrypted,'Encrypted transfer did not become available');
 writeFileSync(resolve(outputDirectory,'dev-secrets.sealed.json'),JSON.stringify({config,...result}),{mode:0o600});
 const raw=await crypto.subtle.decrypt({name:'RSA-OAEP'},recipient.privateKey,Buffer.from(result.wrapped,'base64'));
 const key=await crypto.subtle.importKey('raw',raw,'AES-GCM',false,['decrypt']);
 const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:Buffer.from(result.iv,'base64'),additionalData:message},key,Buffer.from(result.encrypted,'base64'));
 const secrets=JSON.parse(new TextDecoder().decode(plain));assert.equal(Object.keys(secrets).length,7);
 // Local recovery input is private and must be encrypted/backed up by the operator.
 writeFileSync(resolve(outputDirectory,'dev-secrets.private.json'),JSON.stringify(secrets),{mode:0o600});
 console.log('Seven DEV credentials recovered through recipient-only encryption. No values logged.');
}finally{
 if(attempted){
  await call('/deployments',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({strategy:'percentage',versions:[{version_id:expectedVersion,percentage:100}]})});
  const current=await call('/deployments');assert.equal(current.deployments[0].versions[0].version_id,expectedVersion,'Restore must be verified');
  console.log('Original DEV Worker version restored and verified.');
 }
}
