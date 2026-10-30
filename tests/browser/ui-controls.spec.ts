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
 await radio.check();
 await expect(radio).toBeChecked();
 await dialog.getByRole('button',{name:'Salvar cliente'}).click();
 await expect(dialog).not.toBeVisible();
 await expect(page.getByText('Cliente com componentes',{exact:true}).first()).toBeVisible();
 if(await page.getByRole('button',{name:'Abrir menu',exact:true}).isVisible())
   await page.getByRole('button',{name:'Abrir menu',exact:true}).click();
 await page.locator('.sidebar nav').getByRole('button',{name:/^Financeiro/}).click();
 const selects=page.locator('.finance-filters .rt-select-trigger');
 await expect(selects).toHaveCount(4);
 await selects.nth(3).press('Enter');
 const popup=page.getByRole('listbox');
 await expect(popup).toBeVisible();
 await expect(page.getByRole('option',{name:'Recebido'})).toBeVisible();
 await selects.nth(3).press('Escape');
 await expect(popup).not.toBeVisible();
});
