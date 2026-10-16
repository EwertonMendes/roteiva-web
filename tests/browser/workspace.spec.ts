import {test,expect,type Page} from "@playwright/test";
const cloud="http://127.0.0.1:4173";
async function login(page:Page,email:string,existing=false) {
  const popupPromise=page.waitForEvent("popup");
  await page.getByRole("button",{name:"Entrar com Google",exact:true}).click();
  const popup=await popupPromise;
  // The emulator HTML renders before its final script (and click handlers) loads.
  await popup.waitForLoadState("load");
  if(existing) await popup.getByText(email,{exact:true}).click();
  else {
    await popup.getByRole("button",{name:"Add new account",exact:true}).click();
    await popup.locator("#email-input").fill(email);
    await popup.locator("#display-name-input").fill("Profissional de teste");
    await popup.locator("#sign-in").click();
  }
  await expect(page.locator(".app-shell")).toBeVisible();
  await settled(page);
}
async function settled(page:Page) {
  await expect(page.locator("[aria-busy]").first()).toHaveAttribute("aria-busy","false");
  await expect(page.locator(".cloud-recovery")).toHaveCount(0);
}
async function navigate(page:Page,name:string) {
  if(await page.getByRole("button",{name:"Abrir menu",exact:true}).isVisible()) await page.getByRole("button",{name:"Abrir menu",exact:true}).click();
  await page.locator(".sidebar nav").getByRole("button",{name:new RegExp("^"+name)}).click();
}
async function logout(page:Page) {
  await settled(page);
  if(await page.getByRole("button",{name:"Abrir menu",exact:true}).isVisible()) await page.getByRole("button",{name:"Abrir menu",exact:true}).click();
  await page.getByRole("button",{name:"Sair da conta",exact:true}).click();
  await expect(page.getByRole("button",{name:"Entrar com Google",exact:true})).toBeVisible();
}
test("Google emulator session, CRUD, restoration, themes and separate users",async({page},info)=>{
  await page.goto(cloud+"/review");
  await expect(page.getByRole("button",{name:"Entrar com Google"})).toBeVisible();
  await expect(page.locator(".app-shell")).toHaveCount(0);
  await page.goto(cloud);
  const email="alice-"+info.project.name+"@example.com";
  await login(page,email);
  await expect(page.getByRole("heading",{name:"Seu espaço está pronto"})).toBeVisible();
  await navigate(page,"Clientes");
  await page.getByRole("button",{name:"Novo cliente",exact:true}).click();
  await page.getByLabel("Nome do cliente",{exact:true}).fill("Estúdio Aurora");
  await page.getByLabel("Contato principal",{exact:true}).fill("Ana");
  await page.getByRole("button",{name:"Salvar cliente"}).click();await settled(page);
  await navigate(page,"Projetos");
  await page.locator(".heading-actions").getByRole("button",{name:"Criar projeto",exact:true}).click();
  await page.getByLabel("Nome do projeto",{exact:true}).fill("Filme Aurora");
  await page.locator("form.project-modal select[name=clientId]").selectOption({label:"Estúdio Aurora"});
  await page.locator("form.project-modal").getByRole("button",{name:"Criar projeto",exact:true}).click();await settled(page);
  await page.getByLabel("Nova tarefa",{exact:true}).fill("Montar primeiro corte");
  await expect(page.getByLabel("Nova tarefa",{exact:true})).toHaveValue("Montar primeiro corte");
  await page.getByRole("button",{name:"Adicionar tarefa",exact:true}).click();await settled(page);
  await expect(page.getByText("Montar primeiro corte",{exact:true})).toBeVisible();
  await navigate(page,"Financeiro");
  await page.getByRole("button",{name:"Nova receita",exact:true}).click();
  await page.getByLabel("Valor do trabalho").fill("100,01");
  await page.getByLabel("Previsão de recebimento",{exact:true}).fill(new Date().toISOString().slice(0,10));
  await page.locator("form.finance-modal").getByRole("button",{name:"Adicionar lançamento"}).click();await settled(page);
  await expect(page.locator(".finance-table")).toContainText("100,01");
  await navigate(page,"Calendário");
  await page.getByRole("button",{name:"Novo compromisso",exact:true}).click();
  await page.getByLabel("Título",{exact:true}).fill("Gravação Aurora");
  await page.getByLabel("Data do trabalho",{exact:true}).fill(new Date().toISOString().slice(0,10));
  await page.getByLabel("Horário de término",{exact:true}).fill("10:00");
  await page.getByRole("button",{name:"Salvar compromisso"}).click();await settled(page);
  await page.getByRole("button",{name:"Ativar modo escuro",exact:true}).click();await settled(page);
  await page.reload();await expect(page.locator(".app-shell")).toBeVisible();await settled(page);
  await expect(page.locator("html")).toHaveAttribute("data-theme","dark");
  await navigate(page,"Financeiro");
  await expect(page.locator(".finance-table")).toContainText("100,01");
  await navigate(page,"Calendário");
  await expect(page.locator(".day-agenda").getByText("Gravação Aurora",{exact:true})).toBeVisible();
  await navigate(page,"Projetos");
  await expect(page.getByText("Filme Aurora",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"Abrir projeto Filme Aurora",exact:true}).click();
  await expect(page.getByText("Montar primeiro corte",{exact:true})).toBeVisible();
  await page.screenshot({path:info.outputPath("workspace.png"),fullPage:true});
  await logout(page);
  await login(page,"bob-"+info.project.name+"@example.com");
  await expect(page.getByRole("heading",{name:"Seu espaço está pronto"})).toBeVisible();
  await navigate(page,"Clientes");await expect(page.getByText("Estúdio Aurora",{exact:true})).toHaveCount(0);
  await logout(page);await login(page,email,true);
  await navigate(page,"Clientes");await expect(page.getByText("Estúdio Aurora",{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>localStorage.getItem("roteiva-pages-demo-workspace-v1"))).toBeNull();
});
test("popup cancellation is recoverable",async({page})=>{
  await page.goto(cloud);
  const popupPromise=page.waitForEvent("popup");
  await page.getByRole("button",{name:"Entrar com Google",exact:true}).click();
  const popup=await popupPromise;await popup.close();
  await expect(page.getByRole("alert")).toContainText("cancelado");
  await expect(page.getByRole("button",{name:"Entrar com Google",exact:true})).toBeEnabled();
});
test("offline writing shows recovery, never a false cloud confirmation",async({page,context},info)=>{
  await page.goto(cloud);await login(page,"offline-"+info.project.name+"@example.com");
  await navigate(page,"Clientes");
  await page.getByRole("button",{name:"Novo cliente",exact:true}).click();
  await page.getByLabel("Nome do cliente",{exact:true}).fill("Não confirmado");
  await page.getByLabel("Contato principal",{exact:true}).fill("Teste");
  await context.setOffline(true);
  await page.getByRole("button",{name:"Salvar cliente"}).click();
  await expect(page.locator(".cloud-recovery")).toBeVisible({timeout:45000});
  await context.setOffline(false);
  await page.getByRole("button",{name:"Recarregar dados da nuvem",exact:true}).click();
  await expect(page.locator(".app-shell")).toBeVisible();await settled(page);
  await navigate(page,"Clientes");await expect(page.getByText("Não confirmado",{exact:true})).toHaveCount(0);
});
test("Pages stays anonymous and uses the unchanged localStorage key",async({page},info)=>{
  const requests:string[]=[];page.on("request",r=>requests.push(r.url()));
  await page.goto("http://127.0.0.1:4174/roteiva-web/");
  await expect(page.getByText("Modo demonstração",{exact:true})).toBeVisible();
  await expect(page.getByRole("button",{name:"Entrar com Google",exact:true})).toHaveCount(0);
  await navigate(page,"Clientes");
  await page.getByRole("button",{name:"Novo cliente",exact:true}).click();
  await page.getByLabel("Nome do cliente",{exact:true}).fill("Cliente Demo");
  await page.getByLabel("Contato principal",{exact:true}).fill("Teste");
  await page.getByRole("button",{name:"Salvar cliente"}).click();
  await page.reload();await navigate(page,"Clientes");
  await expect(page.getByText("Cliente Demo",{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>localStorage.getItem("roteiva-pages-demo-workspace-v1"))).toContain("Cliente Demo");
  expect(requests.filter(url=>/googleapis.com|127.0.0.1:8080|127.0.0.1:9099/.test(url))).toEqual([]);
  await page.screenshot({path:info.outputPath("demo.png"),fullPage:true});
});
