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
  await page.getByLabel('Nova tarefa',{exact:true}).fill('Revisar áudio');
  await page.getByLabel('Nova tarefa',{exact:true}).press('Enter');
  await expect(page.getByRole('checkbox',{name:'Revisar áudio',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Remover tarefa Revisar áudio',exact:true}).click();
  await expect(page.getByRole('checkbox',{name:'Revisar áudio',exact:true})).toHaveCount(0);
  await page.getByLabel('Nome do projeto',{exact:true}).fill('Projeto atualizado');
  await chooseAppSelect(page, page.getByRole('combobox',{name:'Etapa',exact:true}), 'Ajustes');
  await page.getByRole('button',{name:'Salvar projeto',exact:true}).click();
  await page.reload();
  await expect(page.getByLabel('Nome do projeto',{exact:true})).toHaveValue('Projeto atualizado');
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
  await expect(page.locator('.calendar-event-modal input[name="projectId"]')).toHaveValue('11');
  await page.getByRole('button',{name:'Cancelar',exact:true}).click();
  await page.getByRole('button',{name:/Editar compromisso Entrega/}).click();
  await expect(page.getByRole('heading',{name:'Atualize sua agenda'})).toBeVisible();
  await page.getByRole('button',{name:'Cancelar',exact:true}).click();
  await page.getByRole('button',{name:'Abrir Biblioteca',exact:true}).click();
  await expect(page).toHaveURL(/#\/biblioteca$/);
});


