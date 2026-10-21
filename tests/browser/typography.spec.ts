import {test,expect,type Page} from "./fixtures";

const app="http://127.0.0.1:4173";

async function enterWorkspace(page:Page,email:string){
  await page.goto(app);
  await page.getByRole("button",{name:"Criar conta",exact:true}).click();
  const popupPromise=page.waitForEvent("popup");
  await page.getByRole("button",{name:"Cadastrar com Google",exact:true}).click();
  const popup=await popupPromise;
  await popup.waitForLoadState("load");
  await popup.getByRole("button",{name:"Add new account",exact:true}).click();
  await popup.locator("#email-input").fill(email);
  await popup.locator("#display-name-input").fill("Tipografia QA");
  await popup.locator("#sign-in").click();
  await page.getByLabel("Como podemos chamar você?").fill("Teste Tipografia");
  await page.getByLabel("Nome do estúdio ou marca").fill("Studio Legível");
  await page.getByLabel("Concordo com o uso dos meus dados").check();
  await page.getByRole("button",{name:"Criar meu espaço de trabalho"}).click();
  await expect(page.locator(".app-shell")).toBeVisible();
  await expect(page.locator("[aria-busy]").first()).toHaveAttribute("aria-busy","false");
}

async function fontSize(page:Page,selector:string){
  const target=page.locator(selector).first();
  await expect(target).toBeVisible();
  return target.evaluate(node=>parseFloat(getComputedStyle(node).fontSize));
}

test("Ubuntu remains the only app font and typography stays readable",async({page},info)=>{
  await enterWorkspace(page,"legibility-"+info.project.name+"@example.com");
  await expect(page.getByRole("combobox",{name:"Fonte para testar no Roteiva"})).toHaveCount(0);
  const paragraph=await fontSize(page,".page-heading p");
  const caption=await fontSize(page,".flow-overview-head .eyebrow");
  const heading=await fontSize(page,".page-heading h1");
  const button=await fontSize(page,".page .primary-button");
  expect(paragraph).toBeGreaterThanOrEqual(16);
  expect(caption).toBeGreaterThanOrEqual(13);
  expect(heading).toBeGreaterThanOrEqual(28);
  expect(button).toBeGreaterThanOrEqual(15);
  const family=await page.locator(".app-shell").evaluate(node=>getComputedStyle(node).fontFamily);
  expect(family).toContain("Ubuntu");
  await page.goto(app+"/projetos");
  await expect(page.locator(".app-shell")).toBeVisible();
  expect(await page.locator(".app-shell").evaluate(node=>getComputedStyle(node).fontFamily)).toContain("Ubuntu");
});

test("mobile layout remains navigable with enlarged content and respects user font scale",async({page},info)=>{
  await enterWorkspace(page,"readable-mobile-"+info.project.name+"@example.com");
  if(info.project.name==="mobile"){
    await page.setViewportSize({width:320,height:720});
    await expect(page.locator(".topbar")).toBeVisible();
    await expect(page.locator(".mobile-bottom-nav")).toBeVisible();
    expect(await fontSize(page,".mobile-bottom-nav button.active")).toBeGreaterThanOrEqual(13);
  }else{
    await page.setViewportSize({width:800,height:900});
  }
  await page.evaluate(()=>{document.documentElement.style.fontSize="125%";});
  await expect.poll(()=>fontSize(page,".page-heading p")).toBeGreaterThanOrEqual(19);
  await expect(page.getByRole("combobox",{name:"Fonte para testar no Roteiva"})).toHaveCount(0);
  const overflow=await page.evaluate(()=>({
    width:document.documentElement.clientWidth,
    scroll:document.documentElement.scrollWidth,
  }));
  expect(overflow.scroll).toBeLessThanOrEqual(overflow.width+4);
  await page.evaluate(()=>{document.documentElement.style.removeProperty("font-size");});
});

test("settings forms stay at 16px or larger on mobile",async({page},info)=>{
  await enterWorkspace(page,"settings-legibility-"+info.project.name+"@example.com");
  await page.goto(app+"/configuracoes");
  await expect(page.locator(".settings-layout")).toBeVisible();
  const field=page.locator(".settings-field input").first();
  await expect(field).toBeVisible();
  expect(await field.evaluate(e=>parseFloat(getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(16);
  const helper=page.locator(".settings-field small").first();
  if(await helper.count()){
    expect(await helper.evaluate(e=>parseFloat(getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(14);
  }
});

test("sidebar logo always loads from site root on nested Firebase routes and in both themes",async({page},info)=>{
  await enterWorkspace(page,"logo-base-"+info.project.name+"@example.com");
  const logo=page.locator(".brand-lockup img");
  await expect(logo).toHaveAttribute("src",/^\/roteiva-logo-(black|white)\.png$/);
  await expect.poll(()=>logo.evaluate((img:HTMLImageElement)=>img.complete && img.naturalWidth>0)).toBe(true);
  await page.goto(app+"/projetos/123");
  await expect(page.locator(".app-shell")).toBeVisible();
  await expect(logo).toHaveAttribute("src",/^\/roteiva-logo-(black|white)\.png$/);
  await expect.poll(()=>logo.evaluate((img:HTMLImageElement)=>img.complete && img.naturalWidth>0)).toBe(true);
  await page.reload();
  await expect(logo).toHaveAttribute("src",/^\/roteiva-logo-(black|white)\.png$/);
  await expect.poll(()=>logo.evaluate((img:HTMLImageElement)=>img.complete && img.naturalWidth>0)).toBe(true);
  if(info.project.name==="desktop"){
    await page.getByRole("button",{name:"Ativar modo escuro"}).click();
    await expect(logo).toHaveAttribute("src","/roteiva-logo-white.png");
    await expect.poll(()=>logo.evaluate((img:HTMLImageElement)=>img.complete && img.naturalWidth>0)).toBe(true);
  }
});

test("local demo loads its logo from the site root, without the retired Pages prefix",async({page})=>{
  await page.goto("http://127.0.0.1:4174/");
  const logo=page.locator(".brand-lockup img");
  await expect(logo).toBeVisible();
  await expect(logo).toHaveAttribute("src",/^\/roteiva-logo-(black|white)\.png$/);
  await expect.poll(()=>logo.evaluate((img:HTMLImageElement)=>img.complete && img.naturalWidth>0)).toBe(true);
});

test("sidebar has no redundant workspace card and keeps user profile anchored", async ({page},info) => {
  await enterWorkspace(page, "sidebar-clean-" + info.project.name + "@example.com");
  const sidebar = page.locator(".sidebar");
  await expect(sidebar.locator(".storage-card")).toHaveCount(0);
  await expect(sidebar.getByText("Seu espaço de produção")).toHaveCount(0);
  const profile = sidebar.locator(".sidebar-profile");
  if(info.project.name === "mobile"){
    await page.getByRole("button", {name:"Abrir menu"}).click();
  }
  await expect(profile).toBeVisible();
  await expect(sidebar.getByRole("navigation")).toBeVisible();
  const offsets = await profile.evaluate(node => {
    const el = node as HTMLElement;
    const container = el.closest(".sidebar") as HTMLElement;
    return {profileBottom:el.getBoundingClientRect().bottom, sidebarBottom:container.getBoundingClientRect().bottom};
  });
  expect(offsets.sidebarBottom - offsets.profileBottom).toBeGreaterThanOrEqual(0);
  expect(offsets.sidebarBottom - offsets.profileBottom).toBeLessThanOrEqual(40);
});
