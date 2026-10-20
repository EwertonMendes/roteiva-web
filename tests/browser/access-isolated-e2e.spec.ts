import {test,expect,type Page} from "./fixtures";
import {initializeTestEnvironment,assertFails,assertSucceeds} from "@firebase/rules-unit-testing";
import {collection,deleteDoc,doc,getDoc,getDocs,query,setDoc,Timestamp,updateDoc,where} from "firebase/firestore";

const cloud="http://127.0.0.1:4173";
const api="https://roteiva-api-dev.ewertonmendes9.workers.dev";
const emulator={projectId:"demo-roteiva",firestore:{host:"127.0.0.1",port:8080}};

async function register(page:Page,email:string){
  await page.goto(cloud);
  await page.getByRole("button",{name:"Criar conta",exact:true}).click();
  const next=page.waitForEvent("popup");
  await page.getByRole("button",{name:"Cadastrar com Google",exact:true}).click();
  const popup=await next;
  await popup.waitForLoadState("load");
  await popup.getByRole("button",{name:"Add new account",exact:true}).click();
  await popup.locator("#email-input").fill(email);
  await popup.locator("#display-name-input").fill("QA Isolado");
  await popup.locator("#sign-in").click();
  await page.getByLabel("Como podemos chamar você?").fill("QA Isolado");
  await page.getByLabel("Concordo com o uso dos meus dados").check();
  await page.getByRole("button",{name:"Criar meu espaço de trabalho"}).click();
  await expect(page.locator(".app-shell")).toBeVisible();
  await expect(page.locator("[aria-busy]").first()).toHaveAttribute("aria-busy","false");
}
async function logout(page:Page){
  if(await page.getByRole("button",{name:"Abrir menu",exact:true}).isVisible())
    await page.getByRole("button",{name:"Abrir menu",exact:true}).click();
  await page.getByRole("button",{name:"Sair da conta",exact:true}).click();
  await expect(page.getByRole("button",{name:"Entrar com Google",exact:true})).toBeVisible();
}
async function loginExisting(page:Page,email:string){
  await page.goto(cloud);
  const next=page.waitForEvent("popup");
  await page.getByRole("button",{name:"Entrar com Google",exact:true}).click();
  const popup=await next;
  await popup.waitForLoadState("load");
  await popup.getByText(email,{exact:true}).click();
}
async function makeClient(page:Page,name:string){
  await page.goto(cloud+"/clientes");
  await expect(page.getByRole("heading",{name:"Clientes",exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Novo cliente",exact:true}).click();
  await page.getByLabel("Nome do cliente",{exact:true}).fill(name);
  await page.getByLabel("Contato principal",{exact:true}).fill("Contato QA");
  await page.getByRole("button",{name:"Salvar cliente"}).click();
  await expect(page.locator("[aria-busy]").first()).toHaveAttribute("aria-busy","false");
  await expect(page.getByText(name,{exact:true})).toBeVisible();
}
async function withEmulator<T>(work:(environment:Awaited<ReturnType<typeof initializeTestEnvironment>>)=>Promise<T>):Promise<T>{
  const environment=await initializeTestEnvironment(emulator);
  try{return await work(environment);}
  finally{await environment.cleanup();}
}
async function uidFor(email:string):Promise<string>{
  return withEmulator(async env=>{
    let uid="";
    // withSecurityRulesDisabled returns void even if its callback returns a value.
    await env.withSecurityRulesDisabled(async context=>{
      const accounts=await getDocs(query(collection(context.firestore(),"users"),where("email","==",email)));
      expect(accounts.size).toBe(1);
      uid=accounts.docs[0].id;
    });
    if(!uid)throw new Error("Disposable identity not found in emulator");
    return uid;
  });
}
async function setEntitlement(uid:string,values:Record<string,unknown>){
  return withEmulator(async env=>env.withSecurityRulesDisabled(async context=>
    updateDoc(doc(context.firestore(),"users",uid,"access","current"),values)));
}
async function readEntitlement(uid:string){
  return withEmulator(async env=>{
    let state:import("firebase/firestore").DocumentData|undefined;
    await env.withSecurityRulesDisabled(async context=>{
      state=(await getDoc(doc(context.firestore(),"users",uid,"access","current"))).data();
    });
    return state;
  });
}

test("isolated E2E: trial expiry locks UI and Firestore; retries and refresh cannot renew it",async({page},info)=>{
  const email="isolated-expiry-"+info.project.name+"@example.com";
  await register(page,email);
  await makeClient(page,"Cliente protegido E2E");
  const uid=await uidFor(email);
  const before=await readEntitlement(uid);
  expect(before?.source).toBe("trial");
  expect(before?.unlimited).toBe(false);
  expect(before?.trialEndsAt.toMillis()-before?.updatedAt.toMillis()).toBeGreaterThan(604800000-15000);
  await setEntitlement(uid,{accessUntil:Timestamp.fromMillis(Date.now()-60000),unlimited:false});
  await expect(page.getByRole("heading",{name:"Seu período de acesso terminou."})).toBeVisible();
  await expect(page.locator(".app-shell")).toHaveCount(0);
  await expect(page.getByRole("button",{name:"Excluir conta",exact:true})).toBeVisible();

  await withEmulator(async env=>{
    const authenticated=env.authenticatedContext(uid).firestore();
    await assertFails(getDocs(collection(authenticated,"users",uid,"clients")));
    await assertFails(getDoc(doc(authenticated,"users",uid,"clients","1")));
    await assertSucceeds(getDoc(doc(authenticated,"users",uid)));
    await assertSucceeds(getDoc(doc(authenticated,"users",uid,"access","current")));
    await assertFails(updateDoc(doc(authenticated,"users",uid,"access","current"),{unlimited:true}));
  });
  await page.goto(cloud+"/clientes");
  await expect(page.getByRole("heading",{name:"Seu período de acesso terminou."})).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading",{name:"Seu período de acesso terminou."})).toBeVisible();
  await page.getByRole("button",{name:/Verificar acesso novamente/}).click();
  await expect(page.getByRole("heading",{name:"Seu período de acesso terminou."})).toBeVisible();
  const after=await readEntitlement(uid);
  expect(after?.trialEndsAt.toMillis()).toBe(before?.trialEndsAt.toMillis());
  expect(after?.accessUntil.toMillis()).toBeLessThan(Date.now());
  expect(after?.unlimited).toBe(false);
});

test("isolated E2E: two real emulator Google sessions cannot access each other's records",async({page},info)=>{
  const first="isolated-first-"+info.project.name+"@example.com";
  const second="isolated-second-"+info.project.name+"@example.com";
  await register(page,first);
  await makeClient(page,"Cliente exclusivo Alpha");
  const uidA=await uidFor(first);
  await logout(page);
  await register(page,second);
  await makeClient(page,"Cliente exclusivo Beta");
  const uidB=await uidFor(second);
  expect(uidA).not.toBe(uidB);
  await expect(page.getByText("Cliente exclusivo Alpha",{exact:true})).toHaveCount(0);
  await page.reload();
  await expect(page.getByText("Cliente exclusivo Alpha",{exact:true})).toHaveCount(0);
  await expect(page.getByText("Cliente exclusivo Beta",{exact:true})).toBeVisible();

  await withEmulator(async env=>{
    const a=env.authenticatedContext(uidA).firestore();
    const b=env.authenticatedContext(uidB).firestore();
    const ownA=await assertSucceeds(getDocs(collection(a,"users",uidA,"clients")));
    const ownB=await assertSucceeds(getDocs(collection(b,"users",uidB,"clients")));
    expect(ownA.docs.some(x=>x.data().name==="Cliente exclusivo Alpha")).toBe(true);
    expect(ownB.docs.some(x=>x.data().name==="Cliente exclusivo Beta")).toBe(true);
    await assertFails(getDocs(collection(a,"users",uidB,"clients")));
    await assertFails(getDoc(doc(a,"users",uidB)));
    await assertFails(getDoc(doc(a,"users",uidB,"access","current")));
    await assertFails(getDocs(collection(b,"users",uidA,"clients")));
    await assertFails(getDoc(doc(b,"users",uidA)));
    await assertFails(getDoc(doc(b,"users",uidA,"access","current")));
    await assertFails(deleteDoc(doc(a,"users",uidB,"clients",ownB.docs[0].id)));
    await assertFails(deleteDoc(doc(b,"users",uidA,"clients",ownA.docs[0].id)));
  });
  await setEntitlement(uidA,{accessUntil:Timestamp.fromMillis(Date.now()-60000),unlimited:false});
  await withEmulator(async env=>{
    await assertFails(getDocs(collection(env.authenticatedContext(uidA).firestore(),"users",uidA,"clients")));
    const stillWorks=await assertSucceeds(getDocs(collection(env.authenticatedContext(uidB).firestore(),"users",uidB,"clients")));
    expect(stillWorks.docs.some(x=>x.data().name==="Cliente exclusivo Beta")).toBe(true);
  });
  await expect(page.locator(".app-shell")).toBeVisible();
  await logout(page);
  await loginExisting(page,first);
  await expect(page.getByRole("heading",{name:"Seu período de acesso terminou."})).toBeVisible();
  await expect(page.getByText("Cliente exclusivo Beta",{exact:true})).toHaveCount(0);
});

test("isolated E2E: deletion request closes the workspace, simulates backend cleanup and confirms progress",async({page},info)=>{
  // The UI speaks only to an intercepted Worker API. Real D1/Auth deletion
  // is tested in api/tests/account-deletion.test.mjs, never against DEV.
  const email="isolated-deletion-"+info.project.name+"@example.com";
  let state:"none"|"processing"|"completed"="none";
  let submissions=0;
  const headers={"Access-Control-Allow-Origin":cloud,
    "Access-Control-Allow-Methods":"GET, POST, OPTIONS",
    "Access-Control-Allow-Headers":"Authorization, Content-Type"};
  await page.route(api+"/account/deletion/status",async route=>{
    if(route.request().method()==="OPTIONS")
      return route.fulfill({status:204,headers});
    await route.fulfill({status:200,headers,contentType:"application/json",body:JSON.stringify({
      available:true,operation:state==="none"?null:{id:"isolated-operation",status:state}
    })});
  });
  await register(page,email);
  await makeClient(page,"Cliente para exclusão QA");
  const uid=await uidFor(email);
  await page.route(api+"/account/deletion",async route=>{
    if(route.request().method()==="OPTIONS")
      return route.fulfill({status:204,headers});
    submissions++;
    expect(route.request().postDataJSON()).toEqual({phrase:"EXCLUIR MINHA CONTA",acknowledged:true});
    expect(route.request().headers().authorization).toMatch(/^Bearer /);
    await withEmulator(async env=>env.withSecurityRulesDisabled(async context=>{
      const db=context.firestore();
      await setDoc(doc(db,"accountDeletionFences",uid),{deleting:true});
      await updateDoc(doc(db,"users",uid),{deletionState:"deleting"});
    }));
    state="processing";
    await route.fulfill({status:202,headers,contentType:"application/json",body:JSON.stringify({
      status:"processing",operationId:"isolated-operation"
    })});
  });
  await page.goto(cloud+"/configuracoes");
  await page.getByRole("button",{name:"Excluir conta",exact:true}).click();
  const modal=page.getByRole("dialog",{name:"Excluir sua conta?"});
  await modal.getByLabel("Digite EXCLUIR MINHA CONTA para confirmar:").fill("EXCLUIR MINHA CONTA");
  await modal.getByRole("checkbox",{name:"Entendo que esta exclusão é irreversível."}).check();
  await modal.getByRole("button",{name:"Excluir definitivamente"}).click();
  await expect(page).toHaveURL(/deletion=requested/);
  expect(submissions).toBe(1);

  await withEmulator(async env=>{
    const owned=env.authenticatedContext(uid).firestore();
    await assertFails(getDocs(collection(owned,"users",uid,"clients")));
    await assertFails(setDoc(doc(owned,"users",uid,"access","forged"),{unlimited:true}));
  });
  await loginExisting(page,email);
  await expect(page.getByRole("heading",{name:"Estamos excluindo sua conta."})).toBeVisible();
  await expect(page.locator(".app-shell")).toHaveCount(0);

  // A local privileged cleanup mimics the server's completed state. It does
  // not claim that the deployed Worker or Auth deletion has been exercised.
  await withEmulator(async env=>env.withSecurityRulesDisabled(async context=>{
    const db=context.firestore();
    for(const path of ["clients","projects","tasks","deliveries","events","financeEntries",
      "activities","sync","preferences","driveFolders","access"]){
      const entries=await getDocs(collection(db,"users",uid,path));
      for(const item of entries.docs)await deleteDoc(item.ref);
    }
    await deleteDoc(doc(db,"users",uid));
    expect((await getDoc(doc(db,"users",uid))).exists()).toBe(false);
    expect((await getDoc(doc(db,"accountDeletionFences",uid))).exists()).toBe(true);
  }));
  await page.clock.install();
  state="completed";
  await page.clock.runFor(11000);
  await expect(page).toHaveURL(/deletion=completed/);
  await expect(page.getByText("Sua conta e seus dados do Roteiva foram excluídos. Seus arquivos no Google Drive foram preservados.")).toBeVisible();
  expect(submissions).toBe(1);
});
