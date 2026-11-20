import {copyFile,mkdir,readdir} from 'node:fs/promises';
import {dirname,join,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';

// The app and institutional site share the legal source files.
const files=[
  'sobre.html','suporte.html','privacidade.html','termos.html',
  'legal.css','googleb5008dcbf685c696.html',
  'brand/roteiva-symbol-black.svg','brand/roteiva-wordmark-black.svg',
  'fonts/ubuntu/Ubuntu-Regular.ttf','fonts/ubuntu/Ubuntu-Bold.ttf','fonts/ubuntu/UFL.txt',
];
const output=new URL('../dist-site/',import.meta.url);
const outputPath=fileURLToPath(output);
await mkdir(output,{recursive:true});
const existing=await readdir(output,{recursive:true,withFileTypes:true});
for(const entry of existing){
  const path=relative(outputPath,join(entry.parentPath,entry.name)).split(sep).join('/');
  // Deploys use a clean checkout. Reject stale content in local runs as well.
  if(entry.isDirectory()){
    assert.ok(['brand','fonts','fonts/ubuntu'].includes(path),'Unexpected directory in institutional output: '+path);
    continue;
  }
  assert.ok(entry.isFile()&&(path==='index.html'||files.includes(path)),'Unexpected file in institutional output: '+path);
}
for(const path of files){
  const destination=new URL(path,output);
  await mkdir(dirname(fileURLToPath(destination)),{recursive:true});
  await copyFile(new URL('../public/'+path,import.meta.url),destination);
}
await copyFile(new URL('../institutional/index.html',import.meta.url),new URL('index.html',output));
console.log('Staged the institutional homepage, legal pages, brand assets and Google verification.');
