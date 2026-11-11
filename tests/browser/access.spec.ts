import {test,expect,type Page} from './fixtures';
import {initializeTestEnvironment} from '@firebase/rules-unit-testing';
import {collection,doc,getDoc,getDocs,query,updateDoc,setDoc,deleteDoc,where,Timestamp} from 'firebase/firestore';

const cloud='http://127.0.0.1:4173';
async function signup(page:Page,email:string){
  await page.goto(cloud);
  await page.getByRole('button',{name:'Criar conta',exact:true}).click();
  const opening=page.waitForEvent('popup');
  await page.getByRole('button',{name:'Cadastrar com Google',exact:true}).click();
  const popup=await opening;await popup.waitForLoadState('load');
  await popup.getByRole('button',{name:'Add new account',exact:true}).click();
  await popup.locator('#email-input').fill(email);
  await popup.locator('#display-name-input').fill('Teste de acesso');
  await popup.locator('#sign-in').click();
  await page.getByLabel('Como podemos chamar você?').fill('Teste de acesso');
  await page.getByLabel('Concordo com o uso dos meus dados').check();
  await page.getByRole('button',{name:'Criar meu espaço de trabalho'}).click();
  await expect(page.locator('.app-shell')).toBeVisible();
}
async function changeAccess(email:string,changes:Record<string,unknown>){
  const env=await initializeTestEnvironment({projectId:'demo-roteiva',firestore:{host:'127.0.0.1',port:8080}});
  try{
    await env.withSecurityRulesDisabled(async context=>{
      const db=context.firestore();
      const users=await getDocs(query(collection(db,'users'),where('email','==',email)));
      expect(users.size).toBe(1);
      await updateDoc(doc(db,'users',users.docs[0].id,'access','current'),changes);
    });
  }finally{await env.cleanup();}
}
test('seven-day trial status, expiry, restore and suspension react without a reload',async({page},info)=>{
  const email='access-'+info.project.name+'@example.com';
  await signup(page,email);
  await expect(page.getByRole('button',{name:'Excluir conta',exact:true})).toHaveCount(0);
  await page.goto(cloud+'/configuracoes');
  await expect(page.getByRole('heading',{name:'Período de teste gratuito'})).toBeVisible();
  await expect(page.getByText(/Seu teste gratuito dura 7 dias/)).toBeVisible();
  await expect(page.getByRole('button',{name:'Excluir conta',exact:true})).toBeVisible();
  await changeAccess(email,{accessUntil:Timestamp.fromMillis(Date.now()-60000),unlimited:false});
  await expect(page.getByRole('heading',{name:'Seu período de acesso terminou.'})).toBeVisible();
  await expect(page.locator('.app-shell')).toHaveCount(0);
  await expect(page.getByText(/Excluir e recriar a conta não libera outro teste/)).toBeVisible();
  await expect(page.getByRole('button',{name:'Excluir conta',exact:true})).toHaveCount(0);
  await expect(page.getByText('Excluir minha conta',{exact:true})).toHaveCount(0);
  await changeAccess(email,{accessUntil:Timestamp.fromMillis(Date.now()+86400000),unlimited:false});
  await expect(page.locator('.app-shell')).toBeVisible();
  await expect(page.getByRole('button',{name:'Excluir conta',exact:true})).toBeVisible();
  await changeAccess(email,{suspended:true});
  await expect(page.getByRole('heading',{name:'Acesso temporariamente suspenso.'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Excluir conta',exact:true})).toHaveCount(0);
});


test('access validation errors never offer account deletion',async({page},info)=>{
  await signup(page,'access-error-'+info.project.name+'@example.com');
  await page.route('http://127.0.0.1:8787/access/ensure',async route=>{
    const headers={'Access-Control-Allow-Origin':cloud,'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type'};
    await route.fulfill(route.request().method()==='OPTIONS'?{status:204,headers}:{status:503,headers,contentType:'application/json',body:'{}'});
  });
  await page.reload();
  await expect(page.getByRole('heading',{name:'Não conseguimos validar sua assinatura.'})).toBeVisible();
  for(const theme of ['light','dark']){
    await page.evaluate(value=>{document.documentElement.dataset.theme=value;},theme);
    const messageBox=await page.getByRole('alert').boundingBox(),actionsBox=await page.locator('.auth-row-actions').boundingBox();
    expect(messageBox).not.toBeNull();expect(actionsBox).not.toBeNull();
    expect(actionsBox!.y-(messageBox!.y+messageBox!.height)).toBeGreaterThanOrEqual(18);
  }
  await expect(page.getByRole('button',{name:'Excluir conta',exact:true})).toHaveCount(0);
  await expect(page.getByText('Excluir minha conta',{exact:true})).toHaveCount(0);
});

test('session survives reload and OAuth return URLs for every registered identity',async({page},info)=>{
  await signup(page,'access-return-'+info.project.name+'@example.com');
  for(const provider of ['drive','dropbox']){
    await page.goto(cloud+'/biblioteca?'+provider+'=connected');
    await expect(page.locator('.app-shell')).toBeVisible();
    await page.reload();await expect(page.locator('.app-shell')).toBeVisible();
    await expect(page.getByRole('heading',{name:'Não conseguimos validar sua assinatura.'})).toHaveCount(0);
  }
});

test('an empty listener snapshot is reconciled by an authenticated server read',async({page},info)=>{
  const email='access-reconcile-'+info.project.name+'@example.com';
  await signup(page,email);
  const env=await initializeTestEnvironment({projectId:'demo-roteiva',firestore:{host:'127.0.0.1',port:8080}});
  try{
    await env.withSecurityRulesDisabled(async context=>{
      const db=context.firestore(),users=await getDocs(query(collection(db,'users'),where('email','==',email)));
      expect(users.size).toBe(1);
      const uid=users.docs[0].id,ref=doc(db,'users',uid,'access','current'),saved=(await getDoc(ref)).data();
      expect(saved).toBeDefined();
      const url='http://127.0.0.1:8080/v1/projects/demo-roteiva/databases/(default)/documents/users/'+uid+'/access/current';
      let authorized=false;
      await page.route(url,async route=>{
        if(route.request().method()==='GET'){
          authorized=(route.request().headers().authorization||'').startsWith('Bearer ');
          // Restore the isolated fixture before the independent read reaches the
          // emulator. Its normal Rules still validate the browser's user token.
          await setDoc(ref,saved!);
        }
        await route.continue();
      });
      const response=page.waitForResponse(r=>r.url()===url&&r.request().method()==='GET');
      await deleteDoc(ref);
      expect((await response).status()).toBe(200);expect(authorized).toBe(true);
      await expect(page.locator('.app-shell')).toBeVisible();
      await expect(page.getByRole('heading',{name:'Não conseguimos validar sua assinatura.'})).toHaveCount(0);
    });
  }finally{await env.cleanup();}
});
