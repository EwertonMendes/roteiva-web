import {expect,test,type Page} from "./fixtures";
import {initializeTestEnvironment} from '@firebase/rules-unit-testing';
import {collection,getDocs,query,where,updateDoc,deleteDoc} from 'firebase/firestore';

const cloud="http://127.0.0.1:4173";
const api="https://roteiva-api-dev.ewertonmendes9.workers.dev";

async function createTestAccount(page:Page,email:string){
  await page.goto(cloud);
  await page.getByRole("button",{name:"Criar conta",exact:true}).click();
  const popupPromise=page.waitForEvent("popup");
  await page.getByRole("button",{name:"Cadastrar com Google",exact:true}).click();
  const popup=await popupPromise;
  await popup.waitForLoadState("load");
  await popup.getByRole("button",{name:"Add new account",exact:true}).click();
  await popup.locator("#email-input").fill(email);
  await popup.locator("#display-name-input").fill("Pessoa QA Exclusão");
  await popup.locator("#sign-in").click();
  await page.getByLabel("Como podemos chamar você?").fill("Pessoa QA");
  await page.getByLabel("Nome do estúdio ou marca").fill("Estúdio Exclusão QA");
  await page.getByLabel("Concordo com o uso dos meus dados").check();
  await page.getByRole("button",{name:"Criar meu espaço de trabalho"}).click();
  await expect(page.locator(".app-shell")).toBeVisible();
  await expect(page.locator("[aria-busy]").first()).toHaveAttribute("aria-busy","false");
}

test("deletion modal blocks incomplete confirmation and cancellation never calls the API",async({page},info)=>{
  let submissions=0;
  await page.route(api+"/account/deletion**",async route=>{
    const headers={"Access-Control-Allow-Origin":cloud,
      "Access-Control-Allow-Methods":"GET, POST, OPTIONS",
      "Access-Control-Allow-Headers":"Authorization, Content-Type"};
    if(route.request().method()==="OPTIONS")return route.fulfill({status:204,headers});
    if(route.request().url().includes("/account/deletion/status")){
      return route.fulfill({status:200,headers,
        contentType:"application/json",body:JSON.stringify({available:true,operation:null})});
    }
    submissions++;
    return route.fulfill({status:503,headers,
      contentType:"application/json",body:JSON.stringify({error:{code:"deletion_unavailable"}})});
  });
  await createTestAccount(page,"deletion-confirm-"+info.project.name+"@example.com");
  await page.goto(cloud+"/configuracoes");
  const open=page.getByRole("button",{name:"Excluir conta",exact:true});
  await expect(open).toBeEnabled();
  await open.click();
  const dialog=page.getByRole("dialog",{name:"Excluir sua conta?"});
  await expect(dialog).toBeVisible();
  const submit=dialog.getByRole("button",{name:"Excluir definitivamente"});
  await expect(submit).toBeDisabled();
  await dialog.getByLabel("Digite EXCLUIR MINHA CONTA para confirmar:").fill("EXCLUIR");
  await expect(submit).toBeDisabled();
  await dialog.getByLabel("Digite EXCLUIR MINHA CONTA para confirmar:").fill("EXCLUIR MINHA CONTA");
  await expect(submit).toBeDisabled();
  await dialog.getByRole("checkbox",{name:"Entendo que esta exclusão é irreversível."}).check();
  await expect(submit).toBeEnabled();
  await dialog.getByRole("button",{name:"Cancelar"}).click();
  await expect(dialog).toHaveCount(0);
  await open.click();
  await expect(submit).toBeDisabled();
  await expect(dialog.getByLabel("Digite EXCLUIR MINHA CONTA para confirmar:")).toHaveValue("");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await open.click();
  await dialog.getByLabel("Digite EXCLUIR MINHA CONTA para confirmar:").fill("EXCLUIR MINHA CONTA");
  await dialog.getByRole("checkbox",{name:"Entendo que esta exclusão é irreversível."}).check();
  await page.keyboard.press("Escape");
  await open.click();
  await expect(submit).toBeDisabled();
  await expect(dialog.getByLabel("Digite EXCLUIR MINHA CONTA para confirmar:")).toHaveValue("");
  await expect(dialog.getByRole("checkbox")).not.toBeChecked();
  expect(submissions).toBe(0);
});

async function confirmDeletion(page:Page){
  await page.goto(cloud+'/configuracoes');
  await page.getByRole('button',{name:'Excluir conta',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Excluir sua conta?'});
  await dialog.getByLabel('Digite EXCLUIR MINHA CONTA para confirmar:').fill('EXCLUIR MINHA CONTA');
  await dialog.getByRole('checkbox',{name:'Entendo que esta exclusão é irreversível.'}).check();
  await dialog.getByRole('button',{name:'Excluir definitivamente'}).click();
  return dialog;
}

for(const needsReauth of [false,true])test('deletion reuses recent login and asks Google only when server requires it; reauth='+needsReauth,async({page},info)=>{
  let submissions=0;
  let requestedUid:string|undefined;
  await page.route(api+'/account/deletion',async route=>{
    const headers={'Access-Control-Allow-Origin':cloud,'Access-Control-Allow-Methods':'POST, OPTIONS',
      'Access-Control-Allow-Headers':'Authorization, Content-Type'};
    if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
    submissions++;
    expect(route.request().postDataJSON()).toEqual({phrase:'EXCLUIR MINHA CONTA',acknowledged:true});
    expect(route.request().headers().authorization).toMatch(/^Bearer /);
    const token=route.request().headers().authorization.slice('Bearer '.length);
    const claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString());
    requestedUid??=claims.sub;
    expect(claims.sub).toBe(requestedUid);
    if(needsReauth&&submissions===1)return route.fulfill({status:401,headers,contentType:'application/json',
      body:JSON.stringify({error:{code:'invalid_identity'}})});
    return route.fulfill({status:202,headers,contentType:'application/json',
      body:JSON.stringify({status:'processing',operationId:'test-operation'})});
  });
  const email='deletion-submit-'+needsReauth+'-'+info.project.name+'@example.com';
  await createTestAccount(page,email);
  let popups=0;page.on('popup',()=>{popups++;});
  const dialog=await confirmDeletion(page);
  if(needsReauth){
    const confirmGoogle=dialog.getByRole('button',{name:'Confirmar com Google'});
    await expect(confirmGoogle).toBeEnabled();
    await expect(dialog.getByRole('alert')).toContainText('confirme sua identidade com o Google');
    expect(submissions).toBe(1);expect(popups).toBe(0);
    // Cancelling Google must leave the account open and must not submit again.
    let pending=page.waitForEvent('popup');await confirmGoogle.click();
    let popup=await pending;await popup.waitForLoadState('load');await popup.close();
    await expect(confirmGoogle).toBeEnabled();expect(submissions).toBe(1);
    // Google can offer another account. Firebase must reject it without
    // changing the Roteiva identity or submitting a destructive request.
    pending=page.waitForEvent('popup');await confirmGoogle.click();
    popup=await pending;await popup.waitForLoadState('load');
    await popup.getByRole('button',{name:'Add new account',exact:true}).click();
    await popup.locator('#email-input').fill('wrong-deletion-'+info.project.name+'@example.com');
    await popup.locator('#display-name-input').fill('Outra pessoa QA');
    await popup.locator('#sign-in').click();
    await expect(dialog.getByRole('alert')).toContainText('Essa conta Google é diferente');
    await expect(dialog.getByRole('alert')).toContainText(email);
    expect(submissions).toBe(1);
    await expect(dialog.getByText('Você está excluindo a conta', {exact:false})).toContainText(email);
    pending=page.waitForEvent('popup');await confirmGoogle.click();
    popup=await pending;await popup.waitForLoadState('load');
    await popup.getByText(email,{exact:true}).click();
  }
  await expect(page).toHaveURL(/deletion=requested/);
  expect(submissions).toBe(needsReauth?2:1);
  expect(popups).toBe(needsReauth?3:0);
  await expect(page.getByRole('status')).toContainText('Recebemos seu pedido de exclusão.');
});

for(const profilePresent of [true,false])test('pending deletion reports delays honestly and confirms completion; profile present='+profilePresent,async({page},info)=>{
  let status:'idle'|'unavailable'|'manual_review'|'completed'='idle';
  await page.route(api+'/account/deletion/status',async route=>{
    const headers={'Access-Control-Allow-Origin':cloud,
      'Access-Control-Allow-Methods':'GET, OPTIONS',
      'Access-Control-Allow-Headers':'Authorization, Content-Type'};
    if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
    return route.fulfill({status:status==='unavailable'?503:200,headers,
      contentType:'application/json',body:JSON.stringify({available:true,
        operation:status==='idle'?null:{id:'test-operation',status}})});
  });
  const email='deletion-progress-'+profilePresent+'-'+info.project.name+'@example.com';
  await createTestAccount(page,email);
  const environment=await initializeTestEnvironment({projectId:'demo-roteiva',firestore:{host:'127.0.0.1',port:8080}});
  try{
    await environment.withSecurityRulesDisabled(async context=>{
      const profiles=await getDocs(query(collection(context.firestore(),'users'),where('email','==',email)));
      expect(profiles.size).toBe(1);
      if(profilePresent)await updateDoc(profiles.docs[0].ref,{deletionState:'deleting'});
      else await deleteDoc(profiles.docs[0].ref);
    });
  }finally{await environment.cleanup();}
  // Before root removal the profile marker is enough; afterwards a failed
  // status lookup must close the gate until it can verify the durable job.
  status='unavailable';
  await page.reload();
  if(!profilePresent){
    await expect(page.getByRole('heading',{name:'Não foi possível consultar seu cadastro.'})).toBeVisible();
    await expect(page.getByRole('button',{name:'Criar meu espaço',exact:true})).toHaveCount(0);
    status='manual_review';
    await page.getByRole('button',{name:'Tentar novamente'}).click();
  }
  await expect(page.getByRole('heading',{name:'Estamos excluindo sua conta.'})).toBeVisible();
  await expect(page.getByRole('status')).toContainText(profilePresent?'Não conseguimos atualizar o andamento agora.':'A exclusão está demorando mais que o esperado.');
  await expect(page.getByText('Sua conta e seus dados do Roteiva foram excluídos.')).toHaveCount(0);
  await expect(page.getByText(/STUDIO \/ DEV|AMBIENTE DE DESENVOLVIMENTO|retomará a limpeza|Firestore/)).toHaveCount(0);
  await page.clock.install();
  status='manual_review';
  await page.clock.runFor(11000);
  await expect(page.getByRole('status')).toContainText('A exclusão está demorando mais que o esperado.');
  status='completed';
  await page.clock.runFor(11000);
  await expect(page).toHaveURL(/deletion=completed/);
  await expect(page.getByText('Sua conta e seus dados do Roteiva foram excluídos. Seus arquivos no Google Drive foram preservados.')).toBeVisible();
});
