import {test,expect,type Page} from './fixtures';
const base='http://127.0.0.1:4173';
async function register(page:Page,email:string){
 await page.goto(base);await page.getByRole('button',{name:'Criar conta',exact:true}).click();
 const popupPromise=page.waitForEvent('popup');await page.getByRole('button',{name:'Cadastrar com Google',exact:true}).click();const popup=await popupPromise;await popup.waitForLoadState('load');
 await popup.getByRole('button',{name:'Add new account',exact:true}).click();await popup.locator('#email-input').fill(email);await popup.locator('#display-name-input').fill('QA Capas');await popup.locator('#sign-in').click();
 await page.getByLabel('Como podemos chamar você?').fill('QA Capas');await page.getByLabel('Concordo com o uso dos meus dados').check();await page.getByRole('button',{name:'Criar meu espaço de trabalho'}).click();await expect(page.locator('.app-shell')).toBeVisible();
 await page.goto(base+'/projetos');await expect(page.getByRole('heading',{name:'Projetos',exact:true})).toBeVisible();
 await page.locator('.heading-actions').getByRole('button',{name:'Criar projeto',exact:true}).click();await page.getByLabel('Nome do projeto',{exact:true}).fill('Campanha com capa');await page.locator('form.project-modal').getByRole('button',{name:'Criar projeto',exact:true}).click();await expect(page.locator('form.project-modal')).toHaveCount(0);await expect(page.locator('[aria-busy]').first()).toHaveAttribute('aria-busy','false');await page.goto(base+'/projetos');await expect(page.locator('.pc-card')).toHaveCount(1);
}
test('project covers require Drive, persist crop, cancel safely and support removal',async({page},info)=>{
 const connectionId='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';let activeConnectionId=connectionId;let connected=false;
 let png=Buffer.alloc(0);
 await page.route('https://roteiva-api-dev.ewertonmendes9.workers.dev/integrations/drive**',async route=>{
  const path=new URL(route.request().url()).pathname;
  const headers={'Access-Control-Allow-Origin':base,'Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Allow-Methods':'GET, OPTIONS'};
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
  if(path.endsWith('/cover'))return route.fulfill({status:200,headers,contentType:'image/png',body:png});
  if(path.endsWith('/cover-images'))return route.fulfill({headers,json:{files:[{id:'photo_123456789',name:'Campanha.png',mimeType:'image/png'}],nextPageToken:null}});
  return route.fulfill({headers,json:{connections:connected?[{id:activeConnectionId,google_email:'qa@example.com',status:'connected',scopes:'https://www.googleapis.com/auth/drive.readonly'}]:[]}});
 });
 await register(page,'cover-'+info.project.name+'@example.com');
 await expect(page.getByRole('button',{name:'Adicionar capa',exact:true})).toHaveCount(0);await expect(page.locator('.pc-photo')).toHaveCount(0);
 png=Buffer.from(await page.evaluate(()=>{const c=document.createElement('canvas');c.width=1200;c.height=800;const ctx=c.getContext('2d')!;const g=ctx.createLinearGradient(0,0,1200,800);g.addColorStop(0,'#08527d');g.addColorStop(.5,'#d88229');g.addColorStop(1,'#18182c');ctx.fillStyle=g;ctx.fillRect(0,0,1200,800);ctx.fillStyle='#ffffff30';for(let x=50;x<1200;x+=100)ctx.fillRect(x,100,20,600);return c.toDataURL('image/png').split(',')[1];}),'base64');
 connected=true;await page.reload();if(info.project.name==='desktop')await page.locator('.sidebar nav').getByRole('button',{name:'Alternar aparência',exact:true}).click();await page.getByRole('button',{name:'Adicionar capa',exact:true}).click();
 await page.getByRole('button',{name:'Campanha.png',exact:true}).click();
 await expect(page.locator('.pc-editor-preview img')).toBeVisible();
 const zoom=page.getByRole('slider',{name:'Zoom'});await zoom.focus();await zoom.press('ArrowRight');await expect(zoom).not.toHaveValue('1');await zoom.fill('1.5');await page.getByRole('slider',{name:'Posição horizontal'}).fill('25');await page.getByRole('slider',{name:'Posição vertical'}).fill('75');
 const frame=await page.locator('.pc-editor-preview .pc-cover-frame').boundingBox();expect(frame).not.toBeNull();
 await page.mouse.move(frame!.x+frame!.width/2,frame!.y+frame!.height/2);await page.mouse.down();await page.mouse.move(frame!.x+frame!.width/2+20,frame!.y+frame!.height/2+15);await page.mouse.up();
 await expect(page.getByRole('slider',{name:'Posição horizontal'})).not.toHaveValue('25');await page.getByRole('slider',{name:'Posição horizontal'}).fill('25');await page.getByRole('slider',{name:'Posição vertical'}).fill('75');
 await page.screenshot({path:info.outputPath('cover-editor.png')});await page.getByRole('button',{name:'Salvar capa',exact:true}).click();await expect(page.locator('.pc-photo img')).toBeVisible();await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);await expect(page.getByText('Alteração preparada · confira a confirmação na nuvem',{exact:true})).toHaveCount(0);await page.screenshot({path:info.outputPath('projects-cover.png'),fullPage:true});
 await page.reload();await page.getByRole('button',{name:'Editar capa',exact:true}).click();await expect(zoom).toHaveValue('1.5');await expect(page.getByRole('slider',{name:'Posição horizontal'})).toHaveValue('25');await expect(page.getByRole('slider',{name:'Posição vertical'})).toHaveValue('75');
 await zoom.fill('2');await page.getByRole('button',{name:'Cancelar',exact:true}).click();await page.getByRole('button',{name:'Editar capa',exact:true}).click();await expect(zoom).toHaveValue('1.5');
 await page.getByRole('button',{name:'Cancelar',exact:true}).click();activeConnectionId='bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';await page.reload();await expect(page.locator('.pc-photo')).toHaveCount(0);await page.getByRole('button',{name:'Editar capa',exact:true}).click();await expect(page.getByRole('heading',{name:'Escolha uma imagem',exact:true})).toBeVisible();await page.getByRole('button',{name:'Campanha.png',exact:true}).click();await expect(page.locator('.pc-editor-preview img')).toBeVisible();await page.getByRole('button',{name:'Salvar capa',exact:true}).click();await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);await page.getByRole('button',{name:'Editar capa',exact:true}).click();
 await page.getByRole('button',{name:'Remover capa',exact:true}).click();await expect(page.locator('.pc-photo')).toHaveCount(0);await expect(page.getByRole('button',{name:'Adicionar capa',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(2);
});
