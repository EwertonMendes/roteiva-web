import {test,expect,type Page} from './fixtures';
const cloud='http://127.0.0.1:4173';

async function login(page:Page,email:string){
  await page.goto(cloud);
  await page.getByRole('button',{name:'Criar conta',exact:true}).click();
  const popupPromise=page.waitForEvent('popup');
  await page.getByRole('button',{name:'Cadastrar com Google',exact:true}).click();
  const popup=await popupPromise;
  await popup.waitForLoadState('load');
  await popup.getByRole('button',{name:'Add new account',exact:true}).click();
  await popup.locator('#email-input').fill(email);
  await popup.locator('#display-name-input').fill('Profissional de teste');
  await popup.locator('#sign-in').click();
  await page.getByLabel('Como podemos chamar você?').fill('Profissional de teste');
  await page.getByLabel('Nome do estúdio ou marca').fill('Roteiva QA');
  await page.getByLabel('Concordo com o uso dos meus dados').check();
  await page.getByRole('button',{name:'Criar meu espaço de trabalho'}).click();
  await expect(page.locator('.app-shell')).toBeVisible();
  await expect(page.locator('[aria-busy]').first()).toHaveAttribute('aria-busy','false');
}

test('money fields shift cents on desktop and mobile, paste reais, persist and edit',async({page},info)=>{
  await login(page,'money-input-'+info.project.name+'@example.com');
  if(await page.getByRole('button',{name:'Abrir menu',exact:true}).isVisible())
    await page.getByRole('button',{name:'Abrir menu',exact:true}).click();
  await page.locator('.sidebar nav').getByRole('button',{name:/^Financeiro/}).click();
  await page.getByRole('button',{name:'Nova receita',exact:true}).click();
  const amount=page.getByLabel('Valor do trabalho');
  await amount.click();
  await amount.pressSequentially('123456');
  await expect(amount).toHaveValue('1.234,56');
  await expect(amount).toHaveAttribute('inputmode','numeric');
  await amount.press('Backspace');
  await expect(amount).toHaveValue('123,45');
  await amount.press('ControlOrMeta+A');
  await amount.pressSequentially('10001');
  await expect(amount).toHaveValue('100,01');
  await page.getByLabel('Previsão de recebimento',{exact:true}).fill('2026-10-30');
  await page.locator('form.finance-modal').getByRole('button',{name:'Adicionar lançamento'}).click();
  await expect(page.locator('.finance-table')).toContainText('100,01');

  // Editing must hydrate the stored number, not reinterpret it as cent digits.
  await page.locator('.revenue-actions').first().getByRole('button',{name:/Editar receita/}).click();
  const editing=page.getByLabel('Valor do trabalho');
  await expect(editing).toHaveValue('100,01');
  await editing.evaluate((node)=>{
    const data=new DataTransfer();
    data.setData('text','R$ 1.234,56');
    node.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));
  });
  await expect(editing).toHaveValue('1.234,56');
  await page.locator('form.finance-modal').getByRole('button',{name:'Salvar alterações'}).click();
  await expect(page.locator('.finance-table')).toContainText('1.234,56');

  if(await page.getByRole('button',{name:'Abrir menu',exact:true}).isVisible())
    await page.getByRole('button',{name:'Abrir menu',exact:true}).click();
  await page.locator('.sidebar nav').getByRole('button',{name:/^Clientes/}).click();
  await page.getByRole('button',{name:'Novo cliente',exact:true}).click();
  const fee=page.getByLabel('Valor mensal combinado');
  await fee.click();
  await fee.pressSequentially('8750');
  await expect(fee).toHaveValue('87,50');
  await page.getByLabel('Nome do cliente',{exact:true}).fill('Cliente com pacote');
  await page.getByRole('button',{name:'Salvar cliente'}).click();
  await expect(page.getByText('Cliente com pacote',{exact:true}).first()).toBeVisible();
  // Reopen the client to ensure persistence and rehydration are both correct.
  await page.getByText('Cliente com pacote',{exact:true}).first().click();
  await page.getByRole('button',{name:'Editar cliente'}).click();
  await expect(page.getByLabel('Valor mensal combinado')).toHaveValue('87,50');
});
