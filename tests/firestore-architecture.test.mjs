import {test} from "node:test";
import assert from "node:assert/strict";
import {readdir,readFile} from "node:fs/promises";
import {join} from "node:path";

async function sources(root) {
  const paths=[];
  for (const entry of await readdir(root,{withFileTypes:true})) {
    const path=join(root,entry.name).replaceAll('\\','/');
    if(entry.isDirectory()) paths.push(...await sources(path));
    else if(/\.(tsx?|jsx?)$/.test(path)) paths.push(path);
  }
  return paths;
}
test("UI does not bypass the typed Firestore data layer",async()=>{
  const offenders=[];
  for(const path of await sources("src")){
    if(path.startsWith("src/data/")||path==="src/lib/firebase.ts")continue;
    const content=await readFile(path,"utf8");
    if(/from\s+["']firebase\/firestore["']/.test(content)) offenders.push(path);
  }
  assert.deepEqual(offenders,[],"Move direct queries into the data layer.");
});
test("no UI uses forced Firestore collection reloads",async()=>{
  const offenders=[];
  for(const path of await sources("src")){
    if(path.startsWith("src/data/"))continue;
    const content=await readFile(path,"utf8");
    if(/getDocsFromServer\s*\(|getCountFromServer\s*\(/.test(content)) offenders.push(path);
  }
  assert.deepEqual(offenders,[],"Component-level Firestore queries defeat cache reuse.");
});
