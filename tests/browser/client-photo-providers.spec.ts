import {test,expect,type Page} from './fixtures';
const base='http://127.0.0.1:4173';
async function newAccount(page:Page,email:string){
 await page.goto(base);
 await page.getByRole('button',{name:'Criar conta',exact:true}).click();
 const popupPromise=page.waitForEvent('popup');
 await page.getByRole('button',{name:'Cadastrar com Google',exact:true}).click();
 const popup=await popupPromise;await popup.waitForLoadState('load');
 await popup.getByRole('button',{name:'Add new account',exact:true}).click();
 await popup.locator('#email-input').fill(email);
 await popup.locator('#display-name-input').fill('QA Clientes');
 await popup.locator('#sign-in').click();
 await page.getByLabel('Como podemos chamar você?').fill('QA Clientes');
 await page.getByLabel('Concordo com o uso dos meus dados').check();
 await page.getByRole('button',{name:'Criar meu espaço de trabalho'}).click();
 await expect(page.locator('.app-shell')).toBeVisible();
}
test('client photo selector recovers Drive discovery and shows both connected providers',async({page},info)=>{
 const driveId='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
 const dropboxId='bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
 const headers={'Access-Control-Allow-Origin':base,'Access-Control-Allow-Headers':'Authorization,Content-Type',
   'Access-Control-Allow-Methods':'GET,OPTIONS'};
 let failDriveOnce=true;
 await page.route('https://roteiva-api-dev.ewertonmendes9.workers.dev/integrations/drive**',route=>{
  const path=new URL(route.request().url()).pathname;
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
  if(path==='/integrations/drive'){
   if(failDriveOnce){failDriveOnce=false;return route.fulfill({status:429,headers,json:{error:{code:'rate_limited'}}});}
   return route.fulfill({headers,json:{connections:[{id:driveId,google_email:'drive@example.com',status:'connected',scopes:'https://www.googleapis.com/auth/drive.readonly'}]}});
  }
  // Simulate the currently deployed v1 Worker: images lack a size field,
  // and folders use the dedicated read-only endpoints.
  if(path.endsWith('/cover-images'))return route.fulfill({headers,json:{
   files:[{id:'photo_987654321',name:'Foto solta.png',mimeType:'image/png'}],nextPageToken:null}});
  if(path.endsWith('/folders'))return route.fulfill({headers,json:{
   folders:[{id:'folder_123456789',name:'Fotografias',mimeType:'application/vnd.google-apps.folder'}],nextPageToken:null}});
  if(path.endsWith('/items'))return route.fulfill({headers,json:{
   files:[{id:'photo_123456789',name:'Foto do Drive.png',mimeType:'image/png',size:'1000'}],nextPageToken:null}});
  return route.fulfill({headers,json:{}});
 });
 await page.route('https://roteiva-api-dev.ewertonmendes9.workers.dev/integrations/dropbox**',route=>{
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
  const path=new URL(route.request().url()).pathname;
  if(path==='/integrations/dropbox')return route.fulfill({headers,json:{connections:[{id:dropboxId,email:'dropbox@example.com',status:'connected',scopes:'files.metadata.read files.content.read'}]}});
  return route.fulfill({headers,json:{files:[],nextPageToken:null}});
 });
 await newAccount(page,'client-photos-'+info.project.name+'@example.com');
 await page.goto(base+'/clientes');
 await page.getByRole('button',{name:'Novo cliente',exact:true}).click();
 await page.getByLabel('Nome do cliente',{exact:true}).fill('Cliente Storage QA');
 const phone=page.getByLabel('Telefone',{exact:true});
 await phone.fill('21999999999');
 await expect(phone).toHaveValue('(21) 99999-9999');
 await page.getByRole('button',{name:'Salvar cliente'}).click();
 await expect(page.getByRole('button',{name:'Cliente Storage QA'})).toBeVisible();
 await expect(page.getByText('(21) 99999-9999')).toBeVisible();
 await page.getByRole('button',{name:'Adicionar foto',exact:true}).click();
 const dialog=page.locator('.pc-dialog');
 await expect(dialog).toBeVisible();
 await expect(dialog.getByRole('alert')).toContainText('Google Drive');
 await dialog.getByRole('button',{name:'Atualizar conexões'}).click();
 await expect(dialog.getByRole('alert')).toHaveCount(0);
 const storage=dialog.getByRole('combobox',{name:'Conta de armazenamento'});
 await storage.click();
 await expect(dialog.getByRole('option',{name:'Drive · drive@example.com'})).toBeVisible();
 await expect(dialog.getByRole('option',{name:'Dropbox · dropbox@example.com'})).toBeVisible();
 await dialog.getByRole('option',{name:'Drive · drive@example.com'}).click();
 await expect(dialog.getByText('Buscar imagens no Drive')).toBeVisible();
 await expect(dialog.getByRole('button',{name:'Foto solta.png'})).toBeVisible();
 await dialog.getByRole('button',{name:'Fotografias'}).click();
 await expect(dialog.getByRole('button',{name:'Foto do Drive.png'})).toBeVisible();
 await expect(dialog.getByRole('navigation',{name:'Pasta de imagens'})).toContainText('Fotografias');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(2);
});
