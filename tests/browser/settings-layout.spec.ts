import {test,expect,type Page} from './fixtures';

const site='http://127.0.0.1:4173';

async function openSettings(page:Page,email:string){
  await page.goto(site);
  await page.getByRole('button',{name:'Criar conta',exact:true}).click();
  const popupEvent=page.waitForEvent('popup');
  await page.getByRole('button',{name:'Cadastrar com Google',exact:true}).click();
  const popup=await popupEvent;
  await popup.waitForLoadState('load');
  await popup.getByRole('button',{name:'Add new account',exact:true}).click();
  await popup.locator('#email-input').fill(email);
  await popup.locator('#display-name-input').fill('QA Configurações');
  await popup.locator('#sign-in').click();
  await page.getByLabel('Como podemos chamar você?').fill('QA Configurações');
  await page.getByLabel('Nome do estúdio ou marca').fill('Estúdio QA');
  await page.getByLabel('Concordo com o uso dos meus dados').check();
  await page.getByRole('button',{name:'Criar meu espaço de trabalho'}).click();
  await expect(page.locator('.app-shell')).toBeVisible();
  await expect(page.locator('[aria-busy]').first()).toHaveAttribute('aria-busy','false');
  await navigateSettings(page);
}

async function navigateSettings(page:Page){
  const open=page.getByRole('button',{name:'Abrir menu',exact:true});
  if(await open.isVisible())await open.click();
  await page.locator('.sidebar nav').getByRole('button',{name:/^Configurações/}).click();
  await expect(page.getByRole('heading',{name:'Configurações',exact:true})).toBeVisible();
}

test('mockup settings keeps separate sections, responsive geometry and verified access',async({page},info)=>{
  await openSettings(page,'settings-layout-'+info.project.name+'@example.com');
  // Catch fixed-width layouts that leave a large empty gutter on wide monitors.
  if(info.project.name==='desktop')await page.setViewportSize({width:1728,height:960});
  for(const section of ['.settings-identity','.settings-profile','.settings-studio','.settings-preferences','.access-settings','.settings-danger-zone']){
    await expect(page.locator(section)).toBeVisible();
  }
  await expect(page.getByRole('heading',{name:'Perfil profissional'})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Meu estúdio'})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Aparência do Roteiva'})).toBeVisible();
  await expect(page.locator('.settings-profile-summary')).toContainText('settings-layout-'+info.project.name+'@example.com');
  await expect(page.locator('.access-settings-detail')).toContainText('Disponível até');
  await expect(page.getByRole('textbox',{name:'E-mail de acesso'})).toHaveAttribute('readonly');
  const geometry=await page.evaluate(()=>{
    const panel=document.querySelector('.settings-studio-controls')!.getBoundingClientRect();
    const pageElement=document.querySelector('.page')!;
    const pageRect=pageElement.getBoundingClientRect();
    const contentRight=pageRect.right-parseFloat(getComputedStyle(pageElement).paddingRight);
    const cards=[...document.querySelectorAll('.settings-layout > .settings-identity, .settings-layout > .settings-editor, .settings-details > .settings-editor')].map(e=>e.getBoundingClientRect());
    const layout=document.querySelector('.settings-layout')!.getBoundingClientRect();
    const fields=[...document.querySelectorAll('.settings-studio-controls .settings-field')].map(e=>e.getBoundingClientRect());
    const action=document.querySelector('.settings-save-button')!.getBoundingClientRect();
    return {viewport:window.innerWidth,document:document.documentElement.scrollWidth,panelRight:panel.right,
      contentRight,layoutLeft:layout.left,layoutRight:layout.right,
      cardWidths:cards.map(r=>r.width),cardRights:cards.map(r=>r.right),
      items:fields.map(r=>({top:r.top,right:r.right})),button:{top:action.top,right:action.right}};
  });
  expect(geometry.document).toBeLessThanOrEqual(geometry.viewport+2);
  // Every card must use the full workspace content area and line up exactly.
  expect(Math.abs(geometry.contentRight-geometry.layoutRight)).toBeLessThan(4);
  for(const right of geometry.cardRights)expect(Math.abs(right-geometry.layoutRight)).toBeLessThan(4);
  expect(Math.max(...geometry.cardWidths)-Math.min(...geometry.cardWidths)).toBeLessThan(4);
  expect(geometry.button.right).toBeLessThanOrEqual(geometry.panelRight+2);
  if(info.project.name==='mobile'){
    expect(geometry.items[1].top).toBeGreaterThan(geometry.items[0].top);
    expect(geometry.button.top).toBeGreaterThan(geometry.items[1].top);
  }else{
    expect(Math.abs(geometry.items[0].top-geometry.items[1].top)).toBeLessThan(3);
    expect(geometry.button.top).toBeGreaterThan(geometry.items[0].top);
    // With the fixed desktop sidebar, the studio form must reflow on medium screens.
    await page.setViewportSize({width:1100,height:820});
    const medium=await page.evaluate(()=>{
      const fields=[...document.querySelectorAll('.settings-studio-controls .settings-field')].map(e=>e.getBoundingClientRect());
      const action=document.querySelector('.settings-save-button')!.getBoundingClientRect();
      const pageElement=document.querySelector('.page')!;
      return {firstTop:fields[0].top,secondTop:fields[1].top,actionTop:action.top,
        scrollWidth:document.documentElement.scrollWidth,viewport:innerWidth,
        gap:pageElement.getBoundingClientRect().right-parseFloat(getComputedStyle(pageElement).paddingRight)-
          document.querySelector('.settings-layout')!.getBoundingClientRect().right};
    });
    expect(medium.actionTop).toBeGreaterThan(medium.secondTop);
    expect(Math.abs(medium.firstTop-medium.secondTop)).toBeLessThan(3);
    expect(medium.gap).toBeLessThan(4);
    expect(medium.scrollWidth).toBeLessThanOrEqual(medium.viewport+2);
  }
});

test('settings save, theme, deletion confirmation and account safety work on desktop/mobile',async({page},info)=>{
  await openSettings(page,'settings-actions-'+info.project.name+'@example.com');
  const save=page.getByRole('button',{name:/Salvar alterações/});
  await expect(save).toBeDisabled();
  await page.getByRole('textbox',{name:'Nome profissional'}).fill('Profissional QA');
  await page.getByRole('textbox',{name:'Nome do estúdio ou marca'}).fill('Produtora QA');
  await page.locator('.settings-studio .rt-select-trigger').click();
  await page.getByRole('option',{name:'Produtora',exact:true}).click();
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.locator('.settings-feedback-success')).toContainText('atualizados com sucesso');
  await expect(page.locator('.settings-identity h2')).toHaveText('Produtora QA');
  await expect(save).toBeDisabled();
  await page.getByRole('button',{name:'Escuro',exact:true}).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await expect(page.getByRole('button',{name:'Escuro',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'Claro',exact:true}).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  const deleteButton=page.locator('.settings-danger-zone').getByRole('button',{name:'Excluir conta'});
  await expect(deleteButton).toBeEnabled();
  await deleteButton.click();
  const dialog=page.getByRole('dialog',{name:'Excluir sua conta?'});
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Os arquivos originais do seu Google Drive não serão apagados.');
  await expect(dialog.getByRole('button',{name:'Excluir definitivamente'})).toBeDisabled();
  await dialog.getByRole('button',{name:'Cancelar'}).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('textbox',{name:'Nome profissional'})).toHaveValue('Profissional QA');
});
