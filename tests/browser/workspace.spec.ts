import {test,expect,type Page} from "@playwright/test";
import {readFile} from "node:fs/promises";
const cloud="http://127.0.0.1:4173";
async function googlePopup(page:Page,email:string,existing=false) {
  const popupPromise=page.waitForEvent("popup");
  await page.getByRole("button",{name:existing?"Entrar com Google":"Cadastrar com Google",exact:true}).click();
  const popup=await popupPromise;
  await popup.waitForLoadState("load");
  if(existing) await popup.getByText(email,{exact:true}).click();
  else {
    await popup.getByRole("button",{name:"Add new account",exact:true}).click();
    await popup.locator("#email-input").fill(email);
    await popup.locator("#display-name-input").fill("Profissional de teste");
    await popup.locator("#sign-in").click();
  }
}
async function login(page:Page,email:string,existing=false) {
  if(!existing) await page.getByRole("button",{name:"Criar conta",exact:true}).click();
  await googlePopup(page,email,existing);
  if(!existing) {
    await expect(page.getByRole("heading",{name:"Vamos deixar tudo com a sua cara."})).toBeVisible();
    await expect(page.locator(".app-shell")).toHaveCount(0);
    await page.getByLabel("Como podemos chamar você?").fill("Profissional de teste");
    await page.getByLabel("Nome do estúdio ou marca").fill("Estúdio de QA");
    await page.getByLabel("Entendo que meu perfil e os dados de trabalho").check();
    await page.getByRole("button",{name:"Criar meu espaço de trabalho"}).click();
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
  const taskField=page.getByLabel("Nova tarefa",{exact:true});
  // Mobile: ensure the checklist below the long project form is actually in view.
  // A synthetic fill on an off-screen input can appear to complete without typing.
  await taskField.scrollIntoViewIfNeeded();
  await taskField.click();
  await taskField.pressSequentially("Montar primeiro corte");
  await expect(taskField).toHaveValue("Montar primeiro corte");
  await page.getByRole("button",{name:"Adicionar tarefa",exact:true}).click();await settled(page);
  await expect(page.getByText("Montar primeiro corte",{exact:true})).toBeVisible();
  await navigate(page,"Financeiro");
  await page.getByRole("button",{name:"Nova receita",exact:true}).click();
  await page.getByLabel("Valor do trabalho").fill("0");
  await page.locator("form.finance-modal").getByRole("button",{name:"Adicionar lançamento"}).click();
  await expect(page.locator(".toast")).toContainText("Informe um valor válido");
  await expect(page.locator("form.finance-modal")).toBeVisible();
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
  await page.goto(cloud+"/review");
  await expect(page.getByText("ROTEIVA DEV · REVISÃO EM BREVE",{exact:true})).toBeVisible();
  await expect(page.getByText("MODO DEMONSTRAÇÃO",{exact:true})).toHaveCount(0);
  await page.screenshot({path:info.outputPath("review.png"),fullPage:true});
  await page.getByRole("link",{name:"Voltar ao painel",exact:true}).click();
  await expect(page.locator(".app-shell")).toBeVisible();await settled(page);
  await logout(page);
  await login(page,"bob-"+info.project.name+"@example.com");
  await expect(page.getByRole("heading",{name:"Seu espaço está pronto"})).toBeVisible();
  await navigate(page,"Clientes");await expect(page.getByText("Estúdio Aurora",{exact:true})).toHaveCount(0);
  await logout(page);await login(page,email,true);
  await navigate(page,"Clientes");await expect(page.getByText("Estúdio Aurora",{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>localStorage.getItem("roteiva-pages-demo-workspace-v1"))).toBeNull();
});
test("Account and studio settings persist without changing existing projects",async({page},info)=>{
  await page.goto(cloud);
  const email="settings-"+info.project.name+"@example.com";
  await login(page,email);
  await expect(page.locator(".workspace-switch")).toContainText("Estúdio de QA");
  await navigate(page,"Projetos");
  await page.locator(".heading-actions").getByRole("button",{name:"Criar projeto",exact:true}).click();
  await page.getByLabel("Nome do projeto",{exact:true}).fill("Projeto mantido");
  await page.locator("form.project-modal").getByRole("button",{name:"Criar projeto",exact:true}).click();
  await settled(page);
  await navigate(page,"Configurações");
  await expect(page.getByRole("heading",{name:"Perfil profissional"})).toBeVisible();
  await expect(page.getByLabel("E-mail de acesso")).toHaveValue(email);
  await page.getByLabel("Nome profissional",{exact:true}).fill("Direção Criativa");
  await page.getByLabel("Nome do estúdio ou marca",{exact:true}).fill("Estúdio dos Crias");
  await page.getByLabel("Tipo de atuação").selectOption("producer");
  await page.getByRole("button",{name:"Salvar alterações"}).click();
  await expect(page.getByRole("status").filter({hasText:"Perfil e estúdio salvos na nuvem."})).toBeVisible();
  await expect(page.locator(".workspace-switch")).toContainText("Estúdio dos Crias");
  await page.screenshot({path:info.outputPath("settings.png"),fullPage:true});
  await page.getByRole("button",{name:"Escuro",exact:true}).click();
  await settled(page);
  await expect(page.locator("html")).toHaveAttribute("data-theme","dark");
  await page.reload();
  await expect(page.locator(".app-shell")).toBeVisible();await settled(page);
  await navigate(page,"Configurações");
  await expect(page.getByLabel("Nome profissional",{exact:true})).toHaveValue("Direção Criativa");
  await expect(page.getByLabel("Nome do estúdio ou marca",{exact:true})).toHaveValue("Estúdio dos Crias");
  await expect(page.getByLabel("Tipo de atuação")).toHaveValue("producer");
  await expect(page.locator(".workspace-switch")).toContainText("Estúdio dos Crias");
  await expect(page.locator("html")).toHaveAttribute("data-theme","dark");
  await expect(page.getByLabel("E-mail de acesso")).toHaveAttribute("readonly","");
  await navigate(page,"Projetos");
  await expect(page.getByText("Projeto mantido",{exact:true})).toBeVisible();
});
test("Direct routes, refresh and browser Back/Forward preserve each user's screen",async({page},info)=>{
  const email="routes-"+info.project.name+"@example.com";
  await page.goto(cloud+"/clientes");
  await login(page,email);
  await expect(page).toHaveURL(cloud+"/clientes");
  await expect(page.getByRole("heading",{name:"Clientes",exact:true})).toBeVisible();
  await page.reload();await settled(page);
  await expect(page).toHaveURL(cloud+"/clientes");

  await navigate(page,"Projetos");
  await expect(page).toHaveURL(cloud+"/projetos");
  await page.locator(".heading-actions").getByRole("button",{name:"Criar projeto",exact:true}).click();
  await page.getByLabel("Nome do projeto",{exact:true}).fill("Projeto com URL");
  await page.locator("form.project-modal").getByRole("button",{name:"Criar projeto",exact:true}).click();
  await settled(page);
  await expect(page.locator(".cloud-banner")).toContainText("Salvo na nuvem");
  await expect(page).toHaveURL(new RegExp("/projetos/[1-9][0-9]*$"));
  const projectURL=page.url();
  await expect(page.getByLabel("Nova tarefa",{exact:true})).toBeVisible();
  await page.reload();await settled(page);
  await expect(page).toHaveURL(projectURL);
  await expect(page.getByLabel("Nova tarefa",{exact:true})).toBeVisible();

  await page.goBack();await settled(page);
  await expect(page).toHaveURL(cloud+"/projetos");
  await expect(page.getByText("Projeto com URL",{exact:true})).toBeVisible();
  await page.goForward();await settled(page);
  await expect(page).toHaveURL(projectURL);
  await expect(page.getByLabel("Nova tarefa",{exact:true})).toBeVisible();

  await navigate(page,"Clientes");
  await page.getByRole("button",{name:"Novo cliente",exact:true}).click();
  await page.getByLabel("Nome do cliente",{exact:true}).fill("Cliente com URL");
  await page.getByLabel("Contato principal",{exact:true}).fill("Contato de teste");
  await page.getByRole("button",{name:"Salvar cliente"}).click();await settled(page);
  await expect(page.locator(".cloud-banner")).toContainText("Salvo na nuvem");
  await page.locator(".client-list button").filter({hasText:"Cliente com URL"}).click();
  await expect(page).toHaveURL(new RegExp("/clientes/[1-9][0-9]*$"));
  const clientURL=page.url();
  await page.reload();await settled(page);
  await expect(page).toHaveURL(clientURL);
  await expect(page.getByText("Cliente com URL",{exact:true}).first()).toBeVisible();

  await navigate(page,"Configurações");
  await expect(page).toHaveURL(cloud+"/configuracoes");
  await page.reload();await settled(page);
  await expect(page.getByRole("heading",{name:"Perfil profissional"})).toBeVisible();
  await page.goBack();await settled(page);
  await expect(page).toHaveURL(clientURL);
  await page.goForward();await settled(page);
  await expect(page).toHaveURL(cloud+"/configuracoes");

  // A private URL from account A must never be shown as account B's data.
  await logout(page);
  await expect(page).toHaveURL(cloud+"/");
  await page.goto(projectURL);
  const second="other-routes-"+info.project.name+"@example.com";
  await login(page,second);
  await expect(page).toHaveURL(cloud+"/projetos");
  await expect(page.getByText("Projeto com URL",{exact:true})).toHaveCount(0);
});
test("First login does not silently create a workspace",async({page},info)=>{
  await page.goto(cloud);
  // Capture the actual login screen, not the Roteiva intro animation.
  await expect(page.locator(".brand-intro")).toHaveCount(0);
  await page.screenshot({path:info.outputPath("login-screen.png"),fullPage:true});
  const email="unregistered-"+info.project.name+"@example.com";
  const popupPromise=page.waitForEvent("popup");
  await page.getByRole("button",{name:"Entrar com Google",exact:true}).click();
  const popup=await popupPromise;
  await popup.waitForLoadState("load");
  await popup.getByRole("button",{name:"Add new account",exact:true}).click();
  await popup.locator("#email-input").fill(email);
  await popup.locator("#display-name-input").fill("Novo profissional");
  await popup.locator("#sign-in").click();
  await expect(page.getByRole("heading",{name:"Ainda não encontramos seu espaço."})).toBeVisible();
  await expect(page.locator(".auth-invitation")).toHaveText("Se quiser começar, vamos cadastrar seu perfil e preparar um espaço privado.");
  await expect(page.getByText("Nenhuma conta foi criada no Roteiva.")).toHaveCount(0);
  await expect(page.locator(".app-shell")).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading",{name:"Ainda não encontramos seu espaço."})).toBeVisible();
  await page.getByRole("button",{name:"Criar meu espaço",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Vamos deixar tudo com a sua cara."})).toBeVisible();
  await page.screenshot({path:info.outputPath("registration-screen.png"),fullPage:true});
  // Validate both palettes without changing persisted profile data.
  await page.evaluate(()=>document.documentElement.setAttribute("data-theme","dark"));
  await page.screenshot({path:info.outputPath("registration-dark.png"),fullPage:true});
  await page.evaluate(()=>document.documentElement.setAttribute("data-theme","light"));
  await expect(page.getByRole("button",{name:"Criar meu espaço de trabalho"})).toBeDisabled();
  await page.getByRole("button",{name:"Sair sem criar conta"}).click();
  await expect(page.getByRole("button",{name:"Entrar com Google",exact:true})).toBeVisible();
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
  await expect(page).toHaveURL(new RegExp("/roteiva-web/#/clientes$"));
  await page.reload();
  await expect(page.getByRole("heading",{name:"Clientes",exact:true})).toBeVisible();
  await expect(page).toHaveURL(new RegExp("/roteiva-web/#/clientes$"));
  await page.goBack();
  await expect(page).toHaveURL(new RegExp("/roteiva-web/(#/clientes)?$"));
  await page.goto("http://127.0.0.1:4174/roteiva-web/#/clientes");
  await expect(page.getByRole("heading",{name:"Clientes",exact:true})).toBeVisible();
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

test("persistent cache is opt-in, survives refresh, and is cleared on logout",async({page},info)=>{
  await page.goto(cloud);
  await login(page,"cache-"+info.project.name+"@example.com");
  await page.goto(cloud+"/configuracoes");
  await expect(page.getByRole("button",{name:"Ativar cache"})).toBeVisible();
  await page.getByRole("button",{name:"Ativar cache"}).click();
  await expect(page.locator(".app-shell")).toBeVisible();
  await expect(page.getByRole("button",{name:"Desativar cache"})).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>localStorage.getItem("roteiva-private-cache"))).toBe("enabled");
  await page.goto(cloud+"/clientes");
  await page.getByRole("button",{name:"Novo cliente",exact:true}).click();
  await page.getByLabel("Nome do cliente",{exact:true}).fill("Cliente cache seguro");
  await page.getByLabel("Contato principal",{exact:true}).fill("Contato cache");
  await page.getByRole("button",{name:"Salvar cliente"}).click();await settled(page);
  await page.reload();await settled(page);
  await expect(page.getByText("Cliente cache seguro",{exact:true}).first()).toBeVisible();
  await logout(page);
  await expect.poll(()=>page.evaluate(()=>localStorage.getItem("roteiva-private-cache"))).toBe("enabled");
  // On shared browsers the opted-in setting remains, but account data is cleared.
  await login(page,"cache-other-"+info.project.name+"@example.com");
  await page.goto(cloud+"/clientes");
  await expect(page.getByText("Cliente cache seguro",{exact:true})).toHaveCount(0);
  await page.goto(cloud+"/configuracoes");
  await page.getByRole("button",{name:"Desativar cache"}).click();
  await expect(page.getByRole("button",{name:"Ativar cache"})).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>localStorage.getItem("roteiva-private-cache"))).toBe("disabled");
});

test("settings deep link defers business loading but exports complete records on demand",async({page},info)=>{
  await page.goto(cloud);
  await login(page,"settings-lazy-"+info.project.name+"@example.com");
  await navigate(page,"Clientes");
  await page.getByRole("button",{name:"Novo cliente",exact:true}).click();
  await page.getByLabel("Nome do cliente",{exact:true}).fill("Registro preservado na exportação");
  await page.getByLabel("Contato principal",{exact:true}).fill("Teste de carga");
  await page.getByRole("button",{name:"Salvar cliente"}).click();await settled(page);
  await page.goto(cloud+"/configuracoes");
  await expect(page.getByRole("heading",{name:"Perfil profissional"})).toBeVisible();
  const promise=page.waitForEvent("download");
  await page.getByRole("button",{name:"Exportar cópia"}).last().click();
  const download=await promise;
  const contents=await readFile(await download.path(),"utf8");
  expect(contents).toContain("Registro preservado na exportação");
  await navigate(page,"Clientes");
  await expect(page.getByText("Registro preservado na exportação",{exact:true}).first()).toBeVisible();
});
