import {test,expect,type Page} from './fixtures';
import {chooseAppSelect} from './select-helpers';
const web='http://127.0.0.1:4173',api='http://127.0.0.1:8787';
const connection='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
test.skip(!process.env.VIRTUAL_LIBRARY_E2E,'Run with the dedicated virtual-library build/config.');
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
 type Node={id:string;parent_id:string|null;kind:'folder'|'asset';name:string;state:string;revision:number;asset_id?:string;provider?:string;mime_type?:string};
 const nodes:Node[]=[{id:'root',parent_id:null,kind:'folder',name:'Arquivos',state:'active',revision:1}];
 const batches:string[][]=[];let failure=true;
 const headers={'Access-Control-Allow-Origin':web,'Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Allow-Methods':'GET, POST, OPTIONS'};
 await context.route(api+'/**',async route=>{
  const req=route.request(),url=new URL(req.url()),path=url.pathname;
  const json=(body:unknown,status=200)=>route.fulfill({status,headers,json:body});
  if(req.method()==='OPTIONS')return route.fulfill({status:204,headers});
  if(path.startsWith('/access/')||path.startsWith('/account/'))return route.fallback();
  if(path==='/integrations/drive')return json({connections:[]});
  if(path==='/integrations/dropbox')return json({connections:[{id:connection,email:'qa@example.com',status:'connected',scopes:'files.metadata.read files.content.read files.content.write'}]});
  if(path.startsWith('/integrations/dropbox/')&&path.endsWith('/items'))return json({files:[{id:'id:FILE_SELECTED_A',name:'Imagem A.png',isFolder:false},{id:'id:FILE_SELECTED_B',name:'Imagem B.png',isFolder:false}],nextPageToken:null});
  if(path.endsWith('/imports')){
   const body=req.postDataJSON(),ids=body.items.map((x:{fileId:string})=>x.fileId);batches.push(ids);
   const results=ids.map((fileId:string)=>{
    if(fileId.endsWith('_B')&&failure)return {fileId,status:'failed',code:'dropbox_rate_limited'};
    const id=crypto.randomUUID();nodes.push({id,parent_id:body.parentId,kind:'asset',asset_id:id,name:fileId.endsWith('_A')?'Imagem A.png':'Imagem B.png',state:'active',revision:1,provider:'dropbox',mime_type:'image/png'});return {fileId,status:'added',id};
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
 await chooseAppSelect(page,page.getByRole('combobox',{name:'Projeto dos arquivos'}),{label:'Projeto Biblioteca QA'});
 await page.getByRole('button',{name:'Nova pasta',exact:true}).click();await page.getByLabel('Nome',{exact:true}).fill('Vídeos');await page.getByRole('button',{name:'Confirmar',exact:true}).click();
 await page.getByRole('button',{name:'Vídeos',exact:true}).click();
 await page.getByRole('button',{name:'Nova pasta',exact:true}).click();await page.getByLabel('Nome',{exact:true}).fill('Originais');await page.getByRole('button',{name:'Confirmar',exact:true}).click();
 await expect(page.getByRole('button',{name:'Originais',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Adicionar do Dropbox',exact:true}).click();
 const picker=page.getByRole('dialog',{name:'Adicionar do Dropbox'});
 await picker.getByLabel('Imagem A.png').check();await picker.getByLabel('Imagem B.png').check();await picker.getByRole('button',{name:'Adicionar selecionados'}).click();
 await expect(page.getByRole('button',{name:'Imagem A.png',exact:true})).toBeVisible();
 await expect(page.getByRole('alert').filter({hasText:'Imagem B.png'})).toBeVisible();
 await page.getByRole('button',{name:'Tentar somente os arquivos pendentes'}).click();
 await expect(page.getByRole('button',{name:'Imagem B.png',exact:true})).toBeVisible();
 expect(batches).toEqual([['id:FILE_SELECTED_A','id:FILE_SELECTED_B'],['id:FILE_SELECTED_B']]);
 await page.getByRole('button',{name:'Renomear Originais',exact:true}).click();await page.getByLabel('Nome',{exact:true}).fill('Brutos');await page.getByRole('button',{name:'Confirmar',exact:true}).click();
 await page.getByRole('button',{name:'Remover Brutos do Roteiva',exact:true}).click();await page.getByRole('button',{name:'Confirmar',exact:true}).click();
 await expect(page.getByRole('button',{name:'Brutos',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Lixeira',exact:true}).click();await page.getByRole('button',{name:'Restaurar Brutos',exact:true}).click();await page.getByRole('button',{name:'Confirmar',exact:true}).click();
 await expect(page.getByRole('button',{name:'Brutos',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Voltar aos arquivos',exact:true}).click();await page.getByRole('button',{name:'Vídeos',exact:true}).click();
 await expect(page.getByRole('button',{name:'Brutos',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Estrutura de pastas',exact:true}).click();
 await page.getByLabel('Pastas e subpastas').fill('Entregas/Em revisão\nEntregas/Aprovados');
 await page.getByRole('button',{name:'Criar pastas',exact:true}).click();
 await page.getByRole('button',{name:'Entregas',exact:true}).click();
 await expect(page.getByRole('button',{name:'Em revisão',exact:true})).toBeVisible();
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
  if(path.endsWith('/metadata')){expect(verified).toBe(true);return json({file:{id:'COVER_FILE_12345',name:'Capa autorizada.png',mimeType:'image/png',size:String(png.length)}});}
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
 expect(await page.locator('dialog.pc-dialog').evaluate(el=>(el as HTMLDialogElement).open)).toBe(false);
 await page.getByRole('button',{name:'Escolher imagem no Picker',exact:true}).click();
 await expect(page.locator('dialog.pc-dialog')).toBeVisible();
 await expect.poll(()=>page.locator('.pc-editor-preview img').evaluate(el=>(el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
 await page.getByRole('button',{name:'Salvar capa',exact:true}).click();
 await expect(page.locator('dialog.pc-dialog')).toHaveCount(0);
 await expect(page.locator('[aria-busy]').first()).toHaveAttribute('aria-busy','false');
});
