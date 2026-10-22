import {test,expect} from './fixtures';
test('sidebar unifies routes, preserves the brand colors and moves appearance into the account menu',async({page},info)=>{
 await page.goto('http://127.0.0.1:4174/');
 await expect(page.locator('.app-shell')).toBeVisible();
 await page.locator('.brand-intro').waitFor({state:'detached'});
 const sidebar=page.locator('.sidebar');
 async function openSidebar(){if(info.project.name==='mobile')await page.getByRole('button',{name:'Abrir menu',exact:true}).click();}
 await openSidebar();
 expect(await sidebar.locator('nav > button').evaluateAll(buttons=>buttons.map(button=>button.querySelector(':scope > span:last-of-type')?.textContent))).toEqual(['Visão geral','Projetos','Clientes','Aprovações','Financeiro','Calendário','Biblioteca','Configurações']);
 await expect(sidebar.getByText('FERRAMENTAS',{exact:true})).toHaveCount(0);await expect(sidebar.locator('nav').getByText('Aparência',{exact:true})).toHaveCount(0);await expect(sidebar.locator('nav').getByText('Atividades',{exact:true})).toHaveCount(0);
 const logo=sidebar.locator('.brand-lockup img');
 expect(await logo.evaluate(el=>getComputedStyle(el).filter)).toBe('none');
 await page.getByRole('button',{name:'Opções da conta',exact:true}).click();
 const menu=page.getByRole('group',{name:'Opções da conta',exact:true});await expect(menu).toBeVisible();
 const bounds=(await menu.boundingBox())!,viewport=page.viewportSize()!;expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.y).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(viewport.width);
 await page.screenshot({path:info.outputPath('sidebar-light.png')});
 await page.keyboard.press('Escape');await expect(menu).toHaveCount(0);await expect(page.getByRole('button',{name:'Opções da conta',exact:true})).toBeFocused();
 await page.getByRole('button',{name:'Opções da conta',exact:true}).click();await page.getByRole('button',{name:'Ativar modo escuro',exact:true}).click();
 await expect(page.locator('html')).toHaveAttribute('data-theme','dark');await expect(logo).toHaveAttribute('src','/roteiva-logo-white.png');expect(await logo.evaluate(el=>getComputedStyle(el).filter)).toBe('none');
 await expect(menu).toBeVisible();await expect(page.getByRole('button',{name:'Ativar modo claro',exact:true})).toBeFocused();
 await page.screenshot({path:info.outputPath('sidebar-dark.png')});
 await page.getByRole('button',{name:'Ativar modo claro',exact:true}).click();await expect(menu).toBeVisible();
 await expect(page.locator('html')).toHaveAttribute('data-theme','light');
 await sidebar.getByText('ESPAÇO DE TRABALHO',{exact:true}).click();await expect(menu).toHaveCount(0);
 if(info.project.name==='mobile')await page.getByRole('button',{name:'Fechar menu',exact:true}).first().click();
 await page.getByRole('button',{name:'Ver histórico completo'}).click();await expect(page.getByRole('dialog',{name:'Histórico de atividades'})).toBeVisible();await page.keyboard.press('Escape');
 await openSidebar();await sidebar.locator('nav').getByRole('button',{name:/^Projetos/}).click();await expect(page.getByRole('button',{name:'Ver histórico completo'})).toHaveCount(0);await expect(page.getByRole('dialog',{name:'Histórico de atividades'})).toHaveCount(0);
});

test('account menu reverses its animation safely and respects reduced motion',async({page},info)=>{
 await page.emulateMedia({reducedMotion:'no-preference'});
 await page.goto('http://127.0.0.1:4174/');
 await page.locator('.brand-intro').waitFor({state:'detached'});
 if(info.project.name==='mobile')await page.getByRole('button',{name:'Abrir menu',exact:true}).click();
 const trigger=page.getByRole('button',{name:'Opções da conta',exact:true});
 const panel=page.locator('.sidebar-account-popover');
 await trigger.click();await expect(panel).toHaveAttribute('data-state','open');
 expect(await panel.evaluate(el=>getComputedStyle(el).animationName)).toBe('account-panel-in');
 // Close and reopen during the exit without a stale animation unmounting it.
 await page.evaluate(()=>{
  const trigger=document.querySelector<HTMLButtonElement>('.sidebar-account-trigger')!;
  trigger.click();
 });
 await expect(panel).toHaveAttribute('data-state','closing');
 await expect(panel).toHaveAttribute('inert','');
 expect(await panel.evaluate(el=>getComputedStyle(el).animationName)).toBe('account-panel-out');
 await trigger.click();await expect(panel).toHaveAttribute('data-state','open');
 await page.getByRole('button',{name:'Ativar modo escuro',exact:true}).click();
 await expect(panel).toHaveAttribute('data-state','open');
 expect(await panel.evaluate(el=>getComputedStyle(el).backgroundColor)).toBe('rgb(36, 36, 38)');
 await page.keyboard.press('Escape');await expect(panel).toHaveCount(0);await expect(trigger).toBeFocused();
 await page.emulateMedia({reducedMotion:'reduce'});
 await trigger.click();await expect(panel).toBeVisible();
 expect(await panel.evaluate(el=>getComputedStyle(el).animationDuration)).toBe('0.001s');
 await page.keyboard.press('Escape');await expect(panel).toHaveCount(0);
});
