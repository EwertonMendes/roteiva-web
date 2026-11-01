import {test,expect,type Page} from './fixtures';
const site='http://127.0.0.1:4173';

async function login(page:Page,email:string){
 await page.goto(site);
 await page.getByRole('button',{name:'Criar conta',exact:true}).click();
 const wait=page.waitForEvent('popup');
 await page.getByRole('button',{name:'Cadastrar com Google',exact:true}).click();
 const popup=await wait;await popup.waitForLoadState('load');
 await popup.getByRole('button',{name:'Add new account',exact:true}).click();
 await popup.locator('#email-input').fill(email);
 await popup.locator('#display-name-input').fill('QA Roteiva');
 await popup.locator('#sign-in').click();
 await page.getByLabel('Como podemos chamar você?').fill('QA Roteiva');
 await page.getByLabel('Nome do estúdio ou marca').fill('Roteiva QA');
 await page.getByLabel('Concordo com o uso dos meus dados').check();
 await page.getByRole('button',{name:'Criar meu espaço de trabalho'}).click();
 await expect(page.locator('.app-shell')).toBeVisible();
 await expect(page.locator('[aria-busy]').first()).toHaveAttribute('aria-busy','false');
}

test('shared controls preserve forms, custom select, lime focus and modal on desktop/mobile',async({page},info)=>{
 await login(page,'shared-ui-'+info.project.name+'@example.com');
 if(await page.getByRole('button',{name:'Abrir menu',exact:true}).isVisible())
   await page.getByRole('button',{name:'Abrir menu',exact:true}).click();
 await page.locator('.sidebar nav').getByRole('button',{name:/^Clientes/}).click();
 await page.getByRole('button',{name:'Novo cliente',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Cadastre um novo cliente'});
 await expect(dialog).toBeVisible();
 await expect(dialog.locator('dialog')).toHaveCount(0);
 const name=dialog.getByLabel('Nome do cliente',{exact:true});
 const phone=dialog.getByLabel('Telefone',{exact:true});
 await expect(name).toHaveClass(/rt-input/);
 await name.fill('Cliente com componentes');
 await phone.fill('21987654321');
 await expect(phone).toHaveValue('(21) 98765-4321');
 await expect(phone).toHaveClass(/rt-input/);
 for(const theme of ['light','dark'] as const){
  await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;},theme);
  await name.focus();
  const focus=await name.evaluate(el=>{
   const style=getComputedStyle(el);
   return {color:style.borderTopColor,shadow:style.boxShadow,outline:style.outlineStyle};
  });
  expect(focus.color).toBe(theme==='dark'?'rgb(207, 255, 71)':'rgb(119, 156, 10)');
  expect(focus.shadow).not.toBe('none');
  expect(focus.outline).toBe('none');
 }
 const radio=dialog.getByRole('radio',{name:/Avulso/});
 // The native radio is visually hidden behind its selectable card; click the label.
 await dialog.getByText('Avulso',{exact:true}).click();
 await expect(radio).toBeChecked();
 await dialog.getByRole('button',{name:'Salvar cliente'}).click();
 await expect(dialog).not.toBeVisible();
 await expect(page.getByText('Cliente com componentes',{exact:true}).first()).toBeVisible();
 if(await page.getByRole('button',{name:'Abrir menu',exact:true}).isVisible())
   await page.getByRole('button',{name:'Abrir menu',exact:true}).click();
 await page.locator('.sidebar nav').getByRole('button',{name:/^Financeiro/}).click();
 const selects=page.locator('.finance-filters .rt-select-trigger');
 await expect(selects).toHaveCount(4);
 // Keyboard handling is covered by semantic-icons.spec; here verify click-after-navigation.
 await selects.nth(3).click();
 const popup=page.getByRole('listbox');
 await expect(popup).toBeVisible();
 await expect(page.getByRole('option',{name:'Recebido'})).toBeVisible();
 await selects.nth(3).press('Escape');
 await expect(popup).not.toBeVisible();
});

test('library navigation has no badge and empty financial table stays centered in both themes',async({page},info)=>{
 await login(page,'collection-layout-'+info.project.name+'@example.com');
 const opener=page.getByRole('button',{name:'Abrir menu',exact:true});
 if(await opener.isVisible())await opener.click();
 const library=page.locator('.sidebar nav').getByRole('button',{name:'Biblioteca',exact:true});
 await expect(library).toBeVisible();
 await expect(library.locator('em')).toHaveCount(0);
 await page.locator('.sidebar nav').getByRole('button',{name:/^Financeiro/}).click();
 const state=page.locator('.finance-table .rt-collection-state');
 await expect(state).toContainText('Nenhum lançamento com os filtros selecionados.');
 for(const theme of ['light','dark'] as const){
   await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;},theme);
   const bounds=await state.evaluate(node=>{
     const parent=node.parentElement!.getBoundingClientRect();
     const rect=node.getBoundingClientRect();
     const msg=node.querySelector('.rt-collection-state__message')!.getBoundingClientRect();
     return {horizontal:Math.abs(rect.x+rect.width/2-(parent.x+parent.width/2)),
       vertical:Math.abs(msg.y+msg.height/2-(rect.y+rect.height/2)),
       height:rect.height,layout:getComputedStyle(node).flexDirection};
   });
   expect(bounds.horizontal).toBeLessThan(2);
   expect(bounds.vertical).toBeLessThan(8);
   expect(bounds.height).toBeGreaterThanOrEqual(190);
   expect(bounds.layout).toBe('column');
 }
 if(await opener.isVisible())await opener.click();
 await page.locator('.sidebar nav').getByRole('button',{name:/^Biblioteca/}).click();
 if(await opener.isVisible())await opener.click();
 await expect(page.locator('.sidebar nav').getByRole('button',{name:'Biblioteca',exact:true}).locator('em')).toHaveCount(0);
});

test('access loading uses the authenticated theme before the workspace mounts',async({page},info)=>{
 await login(page,'access-palette-'+info.project.name+'@example.com');
 const key=await page.evaluate(()=>Object.keys(localStorage).find(k=>k.startsWith('roteiva-theme:')&&k!=='roteiva-theme:bootstrap'));
 expect(key).toBeTruthy();
 for(const theme of ['dark','light'] as const){
   await page.evaluate(({key,theme})=>{
     localStorage.setItem(key,JSON.stringify({theme,changedAt:Date.now()+3600000}));
     localStorage.setItem('roteiva-theme:bootstrap',theme);
   },{key:key!,theme});
   let release!:()=>void;
   const paused=new Promise<void>(resolve=>{release=resolve;});
   await page.route('https://roteiva-api-dev.ewertonmendes9.workers.dev/access/ensure',async route=>{
     await paused;
     await route.fallback();
   });
   try{
     await page.reload();
     const loading=page.getByRole('status').filter({hasText:'Confirmando seu acesso ao Roteiva…'});
     await expect(loading).toBeVisible();
     await expect(page.locator('html')).toHaveAttribute('data-theme',theme);
     const appearance=await loading.evaluate(node=>{
       const style=getComputedStyle(node),root=getComputedStyle(document.documentElement);
       return {background:style.backgroundColor,text:style.color,paper:root.getPropertyValue('--paper').trim(),
         ink:root.getPropertyValue('--ink').trim(),rootTheme:document.documentElement.dataset.theme};
     });
     expect(appearance.rootTheme).toBe(theme);
     expect(appearance.background).toBe(theme==='dark'?'rgb(16, 16, 16)':'rgb(245, 245, 245)');
     expect(appearance.text).toBe(theme==='dark'?'rgb(241, 241, 241)':'rgb(25, 25, 25)');
   }finally{
     release();
     await page.unroute('https://roteiva-api-dev.ewertonmendes9.workers.dev/access/ensure');
   }
   await expect(page.locator('.app-shell')).toBeVisible();
 }
});
