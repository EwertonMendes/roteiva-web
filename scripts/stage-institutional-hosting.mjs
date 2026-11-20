import {copyFile,mkdir,readdir} from 'node:fs/promises';
import {join,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';

// The app and institutional site share the legal source files.
const files=[
  'sobre.html','suporte.html','privacidade.html','termos.html',
  'legal.css','googleb5008dcbf685c696.html',
  'brand/roteiva-symbol-black.svg','brand/roteiva-wordmark-black.svg',
];
const output=new URL('../dist-site/',import.meta.url);
const outputPath=fileURLToPath(output);
await mkdir(output,{recursive:true});
const existing=await readdir(output,{recursive:true,withFileTypes:true});
for(const entry of existing){
  const path=relative(outputPath,join(entry.parentPath,entry.name)).split(sep).join('/');
  // Deploys use a clean checkout. Reject stale content in local runs as well.
  if(entry.isDirectory()){
    assert.equal(path,'brand','Unexpected directory in institutional output');
    continue;
  }
  assert.ok(entry.isFile()&&files.includes(path),'Unexpected file in institutional output: '+path);
}
await mkdir(new URL('brand/',output),{recursive:true});
for(const path of files){
  const destination=new URL(path,output);
  await copyFile(new URL('../public/'+path,import.meta.url),destination);
}
console.log('Staged legal pages, styles, brand assets and Google verification for roteiva-site-prod.');
