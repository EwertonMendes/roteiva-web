import { chooseAppSelect } from "./select-helpers";
import {test,expect} from '@playwright/test';

const base=process.env.PROJECT_DETAIL_TEST_URL||'http://127.0.0.1:4174';
test('project detail: tasks, drafts, finance, agenda, materials and responsive themes',async({page},info)=>{
  await page.addInitScript(()=>{
    if(localStorage.getItem('pd-seeded'))return;
    localStorage.setItem('pd-seeded','true');
    localStorage.setItem('roteiva-theme','dark');
    localStorage.setItem('roteiva-pages-demo-workspace-v1',JSON.stringify({
      projects:[{id:11,name:'Filme institucional',clientId:21,client:'Cliente de exemplo',status:'Em produção',dueDate:'2026-11-17',due:'17 nov',progress:20,files:0,color:'blue',initials:'CL',description:'Primeira versão do filme.',tasks:[{id:31,title:'Conferir equipamentos',done:true},{id:32,title:'Captar evento',done:false},{id:33,title:'Fazer backup',done:false},{id:34,title:'Editar highlights',done:false},{id:35,title:'Aprovar e entregar',done:false}]}],
      clients:[{id:21,name:'Cliente de exemplo',contact:'Contato',color:'blue',initials:'CL',type:'Avulso',since:'2026',projects:1,active:1}],
      financeEntries:[{id:41,projectId:11,clientId:21,project:'Receita do projeto',client:'Cliente de exemplo',amount:300,kind:'income',status:'A receber',date:'17/11/2026'},{id:42,projectId:11,project:'Transporte',client:'Cliente de exemplo',amount:50,kind:'expense',status:'Recebido',date:'17/11/2026'}],
      calendarEvents:[{id:51,projectId:11,title:'Entrega — Filme institucional',date:'2026-11-17',time:'18:00',type:'Entrega',client:'Cliente de exemplo',autoDeadline:true}],libraryAssets:[],comments:[],reviewState:'pending',activities:[]
    }));
  });
  await page.goto(base+'/#/projetos/11');
  const detail=page.locator('.project-detail');
  await expect(detail).toBeVisible();
  await expect(detail.getByRole('progressbar')).toHaveAttribute('value','20');
  await expect(detail.locator('.pd-totals')).toContainText('250,00');
  await page.evaluate(()=>document.fonts.ready);
  for(const theme of ['dark','light']){
    await page.evaluate(theme=>document.documentElement.setAttribute('data-theme',theme),theme);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    const checkbox=await detail.locator('.pd-check').first().boundingBox();
    expect(checkbox!.height).toBeLessThanOrEqual(28);
    const task=await detail.locator('.pd-task').first().boundingBox();
    expect(task!.height).toBeLessThan(80);
    await page.screenshot({path:info.outputPath(`project-detail-${theme}.png`),fullPage:true});
  }
  await page.getByRole('textbox',{name:'Briefing',exact:true}).fill('Rascunho preservado durante o checklist.');
  await detail.locator('.pd-task label').filter({hasText:'Captar evento'}).click();
  await expect(detail.getByRole('progressbar')).toHaveAttribute('value','40');
  await expect(page.getByRole('textbox',{name:'Briefing',exact:true})).toHaveValue('Rascunho preservado durante o checklist.');
  const taskList=detail.locator('.pd-tasks');
  const drag=page.getByRole('button',{name:/Reordenar tarefa Captar evento/});
  await drag.focus();
  await drag.press('ArrowUp');
  await expect(taskList.locator('.pd-task').first()).toContainText('Captar evento');
  // Pointer movement uses the same accessible handle on desktop and touch devices.
  if((page.viewportSize()?.width||0)>800){
    const from=await drag.boundingBox();
    const to=await taskList.locator('.pd-task').filter({hasText:'Conferir equipamentos'}).boundingBox();
    expect(from&&to).toBeTruthy();
    await page.mouse.move(from!.x+from!.width/2,from!.y+from!.height/2);
    await page.mouse.down();
    await page.mouse.move(to!.x+to!.width/2,to!.y+to!.height/2,{steps:6});
    await page.mouse.up();
    await expect(taskList.locator('.pd-task').first()).toContainText('Conferir equipamentos');
    const boxes=await Promise.all([detail.locator('.pd-checklist').boundingBox(),detail.locator('.pd-finance').boundingBox()]);
    expect(Math.abs(boxes[0]!.height-boxes[1]!.height)).toBeLessThanOrEqual(2);
  }
  await page.getByLabel('Nova tarefa',{exact:true}).fill('Revisar áudio');
  await page.getByLabel('Nova tarefa',{exact:true}).press('Enter');
  await expect(page.getByRole('checkbox',{name:'Revisar áudio',exact:true})).toBeVisible();
  await expect(page.getByLabel('Nova tarefa',{exact:true})).toBeFocused();
  await page.waitForTimeout(100);
  await expect(page.getByLabel('Nova tarefa',{exact:true})).toBeFocused();
  await page.getByLabel('Nova tarefa',{exact:true}).fill('Tarefa adicional');
  await page.getByRole('button',{name:'Adicionar tarefa',exact:true}).click();
  await expect(page.getByLabel('Nova tarefa',{exact:true})).toBeFocused();
  await page.waitForTimeout(100);
  await expect(page.getByLabel('Nova tarefa',{exact:true})).toBeFocused();
  await expect(taskList.locator('.pd-task')).toHaveCount(7);
  expect(await taskList.evaluate(element=>element.scrollHeight>element.clientHeight)).toBe(true);
  await expect.poll(()=>taskList.evaluate(element=>Math.abs(element.scrollHeight-element.clientHeight-element.scrollTop))).toBeLessThanOrEqual(2);
  if((page.viewportSize()?.width||0)>800){
    const boxes=await Promise.all([detail.locator('.pd-checklist').boundingBox(),detail.locator('.pd-finance').boundingBox()]);
    expect(Math.abs(boxes[0]!.height-boxes[1]!.height)).toBeLessThanOrEqual(2);
  }
  await page.getByRole('button',{name:'Remover tarefa Tarefa adicional',exact:true}).click();
  await page.getByRole('button',{name:'Remover tarefa Revisar áudio',exact:true}).click();
  await expect(page.getByRole('checkbox',{name:'Revisar áudio',exact:true})).toHaveCount(0);
  // The shared Roteiva calendar picker replaces the browser-native date input.
  const due=page.getByRole('textbox',{name:'Prazo do projeto'});
  await expect(due).toHaveValue('17/11/2026');
  await detail.getByRole('button',{name:'Abrir calendário de data'}).click();
  await expect(detail.getByRole('dialog',{name:'Escolher data'})).toBeVisible();
  await detail.getByRole('dialog',{name:'Escolher data'}).getByRole('button',{name:'Fechar'}).click();
  await due.fill('31/02/2028');
  await detail.getByRole('button',{name:'Salvar projeto'}).click();
  await expect(detail.getByRole('alert')).toContainText('Corrija a data do prazo');
  await due.fill('22/02/2222');
  await detail.getByRole('button',{name:'Salvar projeto'}).click();
  await expect(detail.getByRole('alert')).toContainText('Corrija a data do prazo');
  await due.fill('22/02/2028');
  await expect(detail.getByRole('alert')).toHaveCount(0);
  await page.getByLabel('Nome do projeto',{exact:true}).fill('Projeto atualizado');
  const stage=page.getByRole('combobox',{name:'Etapa',exact:true});
  await stage.click();
  await expect(page.locator('.rt-select-menu .rt-select-leading svg')).toHaveCount(4);
  await stage.press('Escape');
  await chooseAppSelect(page, stage, 'Ajustes');
  await expect(stage.locator('.rt-select-leading svg')).toHaveCount(1);
  await page.getByRole('button',{name:'Salvar projeto',exact:true}).click();
  await page.reload();
  await expect(page.getByLabel('Nome do projeto',{exact:true})).toHaveValue('Projeto atualizado');
  await expect(page.getByRole('textbox',{name:'Prazo do projeto'})).toHaveValue('22/02/2028');
  await expect(page.getByRole('textbox',{name:'Briefing',exact:true})).toHaveValue('Rascunho preservado durante o checklist.');
  await expect(page.getByRole('combobox',{name:'Etapa',exact:true})).toContainText('Ajustes');
  await page.getByRole('button',{name:'Editar lançamento Transporte',exact:true}).click();
  await page.getByLabel('Valor do trabalho').fill('75,00');
  await page.getByRole('button',{name:'Salvar alterações',exact:true}).click();
  await expect(detail.locator('.pd-totals')).toContainText('225,00');
  await page.getByRole('button',{name:'Receita ou custo',exact:true}).click();
  await expect(page.locator('.finance-modal input[name="projectId"]')).toHaveValue('11');
  await page.getByRole('button',{name:'Cancelar',exact:true}).click();
  await page.getByRole('button',{name:'Agendar',exact:true}).click();
  const eventDialog=page.locator('dialog.roteiva-calendar-form');
  await expect(eventDialog).toBeVisible();
  await expect(eventDialog.getByRole('combobox',{name:'Projeto do compromisso'})).toContainText('Projeto atualizado');
  await eventDialog.getByRole('button',{name:'Cancelar',exact:true}).click();
  await page.getByRole('button',{name:/Editar compromisso Entrega/}).click();
  await expect(eventDialog.getByRole('heading',{name:'Editar compromisso'})).toBeVisible();
  await eventDialog.getByRole('button',{name:'Cancelar',exact:true}).click();
  await page.getByRole('button',{name:'Abrir Biblioteca',exact:true}).click();
  await expect(page).toHaveURL(/#\/biblioteca$/);
});


