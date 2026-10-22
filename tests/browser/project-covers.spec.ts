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
 await page.emulateMedia({reducedMotion:'no-preference'});
 const connectionId='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';let activeConnectionId=connectionId;let connected=false;
 let png=Buffer.alloc(0);
 await page.route('https://roteiva-api-dev.ewertonmendes9.workers.dev/integrations/drive**',async route=>{
  const path=new URL(route.request().url()).pathname;
  const headers={'Access-Control-Allow-Origin':base,'Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Allow-Methods':'GET, OPTIONS'};
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
  if(path.endsWith('/cover'))return route.fulfill({status:200,headers,contentType:'image/png',body:png});
  if(path.endsWith('/cover-images')){const more=new URL(route.request().url()).searchParams.has('pageToken');return route.fulfill({headers,json:{files:[{id:more?'photo_987654321':'photo_123456789',name:more?'Campanha 2.png':'Campanha.png',mimeType:'image/png'}],nextPageToken:more?null:'page2'}});}
  return route.fulfill({headers,json:{connections:connected?[{id:activeConnectionId,google_email:'qa@example.com',status:'connected',scopes:'https://www.googleapis.com/auth/drive.readonly'}]:[]}});
 });
 await register(page,'cover-'+info.project.name+'@example.com');
 await expect(page.getByRole('button',{name:'Adicionar capa',exact:true})).toHaveCount(0);await expect(page.locator('.pc-photo')).toHaveCount(0);
 png=Buffer.from(await page.evaluate(()=>{const c=document.createElement('canvas');c.width=1200;c.height=800;const ctx=c.getContext('2d')!;const g=ctx.createLinearGradient(0,0,1200,800);g.addColorStop(0,'#08527d');g.addColorStop(.5,'#d88229');g.addColorStop(1,'#18182c');ctx.fillStyle=g;ctx.fillRect(0,0,1200,800);ctx.fillStyle='#ffffff30';for(let x=50;x<1200;x+=100)ctx.fillRect(x,100,20,600);return c.toDataURL('image/png').split(',')[1];}),'base64');
 connected=true;await page.reload();if(info.project.name==='desktop')await page.locator('.sidebar nav').getByRole('button',{name:'Alternar aparência',exact:true}).click();await page.getByRole('button',{name:'Adicionar capa',exact:true}).click();
 const more=page.getByRole('button',{name:'Carregar mais imagens',exact:true});
 await expect(more.locator('svg')).toHaveCount(1);
 await page.evaluate(()=>document.documentElement.setAttribute('data-roteiva-cursor','on'));
 expect(await more.evaluate(el=>getComputedStyle(el).cursor)).not.toBe('none');
 expect(await page.locator('.studio-cursor-ring').evaluate(el=>getComputedStyle(el).display)).toBe('none');
 const spacing=await page.locator('.pc-image-more').evaluate(el=>{const grid=el.previousElementSibling!.getBoundingClientRect(),row=el.getBoundingClientRect(),button=el.querySelector('button')!.getBoundingClientRect();return {gap:button.top-grid.bottom,center:Math.abs(button.x+button.width/2-(row.x+row.width/2))};});
 expect(spacing.gap).toBeGreaterThanOrEqual(20);expect(spacing.center).toBeLessThan(2);
 await more.click();await expect(page.getByRole('button',{name:'Campanha 2.png',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Campanha.png',exact:true}).click();
 await expect(page.locator('.pc-editor-preview img')).toBeVisible();
 const area=page.getByRole('group',{name:'Enquadrar capa',exact:true});const zoom=page.locator('.pc-crop-toolbar output');
 await expect(page.getByRole('slider')).toHaveCount(0);
 expect(await area.evaluate(el=>getComputedStyle(el).cursor)).toBe('grab');
 const frame=(await area.boundingBox())!;
 const cx=frame.x+frame.width*.5,cy=frame.y+frame.height*.25;
 await page.mouse.move(cx,cy);await page.mouse.wheel(0,-180);
 await expect.poll(async()=>parseInt((await zoom.textContent())!)).toBeGreaterThan(100);
 const beforeTrackpad=parseInt((await zoom.textContent())!);await page.keyboard.down('Control');await page.mouse.wheel(0,-10);await page.keyboard.up('Control');
 await expect.poll(async()=>parseInt((await zoom.textContent())!)).toBeGreaterThan(beforeTrackpad);
 const beforeDrag=await page.locator('.pc-editor-preview img').evaluate(el=>(el as HTMLImageElement).style.left);
 await page.mouse.move(cx,cy);await page.mouse.down();await page.mouse.move(cx+20,cy+15);await page.mouse.up();
 await expect.poll(()=>page.locator('.pc-editor-preview img').evaluate(el=>(el as HTMLImageElement).style.left)).not.toBe(beforeDrag);
 await area.focus();await area.press('ArrowLeft');await area.press('+');
 if(info.project.name==='mobile'){
  const client=await page.context().newCDPSession(page);
  const point=(id:number,x:number)=>({id,x,y:cy,radiusX:4,radiusY:4,force:1});
  const beforePinch=parseInt((await zoom.textContent())!);
  await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point(1,cx-25),point(2,cx+25)]});
  await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[point(1,cx-35),point(2,cx+35)]});
  await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await expect.poll(async()=>parseInt((await zoom.textContent())!)).toBeGreaterThan(beforePinch);
  expect(await page.evaluate(()=>visualViewport!.scale)).toBe(1);await client.detach();
 }
 const beforeNativeGesture=parseInt((await zoom.textContent())!);
 await area.evaluate((el,{x,y})=>{for(const [type,scale] of [['gesturestart',1],['gesturechange',1.05],['gestureend',1.05]] as const){const event=new Event(type,{bubbles:true,cancelable:true});Object.assign(event,{scale,clientX:x,clientY:y});el.dispatchEvent(event);}},{x:cx,y:cy});
 await expect.poll(async()=>parseInt((await zoom.textContent())!)).toBeGreaterThan(beforeNativeGesture);
 const savedZoom=await zoom.textContent();
 const savedPosition=await page.locator('.pc-editor-preview img').evaluate(el=>({left:(el as HTMLImageElement).style.left,top:(el as HTMLImageElement).style.top}));
 await page.screenshot({path:info.outputPath('cover-editor.png')});await page.getByRole('button',{name:'Salvar capa',exact:true}).click();await expect(page.locator('.pc-photo img')).toBeVisible();await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);await expect(page.getByText('Alteração preparada · confira a confirmação na nuvem',{exact:true})).toHaveCount(0);await page.screenshot({path:info.outputPath('projects-cover.png'),fullPage:true});
 await page.reload();await page.getByRole('button',{name:'Editar capa',exact:true}).click();await expect(zoom).toHaveText(savedZoom!);await expect(page.locator('.pc-editor-preview img')).toBeVisible();expect(await page.locator('.pc-editor-preview img').evaluate(el=>({left:(el as HTMLImageElement).style.left,top:(el as HTMLImageElement).style.top}))).toEqual(savedPosition);
 await page.getByRole('button',{name:'Redefinir enquadramento',exact:true}).click();await expect(zoom).toHaveText('100%');await page.getByRole('button',{name:'Cancelar',exact:true}).click();await page.getByRole('button',{name:'Editar capa',exact:true}).click();await expect(zoom).toHaveText(savedZoom!);
 await page.getByRole('button',{name:'Cancelar',exact:true}).click();activeConnectionId='bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';await page.reload();await expect(page.locator('.pc-photo')).toHaveCount(0);await page.getByRole('button',{name:'Editar capa',exact:true}).click();await expect(page.getByRole('heading',{name:'Escolha uma imagem',exact:true})).toBeVisible();await page.getByRole('button',{name:'Campanha.png',exact:true}).click();await expect(page.locator('.pc-editor-preview img')).toBeVisible();await page.getByRole('button',{name:'Salvar capa',exact:true}).click();await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);await page.getByRole('button',{name:'Editar capa',exact:true}).click();
 await page.getByRole('button',{name:'Remover capa',exact:true}).click();await expect(page.locator('.pc-photo')).toHaveCount(0);await expect(page.getByRole('button',{name:'Adicionar capa',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(2);
});
