import {initializeTestEnvironment} from '@firebase/rules-unit-testing';
import {doc,deleteDoc,getDoc,updateDoc,Timestamp} from 'firebase/firestore';
import {test,expect,type Page} from './fixtures';

const site='http://127.0.0.1:4173';
type Job={id:number;name:string;uid:string;phase:'processing'|'completed';release:boolean;removed:boolean};
async function login(page:Page,email:string){
  await page.goto(site);
  await page.getByRole('button',{name:'Criar conta',exact:true}).click();
  const popupPromise=page.waitForEvent('popup');
  await page.getByRole('button',{name:'Cadastrar com Google'}).click();
  const popup=await popupPromise;
  await popup.waitForLoadState('load');
  await popup.getByRole('button',{name:'Add new account'}).click();
  await popup.locator('#email-input').fill(email);
  await popup.locator('#display-name-input').fill('Projeto Background QA');
  await popup.locator('#sign-in').click();
  await page.getByLabel('Como podemos chamar você?').fill('Projeto Background QA');
  await page.getByLabel('Concordo com o uso dos meus dados').check();
  await page.getByRole('button',{name:'Criar meu espaço de trabalho'}).click();
  await expect(page.locator('.app-shell')).toBeVisible();
  await expect(page.locator('[aria-busy]').first()).toHaveAttribute('aria-busy','false');
}
async function navigate(page:Page,name:string){
  const open=page.getByRole('button',{name:'Abrir menu',exact:true});
  if(await open.isVisible())await open.click();
  await page.locator('.sidebar nav').getByRole('button',{name:new RegExp('^'+name)}).click();
}
async function makeProject(page:Page,name:string):Promise<number>{
  await navigate(page,'Projetos');
  await page.locator('.heading-actions').getByRole('button',{name:'Criar projeto',exact:true}).click();
  await page.getByLabel('Nome do projeto',{exact:true}).fill(name);
  await page.locator('form.project-modal').getByRole('button',{name:'Criar projeto',exact:true}).click();
  await expect(page.getByRole('heading',{name,exact:true})).toBeVisible();
  await expect(page.locator('[aria-busy]').first()).toHaveAttribute('aria-busy','false');
  const match=/\/projetos\/([0-9]+)$/.exec(new URL(page.url()).pathname);
  if(!match)throw Error('Project detail did not open: '+page.url());
  return Number(match[1]);
}
async function confirm(page:Page,name:string){
  await page.getByRole('button',{name:'Excluir projeto'}).click();
  const dialog=page.getByRole('dialog',{name:'Excluir este projeto?'});
  await dialog.getByRole('textbox',{name:'Digite o nome exato do projeto para confirmar'}).fill(name);
  await dialog.getByRole('checkbox',{name:/Entendo que a exclusão/}).check();
  await dialog.getByRole('button',{name:'Excluir definitivamente'}).click();
  await expect(dialog).toHaveCount(0);
}
async function mockWorker(page:Page){
  const emulator=await initializeTestEnvironment({projectId:'demo-roteiva',firestore:{host:'127.0.0.1',port:8080}});
  const jobs=new Map<number,Job>(),gets=new Map<number,number>();
  const headers={'Access-Control-Allow-Origin':site,'Access-Control-Allow-Methods':'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers':'Authorization, Content-Type'};
  async function remove(job:Job){
    if(job.removed)return;
    // A realistic simulated Worker deletes Firestore documents and advances
    // counters BEFORE it reports completion; no production service is called.
    await emulator.withSecurityRulesDisabled(async ctx=>{
      const db=ctx.firestore();
      const project=doc(db,'users',job.uid,'projects',String(job.id));
      const sync=doc(db,'users',job.uid,'sync','state');
      const before=(await getDoc(sync)).data();
      if(!before)throw Error('Missing emulator sync state');
      await deleteDoc(project);
      await updateDoc(sync,{revision:before.revision+1,
        'domains.projects':before.domains.projects+1,
        'counts.projects':Math.max(0,before.counts.projects-1),updatedAt:Timestamp.now()});
    });
    job.removed=true;job.phase='completed';
  }
  await page.route(/^http:\/\/127\.0\.0\.1:8787\/projects\/[1-9][0-9]*\/deletion$/,async route=>{
    const method=route.request().method();
    if(method==='OPTIONS')return route.fulfill({status:204,headers});
    const id=Number(/\/projects\/([0-9]+)\/deletion$/.exec(route.request().url())?.[1]);
    if(!Number.isSafeInteger(id))throw Error('Unexpected project ID');
    if(method==='POST'){
      const data=route.request().postDataJSON() as {name:string;acknowledged:boolean};
      expect(data.acknowledged).toBe(true);
      const auth=route.request().headers().authorization||'';
      const uid=JSON.parse(Buffer.from(auth.slice(7).split('.')[1],'base64url').toString()).sub as string;
      jobs.set(id,{id,name:data.name,uid,phase:'processing',release:false,removed:false});
      return route.fulfill({status:202,headers,contentType:'application/json',
        body:JSON.stringify({status:'processing',phase:'reviews',operationId:'op-'+id})});
    }
    gets.set(id,(gets.get(id)||0)+1);
    const job=jobs.get(id);
    if(job?.release&&job.phase==='processing')await remove(job);
    return route.fulfill({status:200,headers,contentType:'application/json',
      body:JSON.stringify(job?{status:job.phase,phase:job.phase==='processing'?'reviews':'completed',operationId:'op-'+id}:{status:'idle'})});
  });
  return {jobs,gets,dispose:()=>emulator.cleanup()};
}

test('idle detail makes one status request; deleting continues on Financeiro and toasts globally without redirect',async({page},info)=>{
  const worker=await mockWorker(page);
  try{
    await login(page,'delete-in-background-'+info.project.name+'@example.com');
    const name='Projeto não bloqueante';
    const id=await makeProject(page,name);
    await expect.poll(()=>worker.gets.get(id)||0).toBe(1);
    await page.waitForTimeout(5600);
    expect(worker.gets.get(id)).toBe(1);
    await page.getByRole('button',{name:'Excluir projeto'}).click();
    await page.waitForTimeout(2600);
    expect(worker.gets.get(id)).toBe(1);
    await page.getByRole('dialog',{name:'Excluir este projeto?'}).getByRole('button',{name:'Cancelar'}).click();
    await confirm(page,name);
    expect(worker.jobs.get(id)?.phase).toBe('processing');
    await navigate(page,'Financeiro');
    await expect(page.getByRole('heading',{name:'Gestão financeira',exact:true})).toBeVisible();
    worker.jobs.get(id)!.release=true;
    const toast=page.locator('.rt-toast--success');
    await expect(toast.locator('.rt-toast-message strong')).toHaveText(name);
    await expect(toast).toContainText('foi excluído com sucesso.');
    await expect(page.getByRole('heading',{name:'Gestão financeira',exact:true})).toBeVisible();
    expect(page.url()).toContain('/financeiro');
    await navigate(page,'Projetos');
    await expect(page.getByText(name,{exact:true})).toHaveCount(0);
    await expect(page.getByRole('heading',{name:'Projetos',exact:true})).toBeVisible();
  }finally{await worker.dispose();}
});

test('pending deletion remains visible on return to detail, and only its own detail redirects on completion',async({page},info)=>{
  const worker=await mockWorker(page);
  try{
    await login(page,'delete-return-detail-'+info.project.name+'@example.com');
    const name='Projeto em exclusão';
    const id=await makeProject(page,name);
    await confirm(page,name);
    await navigate(page,'Clientes');
    await expect(page.getByRole('heading',{name:'Clientes',exact:true})).toBeVisible();
    await navigate(page,'Projetos');
    // The project still exists in Firestore until the simulated Worker finishes.
    await page.getByText(name,{exact:true}).click();
    await expect(page.getByText('Exclusão em andamento.',{exact:false})).toBeVisible();
    await expect(page.getByRole('button',{name:'Excluir projeto'})).toBeDisabled();
    worker.jobs.get(id)!.release=true;
    await expect(page).toHaveURL(new RegExp('/projetos$'));
    await expect(page.locator('.rt-toast--success .rt-toast-message strong')).toHaveText(name);
    await expect(page.getByText(name,{exact:true})).toHaveCount(0);
  }finally{await worker.dispose();}
});

test('pending deletion survives a browser reload and the journal resumes without reopening project detail',async({page},info)=>{
  const worker=await mockWorker(page);
  try{
    await login(page,'delete-refresh-'+info.project.name+'@example.com');
    const name='Projeto persistido';
    const id=await makeProject(page,name);
    await confirm(page,name);
    await navigate(page,'Calendário');
    await expect(page.getByRole('heading',{name:'Calendário',exact:true})).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading',{name:'Calendário',exact:true})).toBeVisible();
    worker.jobs.get(id)!.release=true;
    await expect(page.locator('.rt-toast--success .rt-toast-message strong')).toHaveText(name);
    await expect(page.getByRole('heading',{name:'Calendário',exact:true})).toBeVisible();
    expect(page.url()).toContain('/calendario');
  }finally{await worker.dispose();}
});
