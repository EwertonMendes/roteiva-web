import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../src/',import.meta.url));
function walk(folder){
  return readdirSync(folder,{withFileTypes:true}).flatMap(entry=>{
    const path=join(folder,entry.name);
    return entry.isDirectory()?walk(path):entry.name.endsWith('.tsx')?[path]:[];
  });
}
test('frontend forms use a single React input, textarea and button contract',()=>{
  const excluded=new Set(['features/ui/AppInput.tsx','features/ui/AppTextarea.tsx','features/ui/AppButton.tsx']);
  const hiddenSelect='features/ui/AppSelect.tsx';
  let migrated=0;
  for(const path of walk(root)){
    const file=relative(root,path).replaceAll('\\','/');
    if(excluded.has(file))continue;
    const code=readFileSync(path,'utf8');
    const rawInput=[...code.matchAll(/<input(?=[\s/>])/g)];
    const rawTextarea=[...code.matchAll(/<textarea(?=[\s/>])/g)];
    const rawButton=[...code.matchAll(/<button(?=[\s/>])/g)];
    if(file===hiddenSelect){
      assert.equal(rawInput.length,1,'Only the hidden form field inside AppSelect may be native');
      assert.match(code,/<input type="hidden" name=\{name\}/);
    }else assert.equal(rawInput.length,0,file+' must import AppInput');
    assert.equal(rawTextarea.length,0,file+' must import AppTextarea');
    assert.equal(rawButton.length,0,file+' must import AppButton');
    migrated+=[...code.matchAll(/<App(Input|Textarea|Button)(?=[\s/>])/g)].length;
  }
  assert.ok(migrated>200,'Shared controls must cover the existing app, not only demos');
});
test('design system keeps branded focus and native input semantics',()=>{
 const tokens=readFileSync(new URL('../src/features/ui/form-controls.css',import.meta.url),'utf8');
 const controls=readFileSync(new URL('../src/features/ui/controls.css',import.meta.url),'utf8');
 assert.match(tokens,/--rt-brand-lime: #cfff47;/);
 assert.match(tokens,/--field-focus-border: var\(--rt-brand-lime\);/);
 assert.match(controls,/:not\(\[type="checkbox"\]\)/);
 assert.match(controls,/:not\(\[type="radio"\]\)/);
 const input=readFileSync(new URL('../src/features/ui/AppInput.tsx',import.meta.url),'utf8');
 assert.match(input,/forwardRef<HTMLInputElement/);
 assert.match(input,/<input \{\.\.\.props\}/);
});

test('retired workspace copy export has no frontend entrypoints, data fetcher, or styles',()=>{
  const base=new URL('../src/',import.meta.url);
  const files=['dashboard-client.tsx','studio-features.tsx','features/workspace/FirebaseWorkspace.tsx',
    'globals.css','responsive.css','features/drive/drive-library.css'];
  for(const file of files){
    const source=readFileSync(new URL(file,base),'utf8');
    for(const removed of ['WorkspaceTools','Exportar cópia','Preparando cópia',
      'Roteiva-backup-','ensureFullWorkspace','onLoadWorkspace','rl-page-more',
      'workspace-tools','Falha ao salvar · exporte seus dados']){
      assert.equal(source.includes(removed),false,file+' must not retain '+removed);
    }
  }
  const finance=readFileSync(new URL('features/finance/FinancePanel.tsx',base),'utf8');
  assert.match(finance,/Exportar CSV/,'The separate financial CSV export must remain available');
  const dash=readFileSync(new URL('dashboard-client.tsx',base),'utf8');
  assert.doesNotMatch(dash,/finance-export-copy|downloadLoadedFinanceCopy|Exportar cópia/);
  const css=readFileSync(new URL('features/finance/finance.css',base),'utf8');
  assert.doesNotMatch(css,/finance-export-copy/);
  assert.equal(existsSync(new URL('features/finance/finance-export.ts',base)),false,'Obsolete JSON-copy module must be deleted');
});

test('library counter callback is retired and collection states are reused',()=>{
  const base=new URL('../src/',import.meta.url);
  const dash=readFileSync(new URL('dashboard-client.tsx',base),'utf8');
  const drive=readFileSync(new URL('features/drive/DriveConnectionPanel.tsx',base),'utf8');
  const dropbox=readFileSync(new URL('features/dropbox/DropboxConnectionPanel.tsx',base),'utf8');
  assert.doesNotMatch(dash,/linkedFolderCount|onLinkedFolderCountChange|<span>Biblioteca<\/span><em>/);
  assert.doesNotMatch(drive,/onLinkedFolderCountChange|countCallback/);
  assert.doesNotMatch(dropbox,/onLinkedFolderCountChange/);
  for(const path of ['features/finance/FinancePanel.tsx','features/reviews/ReviewsDashboard.tsx',
    'features/drive/DriveLibraryUI.tsx','features/drive/DriveConnectionPanel.tsx',
    'features/dropbox/DropboxConnectionPanel.tsx']){
    assert.match(readFileSync(new URL(path,base),'utf8'),/<CollectionState[\s>]/,path);
  }
});
