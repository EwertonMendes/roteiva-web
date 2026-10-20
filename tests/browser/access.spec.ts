import {test,expect,type Page} from './fixtures';
import {initializeTestEnvironment} from '@firebase/rules-unit-testing';
import {collection,doc,getDocs,query,updateDoc,where,Timestamp} from 'firebase/firestore';

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
  await page.goto(cloud+'/configuracoes');
  await expect(page.getByRole('heading',{name:'Seu acesso'})).toBeVisible();
  await expect(page.getByText('Período de teste gratuito',{exact:true})).toBeVisible();
  await expect(page.getByText(/Seu teste gratuito dura 7 dias/)).toBeVisible();
  await changeAccess(email,{accessUntil:Timestamp.fromMillis(Date.now()-60000),unlimited:false});
  await expect(page.getByRole('heading',{name:'Seu período de acesso terminou.'})).toBeVisible();
  await expect(page.locator('.app-shell')).toHaveCount(0);
  await expect(page.getByText(/Excluir e recriar a conta não libera outro teste/)).toBeVisible();
  await expect(page.getByRole('button',{name:'Excluir conta',exact:true})).toBeVisible();
  await changeAccess(email,{accessUntil:Timestamp.fromMillis(Date.now()+86400000),unlimited:false});
  await expect(page.locator('.app-shell')).toBeVisible();
  await changeAccess(email,{suspended:true});
  await expect(page.getByRole('heading',{name:'Acesso temporariamente suspenso.'})).toBeVisible();
});
