import {test,expect,type Page} from './fixtures';
const web='http://127.0.0.1:4173',api='http://127.0.0.1:8787';
const connection='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
test.skip(!process.env.VIRTUAL_LIBRARY_E2E,'Run with the dedicated virtual-library build/config.');
async function chooseLibraryProject(page:Page){
 await page.getByRole('button',{name:'Projeto dos arquivos'}).click();
 await page.getByRole('option',{name:'Projeto Biblioteca QA'}).click();
}
async function libraryAdd(page:Page,name:string){
 await page.getByRole('button',{name:'Adicionar',exact:true}).click();
 await page.getByRole('button',{name,exact:true}).click();
}
async function libraryMenu(page:Page,file:string,action:string){
 await page.getByRole('button',{name:'Ações de '+file,exact:true}).click();
 await page.getByRole('button',{name:action,exact:true}).click();
}

async function prepare(page:Page,email:string){
 await page.goto(web);await page.getByRole('button',{name:'Criar conta',exact:true}).click();
 const popupPromise=page.waitForEvent('popup');await page.getByRole('button',{name:'Cadastrar com Google',exact:true}).click();
 const popup=await popupPromise;await popup.waitForLoadState('load');await popup.getByRole('button',{name:'Add new account',exact:true}).click();
 await popup.locator('#email-input').fill(email);await popup.locator('#display-name-input').fill('Biblioteca QA');await popup.locator('#sign-in').click();
 await page.getByLabel('Como podemos chamar você?').fill('Biblioteca QA');await page.getByLabel('Nome do estúdio ou marca').fill('Estúdio QA');
 await page.getByLabel('Concordo com o uso dos meus dados').check();await page.getByRole('button',{name:'Criar meu espaço de trabalho'}).click();
 await expect(page.locator('.app-shell')).toBeVisible();await page.goto(web+'/projetos');
 await page.locator('.heading-actions').getByRole('button',{name:'Criar projeto',exact:true}).click();
 await page.getByLabel('Nome do projeto',{exact:true}).fill('Projeto Biblioteca QA');
 await page.locator('form.project-modal').getByRole('button',{name:'Criar projeto',exact:true}).click();
 await expect(page.getByText('Projeto Biblioteca QA',{exact:true}).first()).toBeVisible();
 await expect(page.locator('[aria-busy]').first()).toHaveAttribute('aria-busy','false');
}
test('virtual navigation preserves folder commands and a partial Dropbox batch retries only failed files',async({page,context},info)=>{
 type Node={id:string;parent_id:string|null;kind:'folder'|'asset';name:string;state:string;revision:number;asset_id?:string;provider?:string;connection_id?:string;file_id?:string;source_revision?:string;mime_type?:string};
 const nodes:Node[]=[{id:'root',parent_id:null,kind:'folder',name:'Arquivos',state:'active',revision:1}];
 const batches:string[][]=[];let failure=true;
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
 let requestedThumbnails=0,previewRequests=0,searchRequests=0;
 const headers={'Access-Control-Allow-Origin':web,'Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Allow-Methods':'GET, POST, OPTIONS'};
 await context.route(api+'/**',async route=>{
  const req=route.request(),url=new URL(req.url()),path=url.pathname;
  const json=(body:unknown,status=200)=>route.fulfill({status,headers,json:body});
  if(req.method()==='OPTIONS')return route.fulfill({status:204,headers});
  if(path.startsWith('/access/')||path.startsWith('/account/'))return route.fallback();
  if(path==='/integrations/drive')return json({connections:[]});
  if(path==='/integrations/dropbox')return json({connections:[{id:connection,email:'qa@example.com',status:'connected',scopes:'files.metadata.read files.content.read files.content.write'}]});
  if(path.startsWith('/integrations/dropbox/')&&path.endsWith('/items')){if(url.searchParams.get('search')==='Imagem')searchRequests++;return json({files:[{id:'id:FILE_SELECTED_A',name:'Imagem A.png',mimeType:'image/png',thumbnailFallback:true,isFolder:false},{id:'id:FILE_SELECTED_B',name:'Imagem B.png',mimeType:'image/png',thumbnailFallback:true,isFolder:false}],nextPageToken:null});}
   if(path.startsWith('/integrations/dropbox/')&&path.endsWith('/thumbnail')){requestedThumbnails++;return route.fulfill({status:200,headers:{...headers,'Content-Type':'image/png'},body:png});}
   if(/\/library\/projects\/\d+\/nodes\/[0-9a-f-]+\/content$/.test(path)){
    previewRequests++;return route.fulfill({status:200,headers:{...headers,'Content-Type':'image/png','Content-Length':String(png.length)},body:png});
   }
  if(path.endsWith('/uploads/destination'))return json({targetFolderId:'managed-target'});
  if(path.endsWith('/imports')){
   const body=req.postDataJSON(),ids=body.items.map((x:{fileId:string})=>x.fileId);batches.push(ids);
   const results=ids.map((fileId:string)=>{
    if(fileId.endsWith('_B')&&failure)return {fileId,status:'failed',code:'dropbox_rate_limited'};
    const id=crypto.randomUUID();nodes.push({id,parent_id:body.parentId,kind:'asset',asset_id:id,name:fileId.endsWith('_A')?'Imagem A.png':'Imagem B.png',state:'active',revision:1,provider:'dropbox',connection_id:connection,file_id:fileId,source_revision:'r1',mime_type:'image/png'});return {fileId,status:'added',id};
   });failure=false;return json({results});
  }
  if(path.endsWith('/structure')){
   const body=req.postDataJSON(),mapping=new Map<string,string>();
   for(const folder of body.folders){const id=crypto.randomUUID();mapping.set(folder.key,id);nodes.push({id,parent_id:folder.parentKey===null?body.parentId:mapping.get(folder.parentKey)!,kind:'folder',name:folder.name,state:'active',revision:1});}
   return json({created:Array.from(mapping,([key,id])=>({key,id})),completed:true});
  }
  if(/\/library\/projects\/\d+\/nodes(?:\/[0-9a-f-]+)?$/.test(path)){
   if(req.method()==='GET'){
    const parent=url.searchParams.get('parent')||'root',trash=url.searchParams.get('trash')==='1';
    return json({nodes:nodes.filter(x=>x.id!=='root'&&(trash?x.state==='trashed':x.parent_id===parent&&x.state==='active')),trail:trash?[{id:'root',name:'Lixeira'}]:parent==='root'?[nodes[0]]:[nodes[0],nodes.find(x=>x.id===parent)],nextPage:null});
   }
   const body=req.postDataJSON(),id=/\/nodes\/([^/]+)$/.exec(path)?.[1];
   if(!id){const created=crypto.randomUUID();nodes.push({id:created,parent_id:body.parentId,kind:'folder',name:body.name,state:'active',revision:1});return json({id:created},201);}
   const node=nodes.find(x=>x.id===id)!;if(body.action==='rename')node.name=body.name;
   if(body.action==='move')node.parent_id=body.parentId;
   if(body.action==='trash'||body.action==='restore')node.state=body.action==='trash'?'trashed':'active';node.revision++;return json({updated:true});
  }
  return json({error:{code:'not_found'}},404);
 });
 await prepare(page,'virtual-'+info.project.name+'-'+Date.now()+'@example.com');await page.goto(web+'/biblioteca');
 // The unselected library must have a polished, meaningful empty state, not a wall of disabled actions.
 await expect(page.getByRole('heading',{name:'Selecione um projeto'})).toBeVisible();
 await expect(page.getByRole('button',{name:'Nova pasta',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Contas de armazenamento'}).click();
 const manager=page.getByRole('dialog',{name:'Contas de armazenamento'});
 await expect(manager).toBeVisible();
 await expect(manager.getByRole('heading',{name:'Google Drive'})).toBeVisible();
 await expect(manager.getByRole('heading',{name:'Dropbox'})).toBeVisible();
 await expect(manager.getByText('qa@example.com',{exact:true})).toBeVisible();
 await expect(manager.getByRole('button',{name:'Conectar Google Drive',exact:true})).toBeVisible();
 await expect(manager.getByRole('button',{name:'Conectar Dropbox',exact:true})).toHaveCount(0);
 await expect(manager.locator('details')).toHaveCount(0);
 expect(await manager.evaluate(el=>el.scrollWidth<=el.clientWidth+2)).toBe(true);
 await page.getByRole('button',{name:'Fechar contas'}).click();
 await expect(page.locator('.vl-explorer-head')).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
 await chooseLibraryProject(page);
 await expect(page.getByRole('navigation',{name:'Caminho da pasta'})).toBeVisible();
 await expect(page.getByRole('button',{name:'Adicionar',exact:true}).locator('svg')).toHaveCount(1);
 await expect(page.getByRole('button',{name:'Estrutura de pastas',exact:true}).locator('svg')).toHaveCount(1);
 await libraryAdd(page,'Nova pasta');await page.getByLabel('Nome',{exact:true}).fill('Vídeos');await page.getByRole('button',{name:'Confirmar',exact:true}).click();
 await page.getByRole('button',{name:'Vídeos',exact:true}).click();
 await libraryAdd(page,'Nova pasta');await page.getByLabel('Nome',{exact:true}).fill('Originais');await page.getByRole('button',{name:'Confirmar',exact:true}).click();
 await expect(page.getByRole('button',{name:'Originais',exact:true})).toBeVisible();
 if(info.project.name==='desktop'){
  await page.locator('.vl-file-area').click({button:'right',position:{x:12,y:14}});
  const backgroundMenu=page.getByRole('group',{name:'Ações da pasta atual'});
  await expect(backgroundMenu.getByRole('button',{name:'Nova pasta'})).toBeVisible();
  await backgroundMenu.getByRole('button',{name:'Nova pasta'}).click();
  await expect(page.getByLabel('Nome',{exact:true})).toBeFocused();
  await page.getByLabel('Nome',{exact:true}).fill('Do contexto');
  await page.getByRole('button',{name:'Confirmar',exact:true}).click();
  await expect(page.getByRole('button',{name:'Do contexto',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Exibir grade'}).click();
  await expect(page.locator('.vl-explorer-folders [data-kind=folder]')).toHaveCount(2);
  await page.getByRole('button',{name:'Exibir lista'}).click();
 }
 await libraryAdd(page,'Adicionar do Dropbox');
 const picker=page.getByRole('dialog',{name:'Adicionar do Dropbox'});
 await expect(picker.locator('.lib-browser-grid .lib-picker-tile')).toHaveCount(2);
 await picker.getByRole('searchbox',{name:'Buscar arquivos no Dropbox'}).fill('Imagem');
 await expect.poll(()=>searchRequests).toBeGreaterThan(0);
 await expect(picker.locator('.lib-browser-grid .lib-picker-tile')).toHaveCount(2);
 await picker.getByRole('searchbox',{name:'Buscar arquivos no Dropbox'}).fill('');
 await expect.poll(async()=>picker.locator('.lib-picker-tile .rl-file-icon--image img').count()).toBeGreaterThan(0);
 await picker.getByLabel('Imagem A.png').check();await picker.getByLabel('Imagem B.png').check();await picker.getByRole('button',{name:'Adicionar selecionados'}).click();
 await expect(page.getByRole('button',{name:'Imagem A.png',exact:true})).toBeVisible();
 await expect(page.getByRole('alert').filter({hasText:'Imagem B.png'})).toBeVisible();
 await page.getByRole('button',{name:'Tentar somente os arquivos pendentes'}).click();
 await expect(page.getByRole('button',{name:'Imagem B.png',exact:true})).toBeVisible();
 expect(batches).toEqual([['id:FILE_SELECTED_A','id:FILE_SELECTED_B'],['id:FILE_SELECTED_B']]);
 // The upload queue remains mounted but cannot obscure the virtual preview.
 const chooser=page.waitForEvent('filechooser');
 await libraryAdd(page,'Enviar ao Dropbox');
 await (await chooser).setFiles({name:'queue-overlay.txt',mimeType:'text/plain',buffer:Buffer.from('synthetic fixture')});
 await expect(page.getByRole('complementary',{name:'Transferências de arquivos'})).toBeVisible();
 await page.getByRole('button',{name:'Imagem A.png',exact:true}).click();
 const imageDialog=page.getByRole('dialog',{name:'Prévia de Imagem A.png'});
 await expect(imageDialog).toBeVisible();
 await expect(imageDialog.locator('.vl-preview-image')).toBeVisible();
 await expect.poll(()=>imageDialog.locator('.vl-preview-image').evaluate(el=>(el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
 expect(previewRequests).toBeGreaterThan(0);
 expect(requestedThumbnails).toBeGreaterThan(0);
 await expect(page.locator('.rl-upload-queue')).toBeHidden();
 await page.getByRole('button',{name:'Fechar prévia'}).click();
 await expect(page.locator('.rl-upload-queue')).toBeVisible();
 // Discard only the synthetic failed transfer before exercising the remaining mobile UI.
 const expand=page.getByRole('button',{name:'Expandir transferências'});
 if(await expand.isVisible())await expand.click();
 await page.getByRole('button',{name:'Dispensar queue-overlay.txt'}).click();
 await expect(page.locator('.rl-upload-queue')).toHaveCount(0);
 await libraryMenu(page,'Originais','Renomear');
 await expect(page.getByLabel('Nome',{exact:true})).toBeFocused();
 await page.getByLabel('Nome',{exact:true}).fill('Brutos');await page.getByRole('button',{name:'Confirmar',exact:true}).click();
 // A folder picker must explain unchanged destinations and keep a cancel action.
 await libraryMenu(page,'Brutos','Mover');
 const move=page.getByRole('dialog',{name:'Mover para'});
 await expect(move.getByRole('navigation',{name:'Pasta de destino'})).toBeVisible();
 await expect(move.getByRole('button',{name:'Vídeos',exact:true})).toBeVisible();
 await move.getByRole('button',{name:'Vídeos',exact:true}).click();
 await expect(move.getByText('Este item já está nesta pasta.')).toBeVisible();
 await expect(move.getByRole('button',{name:'Mover para cá'})).toBeDisabled();
 await move.getByRole('button',{name:'Cancelar'}).click();
 await libraryMenu(page,'Brutos','Remover da Biblioteca');await page.getByRole('button',{name:'Remover da Biblioteca',exact:true}).last().click();
 await expect(page.getByRole('button',{name:'Brutos',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Lixeira',exact:true}).click();
 await expect(page.getByText('Itens removidos da Biblioteca. Os arquivos originais continuam no Google Drive ou Dropbox.')).toBeVisible();
 await libraryMenu(page,'Brutos','Restaurar');await page.getByRole('dialog',{name:'Restaurar'}).getByRole('button',{name:'Restaurar',exact:true}).click();
 await expect(page.getByRole('button',{name:'Brutos',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Voltar aos arquivos',exact:true}).click();await page.getByRole('button',{name:'Vídeos',exact:true}).click();
 await expect(page.getByRole('button',{name:'Brutos',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Estrutura de pastas',exact:true}).click();
 await page.getByLabel('Pastas e subpastas').fill('Entregas/Em revisão\nEntregas/Aprovados');
 await page.getByRole('button',{name:'Criar pastas',exact:true}).click();
 await page.getByRole('button',{name:'Entregas',exact:true}).click();
 await expect(page.getByRole('button',{name:'Em revisão',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Aprovados',exact:true})).toBeVisible();
 await libraryMenu(page,'Aprovados','Mover');
 const destination=page.getByRole('dialog',{name:'Mover para'});
 await expect(destination.getByRole('button',{name:'Mover para cá'})).toBeEnabled();
 await destination.getByRole('button',{name:'Mover para cá'}).click();
 await expect(page.getByRole('button',{name:'Aprovados',exact:true})).toHaveCount(0);
 await page.getByRole('navigation',{name:'Caminho da pasta'}).getByRole('button',{name:'Arquivos'}).click();
 await expect(page.getByRole('button',{name:'Aprovados',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
 await page.screenshot({path:info.outputPath('library-ready.png'),fullPage:true});
});
test('minimum-scope cover selection releases the native dialog for Google Picker and saves an authorized image',async({page,context},info)=>{
 const headers={'Access-Control-Allow-Origin':web,'Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Allow-Methods':'GET, POST, OPTIONS'};
 let png=Buffer.alloc(0),verified=false;
 await context.route(api+'/integrations/**',async route=>{
  const request=route.request(),url=new URL(request.url()),path=url.pathname;
  const json=(body:unknown)=>route.fulfill({headers,json:body});
  if(request.method()==='OPTIONS')return route.fulfill({status:204,headers});
  if(path==='/integrations/dropbox')return json({connections:[]});
  if(path==='/integrations/drive')return json({connections:[{id:connection,google_email:'qa@example.com',status:'connected',scopes:'https://www.googleapis.com/auth/drive.file'}]});
  if(path.endsWith('/picker/config'))return json({authorized:false,clientId:'synthetic-client',appId:'123',developerKey:'synthetic-key',accountId:'synthetic-account'});
  if(path.endsWith('/picker/verify')){verified=true;return json({verified:true});}
  if(path.endsWith('/picker/file')){expect(verified).toBe(true);return json({file:{id:'COVER_FILE_12345',name:'Capa autorizada.png',mimeType:'image/png',size:String(png.length)}});}
  if(path.endsWith('/cover')||path.endsWith('/preview')||path.endsWith('/thumbnail'))return route.fulfill({headers,contentType:'image/png',body:png});
  return json({});
 });
 await prepare(page,'virtual-cover-'+info.project.name+'-'+Date.now()+'@example.com');
 await context.route('https://accounts.google.com/gsi/client',route=>route.fulfill({contentType:'application/javascript',body:`window.google={accounts:{oauth2:{initTokenClient:config=>({requestAccessToken:()=>config.callback({access_token:'synthetic-google-token',scope:'openid https://www.googleapis.com/auth/drive.file',expires_in:3600})})}}};`}));
 await context.route('https://apis.google.com/js/api.js',route=>route.fulfill({contentType:'application/javascript',body:`
 window.gapi={load:(_name,config)=>config.callback()};
 class View{setIncludeFolders(){return this}setSelectFolderEnabled(){return this}setMode(){return this}setMimeTypes(){return this}}
 class Builder{addView(){return this}enableFeature(){return this}setMaxItems(){return this}setAppId(){return this}setDeveloperKey(){return this}setOAuthToken(){return this}setOrigin(){return this}setTitle(){return this}setSize(){return this}setCallback(callback){this.callback=callback;return this}build(){const callback=this.callback;let button;return {setVisible(){button=document.createElement('button');button.style.cssText='position:fixed;top:100px;left:20px;z-index:2147483647;background:white;color:black;padding:16px';button.textContent='Escolher imagem no Picker';button.onclick=()=>callback({action:'picked',docs:[{id:'COVER_FILE_12345',name:'Capa autorizada.png'}]});document.body.append(button)},dispose(){button?.remove()}}}}
 window.google.picker={DocsView:View,PickerBuilder:Builder,ViewId:{DOCS:'DOCS'},DocsViewMode:{LIST:'LIST'},Feature:{MULTISELECT_ENABLED:'MULTISELECT'}};
 `}));
 await page.goto(web+'/projetos');
 png=Buffer.from(await page.evaluate(()=>{const c=document.createElement('canvas');c.width=160;c.height=90;const ctx=c.getContext('2d')!;ctx.fillStyle='#b9c980';ctx.fillRect(0,0,160,90);return c.toDataURL('image/png').split(',')[1];}),'base64');
 await page.getByRole('button',{name:'Adicionar capa',exact:true}).click();
 await page.getByRole('button',{name:'Selecionar imagem no Google Drive',exact:true}).click();
 await expect.poll(()=>page.locator('dialog.pc-dialog').evaluate(el=>(el as HTMLDialogElement).open)).toBe(false);
 await page.getByRole('button',{name:'Escolher imagem no Picker',exact:true}).click();
 await expect(page.locator('dialog.pc-dialog')).toBeVisible();
 await expect.poll(()=>page.locator('.pc-editor-preview img').evaluate(el=>(el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
 await page.getByRole('button',{name:'Salvar capa',exact:true}).click();
 await expect(page.locator('dialog.pc-dialog')).toHaveCount(0);
 await expect(page.locator('[aria-busy]').first()).toHaveAttribute('aria-busy','false');
});
test('assisted Dropbox organization imports selected descendants and retries without duplicating its folder',async({page,context},info)=>{
 const headers={'Access-Control-Allow-Origin':web,'Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Allow-Methods':'GET, POST, OPTIONS'};
 const physical='id:PHYSICAL_FOLDER_12345',file='id:SELECTED_VIDEO_12345',virtual=crypto.randomUUID();let folderCreated=false,imported=false,structureCalls=0,importCalls=0;let rootReads=0,nestedReads=0;
 const importedParents:string[]=[];
 await context.route(api+'/**',async route=>{
  const request=route.request(),url=new URL(request.url()),path=url.pathname;
  const json=(body:unknown)=>route.fulfill({headers,json:body});
  if(request.method()==='OPTIONS')return route.fulfill({status:204,headers});
  if(path.startsWith('/account/')||path.startsWith('/access/'))return route.fallback();
  if(path==='/integrations/drive')return json({connections:[]});
  if(path==='/integrations/dropbox')return json({connections:[{id:connection,email:'qa@example.com',status:'connected',scopes:'files.content.read files.metadata.read files.content.write'}]});
  if(path.startsWith('/integrations/dropbox/')&&path.endsWith('/items')){
   const root=path.includes('root');if(root)rootReads++;else nestedReads++;
   return json({files:root?[{id:physical,name:'Originais',isFolder:true}]:[{id:file,name:'Corte.mp4',isFolder:false}],nextPageToken:null});
  }
  if(path.endsWith('/inspect')){
   const body=request.postDataJSON();return json({results:body.items.map((item:{fileId:string})=>({fileId:item.fileId,status:'ready',source:{provider:'dropbox',connectionId:connection,fileId:item.fileId,name:item.fileId===physical?'Originais':'Corte.mp4',kind:item.fileId===physical?'folder':'asset',parentIds:[],path:item.fileId===physical?'/originais':'/originais/corte.mp4'}}))});
  }
  if(path.endsWith('/structure')){structureCalls++;folderCreated=true;expect(request.postDataJSON().reuseExisting).toBe(true);return json({created:[{key:'source-folder-0',id:virtual}],completed:true});}
  if(path.endsWith('/imports')){
   importCalls++;const body=request.postDataJSON();importedParents.push(body.parentId);imported=importCalls>1;
   return json({results:[{fileId:file,status:imported?'added':'failed',code:imported?undefined:'provider_rate_limited',id:imported?crypto.randomUUID():undefined}]});
  }
  if(path.endsWith('/nodes')){
   const parent=url.searchParams.get('parent')||'root';return json({nodes:parent==='root'?(folderCreated?[{id:virtual,kind:'folder',name:'Materiais',revision:1}]:[]):imported?[{id:crypto.randomUUID(),kind:'asset',name:'Corte.mp4',mime_type:'video/mp4',provider:'dropbox',revision:1}]:[],trail:parent==='root'?[{id:'root',name:'Arquivos'}]:[{id:'root',name:'Arquivos'},{id:virtual,name:'Materiais'}],nextPage:null});
  }
  return json({});
 });
 await prepare(page,'assisted-'+info.project.name+'-'+Date.now()+'@example.com');await page.goto(web+'/biblioteca');
 await chooseLibraryProject(page);
 await libraryAdd(page,'Trazer organização do Dropbox');
 const picker=page.getByRole('dialog',{name:'Importar do Dropbox'});
 await picker.getByRole('checkbox',{name:'Selecionar pasta Originais'}).check();await picker.getByRole('button',{name:'Originais',exact:true}).click();
 await picker.getByLabel('Corte.mp4').check();
 // Returning to a previously visited Dropbox folder should reuse metadata
 // and preserve selection rather than repeat provider requests.
 await picker.getByRole('button',{name:'Meu Dropbox'}).click();
 await picker.getByRole('button',{name:'Originais',exact:true}).click();
 await expect(picker.getByLabel('Corte.mp4')).toBeChecked();
 expect(rootReads).toBe(1);expect(nestedReads).toBe(1);
 await picker.getByRole('button',{name:'Adicionar selecionados'}).click();
 const preview=page.getByRole('dialog',{name:'Revisar organização selecionada'});
 await expect(preview.getByRole('combobox',{name:'Destino de Corte.mp4'})).toContainText('Originais');
 await preview.getByRole('textbox',{name:'Nome da pasta Originais'}).fill('Materiais');
 await preview.getByRole('button',{name:'Criar estrutura e adicionar 1 arquivo(s)',exact:true}).click();
 await expect(preview.getByRole('alert')).toContainText('itens confirmados');
 await preview.getByRole('button',{name:'Repetir somente os arquivos pendentes',exact:true}).click();
 await expect(preview).toHaveCount(0);await page.getByRole('button',{name:'Materiais',exact:true}).click();
 await expect(page.getByRole('button',{name:'Corte.mp4',exact:true})).toBeVisible();
 expect(structureCalls).toBe(1);expect(importCalls).toBe(2);expect(importedParents).toEqual([virtual,virtual]);
});

test('blocked OAuth popup never reloads the library or loses the selected folder',async({page,context},info)=>{
 const headers={'Access-Control-Allow-Origin':web,'Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Allow-Methods':'GET, POST, OPTIONS'};
 let folderId='',folderAvailable=true;
 await context.route(api+'/**',async route=>{
  const request=route.request(),url=new URL(request.url()),path=url.pathname;
  const json=(body:unknown,status=200)=>route.fulfill({status,headers,json:body});
  if(request.method()==='OPTIONS')return route.fulfill({status:204,headers});
  if(path.startsWith('/access/')||path.startsWith('/account/'))return route.fallback();
  if(path==='/integrations/drive')return json({connections:[]});
  if(path==='/integrations/dropbox')return json({connections:[]});
  if(path==='/oauth/dropbox/start')return json({launchUrl:api+'/oauth/dropbox/launch'});
  if(path==='/oauth/dropbox/launch')return route.fulfill({status:302,headers:{Location:web+'/biblioteca?dropbox=connected'}});
  if(/\/library\/projects\/\d+\/nodes$/.test(path)){
   if(request.method()==='POST'){
    folderId=crypto.randomUUID();return json({id:folderId},201);
   }
   const parent=url.searchParams.get('parent')||'root';
   if(parent!=='root'&&(!folderAvailable||parent!==folderId))return json({error:{code:'library_node_unavailable'}},404);
   return json({nodes:parent==='root'&&folderId&&folderAvailable?[{id:folderId,parent_id:'root',kind:'folder',name:'Originais',revision:1}]:[],
    trail:parent==='root'?[{id:'root',name:'Arquivos'}]:[{id:'root',name:'Arquivos'},{id:folderId,name:'Originais'}],nextPage:null});
  }
  return json({error:{code:'not_found'}},404);
 });
 await prepare(page,'oauth-return-'+info.project.name+'-'+Date.now()+'@example.com');
 await page.goto(web+'/biblioteca');
 await chooseLibraryProject(page);
 await libraryAdd(page,'Nova pasta');
 await page.getByLabel('Nome',{exact:true}).fill('Originais');
 await page.getByRole('button',{name:'Confirmar',exact:true}).click();
 await page.getByRole('button',{name:'Originais',exact:true}).click();
 await expect(page.getByRole('navigation',{name:'Caminho da pasta'})).toContainText('Originais');
 // A popup blocker must not trigger a full-page redirect. The user gets an
 // explicit new-tab link; project/folder and JavaScript state survive.
 await page.evaluate(()=>{(window as unknown as {libraryMarker?:number}).libraryMarker=2026;window.open=()=>null;});
 await page.getByRole('button',{name:'Contas de armazenamento'}).click();
 await page.getByRole('button',{name:'Conectar Dropbox',exact:true}).click();
 await expect(page).toHaveURL(/\/biblioteca$/);
 await expect(page.getByRole('alert')).toContainText('bloqueou a janela de autorização');
 await expect(page.getByRole('link',{name:'Abrir autorização do Dropbox em nova aba'})).toHaveAttribute('target','_blank');
 expect(await page.evaluate(()=>(window as unknown as {libraryMarker?:number}).libraryMarker)).toBe(2026);
 await expect(page.getByRole('button',{name:'Projeto dos arquivos'})).toContainText('Projeto Biblioteca QA');
 await expect(page.getByRole('navigation',{name:'Caminho da pasta'})).toContainText('Originais');
 // A stale folder must not be trusted: server ownership and ancestor checks win.
 folderAvailable=false;
 await page.getByRole('button',{name:'Atualizar pasta'}).click();
 await expect(page.getByRole('status').filter({hasText:'A pasta anterior não está mais disponível'})).toBeVisible();
 await expect(page.getByRole('navigation',{name:'Caminho da pasta'})).toContainText('Arquivos');
});


test('account manager keeps long emails readable and makes multi-account actions direct',async({page,context},info)=>{
 const one='11111111-1111-4111-8111-111111111111',two='22222222-2222-4222-8222-222222222222',stale='33333333-3333-4333-8333-333333333333';
 const longEmail='conta.super.longa.com.muitos.projetos.compartilhados+roteiva.qa@example.com';
 const emailTwo='outra.conta@example.com',emailStale='antiga.conta@example.com';
 let googleAccounts=[
  {id:one,google_email:longEmail,status:'connected',scopes:'https://www.googleapis.com/auth/drive.file'},
  {id:two,google_email:emailTwo,status:'connected',scopes:'https://www.googleapis.com/auth/drive.file'},
  {id:stale,google_email:emailStale,status:'minimum_reconsent_required',scopes:'https://www.googleapis.com/auth/drive.readonly'}
 ];
 let disconnected=0;
 await context.route(api+'/**',async route=>{
  const req=route.request(),url=new URL(req.url()),path=url.pathname;
  const json=(value:unknown,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(value)});
  if(path.startsWith('/access/')||path.startsWith('/account/'))return route.fallback();
  if(path==='/integrations/drive')return json({connections:googleAccounts});
  if(path==='/integrations/dropbox')return json({connections:[{id:connection,email:'dropbox.qa@example.com',status:'reconnect_required',scopes:'files.content.read'}]});
  if(path==='/integrations/drive/'+one+'/disconnect'&&req.method()==='POST'){
   disconnected++;googleAccounts=googleAccounts.filter(x=>x.id!==one);return json({ok:true});
  }
  return json({error:{code:'not_found'}},404);
 });
 await prepare(page,'accounts-'+info.project.name+'-'+Date.now()+'@example.com');
 await page.goto(web+'/biblioteca');
 await page.getByRole('button',{name:'Contas de armazenamento'}).click();
 const modal=page.getByRole('dialog',{name:'Contas de armazenamento'});
 await expect(modal.getByRole('heading',{name:'Google Drive'})).toBeVisible();
 await expect(modal.getByRole('heading',{name:'Dropbox'})).toBeVisible();
 await expect(modal.getByText(longEmail,{exact:true})).toBeVisible();
 await expect(modal.getByText(emailTwo,{exact:true})).toBeVisible();
 await expect(modal.getByRole('button',{name:'Reconectar dropbox.qa@example.com'})).toBeVisible();
 await expect(modal.getByRole('button',{name:'Atualizar autorização de '+emailStale})).toBeVisible();
 await expect(modal.getByRole('button',{name:'Adicionar outra conta Google Drive'})).toBeVisible();
 await expect(modal.locator('details')).toHaveCount(0);
 await modal.getByRole('button',{name:'Usar conta '+emailTwo}).click();
 await expect(modal.locator('.vl-connected-account').filter({hasText:emailTwo}).getByText('Em uso')).toBeVisible();
 const mail=modal.getByText(longEmail,{exact:true});
 const attrs=await mail.evaluate(el=>({overflow:getComputedStyle(el).overflow,ellipsis:getComputedStyle(el).textOverflow,width:el.getBoundingClientRect().width}));
 expect(attrs.overflow).toBe('hidden');expect(attrs.ellipsis).toBe('ellipsis');expect(attrs.width).toBeGreaterThan(80);
 const dims=await modal.evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth,body:document.documentElement.scrollWidth,viewport:window.innerWidth}));
 expect(dims.scroll).toBeLessThanOrEqual(dims.width+2);
 expect(dims.body).toBeLessThanOrEqual(dims.viewport+2);
 await modal.getByRole('button',{name:'Atualizar autorização de '+emailStale}).click();
 await expect(modal.getByRole('heading',{name:'Atualizar acesso ao Google Drive'})).toBeVisible();
 await expect(page.getByRole('dialog')).toHaveCount(1);
 await modal.getByRole('button',{name:'Cancelar',exact:true}).click();
 await modal.getByRole('button',{name:'Desconectar '+longEmail}).click();
 await expect(modal.getByRole('heading',{name:'Desconectar conta?'})).toBeVisible();
 await modal.getByRole('button',{name:'Desconectar conta',exact:true}).click();
 await expect(modal.getByText(longEmail,{exact:true})).toHaveCount(0);
 expect(disconnected).toBe(1);
 await page.keyboard.press('Escape');
 await expect(modal).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Contas de armazenamento'})).toBeFocused();
});


test('additional Google and Dropbox accounts connect in popup without reloading workspace',async({page,context},info)=>{
 const existingDbx='11111111-1111-4111-8111-111111111111';
 const newDbx='22222222-2222-4222-8222-222222222222';
 const existingGoogle='33333333-3333-4333-8333-333333333333';
 const newGoogle='44444444-4444-4444-8444-444444444444';
 const google=[{id:existingGoogle,google_email:'workspace@roteiva.local',status:'connected',scopes:'https://www.googleapis.com/auth/drive.file'}];
 const dropbox=[{id:existingDbx,email:'primeiro@dropbox.local',status:'connected',scopes:'files.content.read'}];
 const json=(data:unknown,status=200)=>({status,contentType:'application/json',body:JSON.stringify(data)});
 await context.route(api+'/**',async route=>{
  const request=route.request(),url=new URL(request.url()),path=url.pathname;
  if(path.startsWith('/access/')||path.startsWith('/account/'))return route.fallback();
  if(path==='/integrations/drive')return route.fulfill(json({connections:google}));
  if(path==='/integrations/dropbox')return route.fulfill(json({connections:dropbox}));
  if(path==='/oauth/dropbox/start')return route.fulfill(json({launchUrl:api+'/oauth/dropbox/launch?ticket=dropbox'}));
  if(path==='/oauth/drive/start')return route.fulfill(json({launchUrl:api+'/oauth/drive/launch?ticket=drive'}));
  if(path==='/oauth/dropbox/launch'){
   dropbox.push({id:newDbx,email:'segundo@dropbox.local',status:'connected',scopes:'files.content.read'});
   return route.fulfill({status:302,headers:{Location:web+'/biblioteca?dropbox=connected'}});
  }
  if(path==='/oauth/drive/launch'){
   google.push({id:newGoogle,google_email:'conta.diferente@google.local',status:'connected',scopes:'https://www.googleapis.com/auth/drive.file'});
   return route.fulfill({status:302,headers:{Location:web+'/biblioteca?drive=connected'}});
  }
  return route.fulfill(json({error:{code:'not_found'}},404));
 });
 await prepare(page,'multi-oauth-'+info.project.name+'-'+Date.now()+'@example.com');
 await page.goto(web+'/biblioteca');
 await page.evaluate(()=>{(window as unknown as {roteivaStateMarker?:number}).roteivaStateMarker=1337;});
 await page.getByRole('button',{name:'Contas de armazenamento'}).click();
 const modal=page.getByRole('dialog',{name:'Contas de armazenamento'});
 await expect(modal.getByText('primeiro@dropbox.local',{exact:true})).toBeVisible();
 const dropboxPopup=page.waitForEvent('popup');
 await modal.getByRole('button',{name:'Adicionar outra conta Dropbox'}).click();
 await dropboxPopup;
 await expect(modal.getByText('segundo@dropbox.local',{exact:true})).toBeVisible();
 await expect(modal.locator('.vl-connected-account').filter({hasText:'segundo@dropbox.local'}).getByText('Em uso')).toBeVisible();
 expect(await page.evaluate(()=>(window as unknown as {roteivaStateMarker?:number}).roteivaStateMarker)).toBe(1337);
 expect(new URL(page.url()).pathname).toBe('/biblioteca');
 const googlePopup=page.waitForEvent('popup');
 await modal.getByRole('button',{name:'Adicionar outra conta Google Drive'}).click();
 await googlePopup;
 await expect(modal.getByText('conta.diferente@google.local',{exact:true})).toBeVisible();
 await expect(modal.locator('.vl-connected-account').filter({hasText:'conta.diferente@google.local'}).getByText('Em uso')).toBeVisible();
 expect(await page.evaluate(()=>(window as unknown as {roteivaStateMarker?:number}).roteivaStateMarker)).toBe(1337);
 await modal.getByRole('button',{name:'Fechar contas'}).click();
 await expect(page.getByRole('button',{name:'Contas de armazenamento'})).toBeFocused();
});

test('third-party authorization failure remains isolated; user can cancel without losing the library',async({page,context},info)=>{
 const json=(data:unknown)=>({contentType:'application/json',body:JSON.stringify(data)});
 await context.route(api+'/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path.startsWith('/access/')||path.startsWith('/account/'))return route.fallback();
  if(path==='/integrations/drive')return route.fulfill(json({connections:[{id:connection,google_email:'first@google.local',status:'connected',scopes:'https://www.googleapis.com/auth/drive.file'}]}));
  if(path==='/integrations/dropbox')return route.fulfill(json({connections:[]}));
  if(path==='/oauth/drive/start')return route.fulfill(json({launchUrl:api+'/oauth/drive/launch?ticket=blocked'}));
  if(path==='/oauth/drive/launch')return route.fulfill({status:403,contentType:'text/html',body:'<html><body><h1>403: access_denied</h1></body></html>'});
  return route.fulfill({status:404,body:'Not found'});
 });
 await prepare(page,'blocked-google-'+info.project.name+'-'+Date.now()+'@example.com');
 await page.goto(web+'/biblioteca');
 await page.evaluate(()=>{(window as unknown as {stateStillHere?:boolean}).stateStillHere=true;});
 await page.getByRole('button',{name:'Contas de armazenamento'}).click();
 const modal=page.getByRole('dialog',{name:'Contas de armazenamento'});
 const popupPromise=page.waitForEvent('popup');
 await modal.getByRole('button',{name:'Adicionar outra conta Google Drive'}).click();
 const popup=await popupPromise;
 await expect(popup.getByRole('heading',{name:'403: access_denied'})).toBeVisible();
 await expect(modal.getByText('Autorizando Google Drive…')).toBeVisible();
 expect(await page.evaluate(()=>(window as unknown as {stateStillHere?:boolean}).stateStillHere)).toBe(true);
 await modal.getByRole('button',{name:'Cancelar',exact:true}).click();
 await expect(modal.getByText('Autorizando Google Drive…')).toHaveCount(0);
 await expect.poll(()=>popup.isClosed()).toBe(true);
 await expect(modal.getByText('first@google.local',{exact:true})).toBeVisible();
 // If a provider rejects access and the user just closes its tab, the
 // workspace releases the pending state automatically without a ten-minute wait.
 const secondAttempt=page.waitForEvent('popup');
 await modal.getByRole('button',{name:'Adicionar outra conta Google Drive'}).click();
 const closedPopup=await secondAttempt;
 await expect(closedPopup.getByRole('heading',{name:'403: access_denied'})).toBeVisible();
 await closedPopup.close();
 await expect(modal.getByText('Autorizando Google Drive…')).toHaveCount(0);
 await expect(modal.getByRole('alert')).toContainText('O Google não concluiu a autorização');
 await expect(modal.getByText('first@google.local',{exact:true})).toBeVisible();
});
