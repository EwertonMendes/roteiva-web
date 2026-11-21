import {test,expect,type Page} from './fixtures';
import {initializeTestEnvironment} from '@firebase/rules-unit-testing';
import {collection,doc,getDoc,getDocs,query,updateDoc,setDoc,deleteDoc,where,Timestamp} from 'firebase/firestore';

const cloud='http://127.0.0.1:4173';
test('entry transport failures show a safe reference and never automatically replay provisioning',async({page},info)=>{
 await signup(page,'access-transport-'+info.project.name+'@example.com');
 let posts=0;
 await page.route('http://127.0.0.1:8787/access/ensure',async route=>{
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':cloud,'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type'}});
  posts++;await route.abort('failed');
 });
 await page.reload();
 await expect(page.getByRole('alert')).toContainText('access-ensure/transport');
 await expect(page.getByRole('alert')).not.toContainText('NetworkError');
 expect(posts).toBe(1);await expect(page.locator('.app-shell')).toHaveCount(0);
 await page.getByRole('button',{name:'Tentar novamente',exact:true}).click();
 await expect.poll(()=>posts).toBe(2);
 await expect(page.getByRole('alert')).toContainText('access-ensure/transport');
});
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
  await expect(page.getByRole('button',{name:'Excluir conta',exact:true})).toBeEnabled();
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

test('a second tab restores the same account and can reload without manual recovery',async({page},info)=>{
  await signup(page,'access-new-tab-'+info.project.name+'@example.com');
  // The first tab has already provisioned this isolated account. Share only the
  // API transport mock; Firestore and persistent Auth stay real emulator SDKs.
  await page.context().route('http://127.0.0.1:8787/access/ensure',async route=>{
    const headers={'Access-Control-Allow-Origin':cloud,'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type'};
    await route.fulfill({status:route.request().method()==='OPTIONS'?204:200,headers,body:route.request().method()==='OPTIONS'?'':'{}'});
  });
  const restored=await page.context().newPage();
  try{
    await restored.goto(cloud+'/biblioteca?drive=connected');
    // Mobile Chromium may need additional time to restore IndexedDB Auth from
    // another tab. Do not reload to mask a failure: assert automatic recovery.
    await expect(restored.locator('.app-shell')).toBeVisible({timeout:30000});
    await restored.reload();await expect(restored.locator('.app-shell')).toBeVisible({timeout:30000});
    await expect(restored.getByRole('heading',{name:'Não foi possível consultar seu cadastro.'})).toHaveCount(0);
  }finally{await restored.close();}
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

test('new signup recovers when deletion-status read is temporarily unavailable',async({page},info)=>{
  let reads=0;
  const headers={'Access-Control-Allow-Origin':cloud,
    'Access-Control-Allow-Methods':'GET, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type'};
  await page.route('http://127.0.0.1:8787/account/deletion/status',async route=>{
    if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
    reads++;
    await route.fulfill(reads===1?{status:503,headers,body:'{}'}:{
      status:200,headers,contentType:'application/json',body:JSON.stringify({available:true,operation:null})
    });
  });
  await signup(page,'reviewer-transient-'+info.project.name+'@example.com');
  expect(reads).toBeGreaterThanOrEqual(2);
  await page.reload();
  await expect(page.locator('.app-shell')).toBeVisible();
});

test('new identity cannot bypass an unavailable deletion-status guard',async({page},info)=>{
  let available=false;
  const headers={'Access-Control-Allow-Origin':cloud,
    'Access-Control-Allow-Methods':'GET, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type'};
  await page.route('http://127.0.0.1:8787/account/deletion/status',async route=>{
    if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
    return route.fulfill(available?{status:200,headers,contentType:'application/json',
      body:JSON.stringify({available:true,operation:null})}:{status:503,headers,body:'{}'});
  });
  await page.goto(cloud);
  await page.getByRole('button',{name:'Criar conta',exact:true}).click();
  const opening=page.waitForEvent('popup');
  await page.getByRole('button',{name:'Cadastrar com Google',exact:true}).click();
  const popup=await opening;await popup.waitForLoadState('load');
  await popup.getByRole('button',{name:'Add new account',exact:true}).click();
  await popup.locator('#email-input').fill('reviewer-guard-'+info.project.name+'@example.com');
  await popup.locator('#display-name-input').fill('Avaliação Dropbox');
  await popup.locator('#sign-in').click();
  await expect(page.getByRole('heading',{name:'Não foi possível consultar seu cadastro.'})).toBeVisible({timeout:30000});
  await expect(page.getByRole('button',{name:'Criar meu espaço de trabalho'})).toHaveCount(0);
  await expect(page.locator('.app-shell')).toHaveCount(0);
  available=true;
  await page.getByRole('button',{name:/Tentar novamente/}).click();
  await page.getByLabel('Como podemos chamar você?').fill('Avaliação Dropbox');
  await page.getByLabel('Concordo com o uso dos meus dados').check();
  await page.getByRole('button',{name:'Criar meu espaço de trabalho'}).click();
  await expect(page.locator('.app-shell')).toBeVisible();
});


test('billing summary, responsive history and restricted checkout use the same billing data',{tag:'@ci-smoke'},async({page},info)=>{
  const email='billing-layout-'+info.project.name+'@example.com';
  await signup(page,email);
  if(info.project.name==='mobile') await page.setViewportSize({width:320,height:780});
  const validInvoice='https://sandbox.asaas.com/i/test-fatura';
  const first=Array.from({length:5},(_,index)=>({
    state:index===0?'overdue':index===1?'refunded':index===2?'partial_refund':'confirmed',amountCents:39990,
    ...(index===2?{refundedAmountCents:1800}:{}),
    dueOn:`2026-11-${20-index}`,invoiceUrl:index===0?validInvoice:null,
  }));
  const older={state:'refused',amountCents:3990,dueOn:null,invoiceUrl:'https://untrusted.example/i/test'};
  const headers={'Access-Control-Allow-Origin':cloud,'Access-Control-Allow-Methods':'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers':'Authorization, Content-Type'};
  let stage:'active'|'expired'|'suspended'='active',historyRequests=0,checkoutRequests=0;
  await page.route(/^http:\/\/127\.0\.0\.1:8787\/billing\/(status|plans|checkout)(\?.*)?$/,async route=>{
    const request=route.request(),url=new URL(request.url());
    if(request.method()==='OPTIONS') return route.fulfill({status:204,headers});
    if(url.pathname.endsWith('/plans')) return route.fulfill({headers,json:{plans:[
      {code:'monthly',amountCents:3990,version:'test'},
      {code:'quarterly',amountCents:10990,version:'test'},
      {code:'yearly',amountCents:39990,version:'test'},
    ]}});
    if(url.pathname.endsWith('/checkout')){
      checkoutRequests++;
      expect(request.postDataJSON()).toEqual({planCode:'yearly',catalogVersion:'test',acceptedImmediateCharge:true});
      return route.fulfill({headers,json:{status:'pending'}});
    }
    if(url.searchParams.get('paymentCursor')==='previous-cycle'){
      historyRequests++;
      if(historyRequests===1) return route.fulfill({status:503,headers,json:{}});
      return route.fulfill({headers,json:{payments:[older],nextPaymentCursor:null}});
    }
    return route.fulfill({headers,json:{
      checkoutAvailable:true,canStart:stage==='expired'&&!checkoutRequests,checkout:null,notice:null,
      subscription:stage==='expired'?null:{
        planCode:'yearly',status:'canceled',paidUntil:'2027-11-20T15:00:00.000Z',nextDueOn:null,
        amountCents:39990,paymentMethod:'CREDIT_CARD',canCancel:false,cancellation:null,
      },
      payments:first,nextPaymentCursor:'previous-cycle',
    }});
  });
  await changeAccess(email,{source:'subscription',accessUntil:Timestamp.fromMillis(Date.now()+86400000)});
  await page.goto(cloud+'/configuracoes');
  const billing=page.getByRole('region',{name:'Assinatura',exact:true});
  await expect(billing.getByRole('heading',{name:'Plano anual'})).toBeVisible();
  await expect(billing.getByText('Renovação cancelada',{exact:true})).toBeVisible();
  const history=billing.getByRole('region',{name:'Histórico de cobranças'});
  await expect(history.getByRole('row')).toHaveCount(6);
  await expect(history.getByText('Estorno parcial',{exact:true})).toBeVisible();
  await expect(history.getByText(/18,00 estornados/)).toBeVisible();
  await expect(history.getByRole('link',{name:/Abrir fatura/})).toHaveAttribute('href',validInvoice);
  const next=history.getByRole('button',{name:'Próxima página'});
  await next.click();
  await expect(history.getByRole('alert')).toContainText('Não foi possível carregar');
  await expect(history.getByRole('row')).toHaveCount(6);
  await next.click();
  await expect(history.getByRole('status')).toHaveText('Página 2');
  await expect(history.getByText('Cartão recusado')).toBeVisible();
  await expect(history.getByRole('link')).toHaveCount(0);
  await expect(next).toHaveAttribute('aria-disabled','true');
  await history.getByRole('button',{name:'Página anterior'}).click();
  await expect(history.getByRole('status')).toHaveText('Página 1');
  await next.click();
  await expect(history.getByRole('status')).toHaveText('Página 2');
  expect(historyRequests).toBe(2);
  await history.getByRole('button',{name:'Página anterior'}).click();

  const fitsViewport=async(selector:string)=>page.locator(selector).evaluate(node=>{
    const viewport=document.documentElement.clientWidth;
    return document.documentElement.scrollWidth<=viewport+1 &&
      Array.from(node.querySelectorAll<HTMLElement>('.billing-account-card,.billing-plan,.billing-table-row,.billing-access-hero')).every(element=>{
        const box=element.getBoundingClientRect();
        return box.left>=-1&&box.right<=viewport+1&&element.scrollWidth<=element.clientWidth+1;
      });
  });
  for(const theme of ['light','dark']){
    await page.getByRole('button',{name:theme==='light'?'Claro':'Escuro',exact:true}).click();
    await expect.poll(()=>fitsViewport('.billing-panel')).toBe(true);
    if(process.env.ROTEIVA_BILLING_CAPTURE){
      await billing.screenshot({path:info.outputPath(`assinatura-${theme}.png`)});
    }
  }
  await billing.getByRole('button',{name:'Ver planos'}).click();
  await expect(billing.getByRole('heading',{name:'Planos de assinatura'})).toBeVisible();
  await expect(billing.getByText(/16% de economia/)).toBeVisible();
  await expect(billing.getByRole('button',{name:/Escolher/})).toHaveCount(0);

  stage='expired';
  await changeAccess(email,{accessUntil:Timestamp.fromMillis(Date.now()-60000)});
  await expect(page.getByRole('heading',{name:'Seu período de acesso terminou.'})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Escolha seu plano'})).toBeVisible();
  await expect.poll(()=>page.locator('.billing-access img.billing-art').evaluateAll(images=>images.every(image=>(image as HTMLImageElement).naturalWidth>0))).toBe(true);
  await expect.poll(()=>fitsViewport('.billing-access')).toBe(true);
  if(process.env.ROTEIVA_BILLING_CAPTURE) await page.screenshot({path:info.outputPath('planos.png'),fullPage:true});
  // Every billing cycle uses the same aligned confirmation, with its own art.
  for(const [plan,asset] of [['mensal','monthly'],['trimestral','quarterly'],['anual','yearly']] as const){
    await page.getByRole('button',{name:`Escolher ${plan}`}).click();
    const consent=page.getByRole('dialog',{name:`Plano ${plan}`});
    await expect(consent).toBeVisible();
    const illustration=consent.locator('.billing-consent-art img.billing-art');
    await expect(illustration).toHaveAttribute('src',new RegExp(`/brand/billing/${asset}\\.webpimport {test,expect,type Page} from './fixtures';
import {initializeTestEnvironment} from '@firebase/rules-unit-testing';
import {collection,doc,getDoc,getDocs,query,updateDoc,setDoc,deleteDoc,where,Timestamp} from 'firebase/firestore';

const cloud='http://127.0.0.1:4173';
test('entry transport failures show a safe reference and never automatically replay provisioning',async({page},info)=>{
 await signup(page,'access-transport-'+info.project.name+'@example.com');
 let posts=0;
 await page.route('http://127.0.0.1:8787/access/ensure',async route=>{
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':cloud,'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type'}});
  posts++;await route.abort('failed');
 });
 await page.reload();
 await expect(page.getByRole('alert')).toContainText('access-ensure/transport');
 await expect(page.getByRole('alert')).not.toContainText('NetworkError');
 expect(posts).toBe(1);await expect(page.locator('.app-shell')).toHaveCount(0);
 await page.getByRole('button',{name:'Tentar novamente',exact:true}).click();
 await expect.poll(()=>posts).toBe(2);
 await expect(page.getByRole('alert')).toContainText('access-ensure/transport');
});
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
  await expect(page.getByRole('button',{name:'Excluir conta',exact:true})).toBeEnabled();
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

test('a second tab restores the same account and can reload without manual recovery',async({page},info)=>{
  await signup(page,'access-new-tab-'+info.project.name+'@example.com');
  // The first tab has already provisioned this isolated account. Share only the
  // API transport mock; Firestore and persistent Auth stay real emulator SDKs.
  await page.context().route('http://127.0.0.1:8787/access/ensure',async route=>{
    const headers={'Access-Control-Allow-Origin':cloud,'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type'};
    await route.fulfill({status:route.request().method()==='OPTIONS'?204:200,headers,body:route.request().method()==='OPTIONS'?'':'{}'});
  });
  const restored=await page.context().newPage();
  try{
    await restored.goto(cloud+'/biblioteca?drive=connected');
    // Mobile Chromium may need additional time to restore IndexedDB Auth from
    // another tab. Do not reload to mask a failure: assert automatic recovery.
    await expect(restored.locator('.app-shell')).toBeVisible({timeout:30000});
    await restored.reload();await expect(restored.locator('.app-shell')).toBeVisible({timeout:30000});
    await expect(restored.getByRole('heading',{name:'Não foi possível consultar seu cadastro.'})).toHaveCount(0);
  }finally{await restored.close();}
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

test('new signup recovers when deletion-status read is temporarily unavailable',async({page},info)=>{
  let reads=0;
  const headers={'Access-Control-Allow-Origin':cloud,
    'Access-Control-Allow-Methods':'GET, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type'};
  await page.route('http://127.0.0.1:8787/account/deletion/status',async route=>{
    if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
    reads++;
    await route.fulfill(reads===1?{status:503,headers,body:'{}'}:{
      status:200,headers,contentType:'application/json',body:JSON.stringify({available:true,operation:null})
    });
  });
  await signup(page,'reviewer-transient-'+info.project.name+'@example.com');
  expect(reads).toBeGreaterThanOrEqual(2);
  await page.reload();
  await expect(page.locator('.app-shell')).toBeVisible();
});

test('new identity cannot bypass an unavailable deletion-status guard',async({page},info)=>{
  let available=false;
  const headers={'Access-Control-Allow-Origin':cloud,
    'Access-Control-Allow-Methods':'GET, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type'};
  await page.route('http://127.0.0.1:8787/account/deletion/status',async route=>{
    if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers});
    return route.fulfill(available?{status:200,headers,contentType:'application/json',
      body:JSON.stringify({available:true,operation:null})}:{status:503,headers,body:'{}'});
  });
  await page.goto(cloud);
  await page.getByRole('button',{name:'Criar conta',exact:true}).click();
  const opening=page.waitForEvent('popup');
  await page.getByRole('button',{name:'Cadastrar com Google',exact:true}).click();
  const popup=await opening;await popup.waitForLoadState('load');
  await popup.getByRole('button',{name:'Add new account',exact:true}).click();
  await popup.locator('#email-input').fill('reviewer-guard-'+info.project.name+'@example.com');
  await popup.locator('#display-name-input').fill('Avaliação Dropbox');
  await popup.locator('#sign-in').click();
  await expect(page.getByRole('heading',{name:'Não foi possível consultar seu cadastro.'})).toBeVisible({timeout:30000});
  await expect(page.getByRole('button',{name:'Criar meu espaço de trabalho'})).toHaveCount(0);
  await expect(page.locator('.app-shell')).toHaveCount(0);
  available=true;
  await page.getByRole('button',{name:/Tentar novamente/}).click();
  await page.getByLabel('Como podemos chamar você?').fill('Avaliação Dropbox');
  await page.getByLabel('Concordo com o uso dos meus dados').check();
  await page.getByRole('button',{name:'Criar meu espaço de trabalho'}).click();
  await expect(page.locator('.app-shell')).toBeVisible();
});


test('billing summary, responsive history and restricted checkout use the same billing data',{tag:'@ci-smoke'},async({page},info)=>{
  const email='billing-layout-'+info.project.name+'@example.com';
  await signup(page,email);
  if(info.project.name==='mobile') await page.setViewportSize({width:320,height:780});
  const validInvoice='https://sandbox.asaas.com/i/test-fatura';
  const first=Array.from({length:5},(_,index)=>({
    state:index===0?'overdue':index===1?'refunded':index===2?'partial_refund':'confirmed',amountCents:39990,
    ...(index===2?{refundedAmountCents:1800}:{}),
    dueOn:`2026-11-${20-index}`,invoiceUrl:index===0?validInvoice:null,
  }));
  const older={state:'refused',amountCents:3990,dueOn:null,invoiceUrl:'https://untrusted.example/i/test'};
  const headers={'Access-Control-Allow-Origin':cloud,'Access-Control-Allow-Methods':'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers':'Authorization, Content-Type'};
  let stage:'active'|'expired'|'suspended'='active',historyRequests=0,checkoutRequests=0;
  await page.route(/^http:\/\/127\.0\.0\.1:8787\/billing\/(status|plans|checkout)(\?.*)?$/,async route=>{
    const request=route.request(),url=new URL(request.url());
    if(request.method()==='OPTIONS') return route.fulfill({status:204,headers});
    if(url.pathname.endsWith('/plans')) return route.fulfill({headers,json:{plans:[
      {code:'monthly',amountCents:3990,version:'test'},
      {code:'quarterly',amountCents:10990,version:'test'},
      {code:'yearly',amountCents:39990,version:'test'},
    ]}});
    if(url.pathname.endsWith('/checkout')){
      checkoutRequests++;
      expect(request.postDataJSON()).toEqual({planCode:'yearly',catalogVersion:'test',acceptedImmediateCharge:true});
      return route.fulfill({headers,json:{status:'pending'}});
    }
    if(url.searchParams.get('paymentCursor')==='previous-cycle'){
      historyRequests++;
      if(historyRequests===1) return route.fulfill({status:503,headers,json:{}});
      return route.fulfill({headers,json:{payments:[older],nextPaymentCursor:null}});
    }
    return route.fulfill({headers,json:{
      checkoutAvailable:true,canStart:stage==='expired'&&!checkoutRequests,checkout:null,notice:null,
      subscription:stage==='expired'?null:{
        planCode:'yearly',status:'canceled',paidUntil:'2027-11-20T15:00:00.000Z',nextDueOn:null,
        amountCents:39990,paymentMethod:'CREDIT_CARD',canCancel:false,cancellation:null,
      },
      payments:first,nextPaymentCursor:'previous-cycle',
    }});
  });
  await changeAccess(email,{source:'subscription',accessUntil:Timestamp.fromMillis(Date.now()+86400000)});
  await page.goto(cloud+'/configuracoes');
  const billing=page.getByRole('region',{name:'Assinatura',exact:true});
  await expect(billing.getByRole('heading',{name:'Plano anual'})).toBeVisible();
  await expect(billing.getByText('Renovação cancelada',{exact:true})).toBeVisible();
  const history=billing.getByRole('region',{name:'Histórico de cobranças'});
  await expect(history.getByRole('row')).toHaveCount(6);
  await expect(history.getByText('Estorno parcial',{exact:true})).toBeVisible();
  await expect(history.getByText(/18,00 estornados/)).toBeVisible();
  await expect(history.getByRole('link',{name:/Abrir fatura/})).toHaveAttribute('href',validInvoice);
  const next=history.getByRole('button',{name:'Próxima página'});
  await next.click();
  await expect(history.getByRole('alert')).toContainText('Não foi possível carregar');
  await expect(history.getByRole('row')).toHaveCount(6);
  await next.click();
  await expect(history.getByRole('status')).toHaveText('Página 2');
  await expect(history.getByText('Cartão recusado')).toBeVisible();
  await expect(history.getByRole('link')).toHaveCount(0);
  await expect(next).toHaveAttribute('aria-disabled','true');
  await history.getByRole('button',{name:'Página anterior'}).click();
  await expect(history.getByRole('status')).toHaveText('Página 1');
  await next.click();
  await expect(history.getByRole('status')).toHaveText('Página 2');
  expect(historyRequests).toBe(2);
  await history.getByRole('button',{name:'Página anterior'}).click();

  const fitsViewport=async(selector:string)=>page.locator(selector).evaluate(node=>{
    const viewport=document.documentElement.clientWidth;
    return document.documentElement.scrollWidth<=viewport+1 &&
      Array.from(node.querySelectorAll<HTMLElement>('.billing-account-card,.billing-plan,.billing-table-row,.billing-access-hero')).every(element=>{
        const box=element.getBoundingClientRect();
        return box.left>=-1&&box.right<=viewport+1&&element.scrollWidth<=element.clientWidth+1;
      });
  });
  for(const theme of ['light','dark']){
    await page.getByRole('button',{name:theme==='light'?'Claro':'Escuro',exact:true}).click();
    await expect.poll(()=>fitsViewport('.billing-panel')).toBe(true);
    if(process.env.ROTEIVA_BILLING_CAPTURE){
      await billing.screenshot({path:info.outputPath(`assinatura-${theme}.png`)});
    }
  }
  await billing.getByRole('button',{name:'Ver planos'}).click();
  await expect(billing.getByRole('heading',{name:'Planos de assinatura'})).toBeVisible();
  await expect(billing.getByText(/16% de economia/)).toBeVisible();
  await expect(billing.getByRole('button',{name:/Escolher/})).toHaveCount(0);

  stage='expired';
  await changeAccess(email,{accessUntil:Timestamp.fromMillis(Date.now()-60000)});
  await expect(page.getByRole('heading',{name:'Seu período de acesso terminou.'})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Escolha seu plano'})).toBeVisible();
  await expect.poll(()=>page.locator('.billing-access img.billing-art').evaluateAll(images=>images.every(image=>(image as HTMLImageElement).naturalWidth>0))).toBe(true);
  await expect.poll(()=>fitsViewport('.billing-access')).toBe(true);
  if(process.env.ROTEIVA_BILLING_CAPTURE) await page.screenshot({path:info.outputPath('planos.png'),fullPage:true});
));
    await expect.poll(()=>illustration.evaluate(img=>(img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await expect(consent.getByRole('checkbox')).not.toBeChecked();
    await expect(consent.getByRole('button',{name:'Continuar para o Asaas Sandbox'})).toBeDisabled();
    for(const theme of ['light','dark']){
      await page.evaluate(value=>{document.documentElement.dataset.theme=value;},theme);
      await expect.poll(()=>consent.evaluate(modal=>{
        const bounds=modal.getBoundingClientRect();
        const content=Array.from(modal.querySelectorAll<HTMLElement>(
          '.rt-modal__header,.rt-modal__body,.rt-modal__footer,.billing-consent-summary,.billing-consent-check,.billing-consent-art,.rt-modal__footer button'));
        const buttons=Array.from(modal.querySelectorAll<HTMLButtonElement>('.rt-modal__footer button'));
        const withoutOverflow=content.every(element=>{
          const rect=element.getBoundingClientRect();
          return rect.left>=bounds.left-1&&rect.right<=bounds.right+1&&
            element.scrollWidth<=element.clientWidth+1;
        });
        const first=buttons[0]?.getBoundingClientRect(),second=buttons[1]?.getBoundingClientRect();
        const noOverlap=!!first&&!!second&&(
          first.right<=second.left+1||second.bottom<=first.top+1||first.bottom<=second.top+1
        );
        return withoutOverflow&&noOverlap&&document.documentElement.scrollWidth<=window.innerWidth+1;
      })).toBe(true);
      if(process.env.ROTEIVA_BILLING_CAPTURE)
        await consent.screenshot({path:info.outputPath(`consent-${plan}-${theme}.png`)});
    }
    await consent.getByRole('button',{name:'Voltar'}).click();
    await expect(consent).toHaveCount(0);
  }

  await page.getByRole('button',{name:'Escolher anual'}).click();
  const dialog=page.getByRole('dialog',{name:'Plano anual'});
  await expect(dialog).toBeVisible();
  const confirm=dialog.getByRole('button',{name:'Continuar para o Asaas Sandbox'});
  await expect(confirm).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button',{name:'Escolher anual'})).toBeFocused();
  await page.getByRole('button',{name:'Escolher anual'}).click();
  await dialog.getByRole('checkbox').check();
  await confirm.click();
  await expect(page.getByText('Estamos verificando a criação do checkout.')).toBeVisible();
  expect(checkoutRequests).toBe(1);

  stage='suspended';
  await changeAccess(email,{suspended:true});
  await expect(page.getByRole('heading',{name:'Acesso temporariamente suspenso.'})).toBeVisible();
  await expect(page.getByRole('link',{name:'Fale com o suporte'})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Plano anual'})).toBeVisible();
  await expect(page.getByRole('button',{name:/Escolher|Excluir conta/})).toHaveCount(0);
  await expect(page.getByText('Estamos verificando a criação do checkout.')).toHaveCount(0);
  await expect(page.locator('.app-shell')).toHaveCount(0);
  await expect.poll(()=>fitsViewport('.billing-access')).toBe(true);
  if(process.env.ROTEIVA_BILLING_CAPTURE) await page.screenshot({path:info.outputPath('suspensa.png'),fullPage:true});
});


test('settings upgrade compares plans and schedules the confirmed renewal',{tag:'@ci-smoke'},async({page},info)=>{
  const email='upgrade-layout-'+info.project.name+'@example.com';
  await signup(page,email);
  if(info.project.name==='mobile')await page.setViewportSize({width:320,height:780});
  await changeAccess(email,{source:'subscription',accessUntil:Timestamp.fromMillis(Date.now()+86400000)});
  const headers={'Access-Control-Allow-Origin':cloud,'Access-Control-Allow-Methods':'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers':'Authorization, Content-Type'};
  let scheduled=false,upgrades=0;
  let currentPlan:'monthly'|'quarterly'|'yearly'='monthly';
  await page.route(/^http:\/\/127\.0\.0\.1:8787\/billing\/(status|plans|upgrade)$/,async route=>{
    const request=route.request();
    if(request.method()==='OPTIONS')return route.fulfill({status:204,headers});
    if(request.url().endsWith('/plans'))return route.fulfill({headers,json:{plans:[
      {code:'monthly',amountCents:3990,version:'test'},
      {code:'quarterly',amountCents:10990,version:'test'},
      {code:'yearly',amountCents:39990,version:'test'},
    ]}});
    if(request.url().endsWith('/upgrade')){
      upgrades++;
      expect(request.postDataJSON()).toEqual({planCode:'yearly',catalogVersion:'test',effectiveOn:'2027-04-12',confirmed:true});
      scheduled=true;
      return route.fulfill({headers,json:{status:'scheduled'}});
    }
    return route.fulfill({headers,json:{checkoutAvailable:true,canStart:false,checkout:null,notice:null,payments:[],
      subscription:{
        status:'active',planCode:currentPlan,amountCents:{monthly:3990,quarterly:10990,yearly:39990}[currentPlan],
        paidUntil:'2027-04-12T03:00:00.000Z',nextDueOn:'2027-04-12',paymentMethod:'CREDIT_CARD',
        canCancel:true,cancellation:null,
        upgradeOffer:scheduled||currentPlan==='yearly'?null:{
          effectiveOn:'2027-04-12',plans:currentPlan==='monthly'?['quarterly','yearly']:['yearly'],
        },
        upgrade:scheduled?{planCode:'yearly',amountCents:39990,effectiveOn:'2027-04-12',status:'scheduled'}:null,
      },
    }});
  });
  await page.goto(cloud+'/configuracoes');
  const upgrade=page.getByRole('button',{name:'Fazer upgrade'});
  await upgrade.click();
  const options=page.getByRole('region',{name:'Faça upgrade do seu plano'});
  await expect(options.getByRole('heading',{name:'Faça upgrade do seu plano'})).toBeFocused();
  await expect(page.getByRole('button',{name:'Mudar para mensal'})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Mudar para trimestral'})).toBeVisible();
  if(process.env.ROTEIVA_BILLING_CAPTURE) await options.screenshot({path:info.outputPath('comparar-upgrade.png')});
  await page.getByRole('button',{name:'Mudar para anual'}).click();
  const dialog=page.getByRole('dialog',{name:'Upgrade para o plano anual'});
  await expect(dialog.getByText(/12 de abr.*2027.*399,90.*cartão atual.*Nenhum valor/)).toBeVisible();
  expect(await dialog.locator('footer button').evaluateAll(buttons=>buttons.every(button=>{
    const range=document.createRange();
    range.selectNodeContents(button);
    const box=button.getBoundingClientRect(),text=range.getBoundingClientRect();
    return text.left>=box.left&&text.right<=box.right&&text.top>=box.top&&text.bottom<=box.bottom;
  }))).toBe(true);
  if(process.env.ROTEIVA_BILLING_CAPTURE) await dialog.screenshot({path:info.outputPath('confirmar-upgrade.png')});
  await dialog.getByRole('button',{name:'Voltar'}).click();
  expect(upgrades).toBe(0);
  await page.getByRole('button',{name:'Mudar para anual'}).click();
  await dialog.getByRole('button',{name:'Confirmar upgrade'}).click();
  await expect(page.getByRole('status').filter({hasText:'Upgrade agendado.'})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Plano mensal'})).toBeVisible();
  await expect(upgrade).toHaveCount(0);
  expect(upgrades).toBe(1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  scheduled=false;currentPlan='quarterly';
  await page.reload();
  await upgrade.click();
  await expect(options.getByText(/9% de economia/)).toBeVisible();
  await expect(options.getByText(/16% de economia/)).toHaveCount(0);
  await expect(options.getByRole('button',{name:'Mudar para anual'})).toBeVisible();
  await expect(options.getByRole('button',{name:'Mudar para trimestral'})).toHaveCount(0);
  currentPlan='yearly';
  await page.reload();
  await expect(page.getByRole('heading',{name:'Plano anual'})).toBeVisible();
  await expect(upgrade).toHaveCount(0);
});
