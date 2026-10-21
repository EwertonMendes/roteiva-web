import {test,expect,type Page} from "./fixtures";
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
    await page.getByLabel("Concordo com o uso dos meus dados").check();
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
  // The calendar uses civil dates in the browser, not the UTC date of the runner.
  const today=await page.evaluate(()=>{
    const date=new Date();
    return [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
  });
  await expect(page.getByRole("button",{name:"Entrar com Google"})).toBeVisible();
  await expect(page.locator(".app-shell")).toHaveCount(0);
  await page.goto(cloud);
  const email="alice-"+info.project.name+"@example.com";
  await login(page,email);
  await expect(page.getByRole("heading",{name:"O ritmo do seu estúdio"})).toBeVisible();
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
  await page.getByLabel("Previsão de recebimento",{exact:true}).fill(today);
  await page.locator("form.finance-modal").getByRole("button",{name:"Adicionar lançamento"}).click();await settled(page);
  await expect(page.locator(".finance-table")).toContainText("100,01");
  await navigate(page,"Calendário");
  await page.getByRole("button",{name:"Novo compromisso",exact:true}).click();
  await page.getByLabel("Título",{exact:true}).fill("Gravação Aurora");
  await page.getByLabel("Data do trabalho",{exact:true}).fill(today);
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
  await expect(page.getByText("REVISÃO EM BREVE",{exact:true})).toBeVisible();
  await expect(page.getByText("MODO DEMONSTRAÇÃO",{exact:true})).toHaveCount(0);
  await page.screenshot({path:info.outputPath("review.png"),fullPage:true});
  await page.getByRole("link",{name:"Voltar ao painel",exact:true}).click();
  await expect(page.locator(".app-shell")).toBeVisible();await settled(page);
  await logout(page);
  await login(page,"bob-"+info.project.name+"@example.com");
  await expect(page.getByRole("heading",{name:"O ritmo do seu estúdio"})).toBeVisible();
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
  await expect(page.getByRole('button',{name:'Excluir conta',exact:true})).toHaveCount(0);
  await expect(page.getByText('Excluir minha conta',{exact:true})).toHaveCount(0);
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
test("Local demo remains anonymous and never contacts Firebase",async({page},info)=>{
  const requests:string[]=[];page.on("request",r=>requests.push(r.url()));
  await page.goto("http://127.0.0.1:4174/");
  await expect(page.getByText("Modo demonstração",{exact:true})).toBeVisible();
  await expect(page.getByRole("button",{name:"Entrar com Google",exact:true})).toHaveCount(0);
  expect(requests.filter(url=>/googleapis.com|127.0.0.1:8080|127.0.0.1:9099/.test(url))).toEqual([]);
  await page.screenshot({path:info.outputPath("demo.png"),fullPage:true});
});

test("automatic persistent cache is isolated per UID, survives reload and clears on logout",async({page},info)=>{
  await page.goto(cloud);
  await login(page,"cache-"+info.project.name+"@example.com");
  await page.goto(cloud+"/configuracoes");
  await expect(page.getByRole("heading",{name:"Zona de perigo"})).toBeVisible();
  await expect(page.getByRole("button",{name:/Ativar cache|Desativar cache|Exportar cópia/})).toHaveCount(0);
  // Legacy opt-out is deliberately ignored. Persistence is not a user setting.
  await page.evaluate(()=>localStorage.setItem("roteiva-private-cache","disabled"));
  await page.reload();await settled(page);
  await page.goto(cloud+"/clientes");
  await page.getByRole("button",{name:"Novo cliente",exact:true}).click();
  await page.getByLabel("Nome do cliente",{exact:true}).fill("Cliente cache seguro");
  await page.getByLabel("Contato principal",{exact:true}).fill("Contato cache");
  await page.getByRole("button",{name:"Salvar cliente"}).click();await settled(page);
  await page.reload();await settled(page);
  await expect(page.getByText("Cliente cache seguro",{exact:true}).first()).toBeVisible();
  await logout(page);
  await expect.poll(()=>page.evaluate(()=>Object.keys(localStorage).filter(key=>key.startsWith("roteiva-cache-v2:")))).toEqual([]);
  await expect.poll(()=>page.evaluate(()=>localStorage.getItem("roteiva-private-cache"))).toBe(null);
  await login(page,"cache-other-"+info.project.name+"@example.com");
  await page.goto(cloud+"/clientes");
  await expect(page.getByText("Cliente cache seguro",{exact:true})).toHaveCount(0);
});

test("danger zone is separate and red, no export or cache settings remain",async({page},info)=>{
  await page.goto(cloud);
  await login(page,"danger-zone-"+info.project.name+"@example.com");
  await page.goto(cloud+"/configuracoes");
  const zone=page.getByRole("region",{name:"Zona de perigo"});
  await expect(zone).toBeVisible();
  await expect(page.getByText("04 / CONTROLE")).toHaveCount(0);
  await expect(page.getByText("Dados e privacidade")).toHaveCount(0);
  await expect(page.getByRole("button",{name:"Exportar cópia"})).toHaveCount(0);
  await expect(page.getByRole("button",{name:/Ativar cache|Desativar cache/})).toHaveCount(0);
  const button=zone.getByRole("button",{name:"Excluir conta",exact:true});
  await expect(button).toBeEnabled();
  await expect(button).toHaveCSS("background-color","rgb(186, 37, 53)");
  await button.click();
  await expect(page.getByRole("dialog",{name:"Excluir sua conta?"})).toBeVisible();
  await page.getByRole("button",{name:"Cancelar"}).click();
  await expect(page.getByRole("dialog",{name:"Excluir sua conta?"})).toHaveCount(0);
});

test("temporary read disconnection recovers without asking for manual reload",async({page,context},info)=>{
  await page.goto(cloud);
  await login(page,"read-recovery-"+info.project.name+"@example.com");
  await context.setOffline(true);
  await navigate(page,"Clientes");
  // A read failure must never turn into the old manual recovery screen.
  await expect(page.locator(".cloud-recovery")).toHaveCount(0);
  await context.setOffline(false);
  await expect(page.locator(".app-shell")).toBeVisible({timeout:45000});
  await settled(page);
  await expect(page.getByRole("heading",{name:"Clientes",exact:true})).toBeVisible();
});
