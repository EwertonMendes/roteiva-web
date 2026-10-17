import {test,expect,type Page} from "@playwright/test";

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
  await page.getByLabel("Entendo que meu perfil e os dados de trabalho").check();
  await page.getByRole("button",{name:"Criar meu espaço de trabalho"}).click();
  await expect(page.locator(".app-shell")).toBeVisible();
  await expect(page.locator("[aria-busy]").first()).toHaveAttribute("aria-busy","false");
}

async function fontSize(page:Page,selector:string){
  const target=page.locator(selector).first();
  await expect(target).toBeVisible();
  return target.evaluate(node=>parseFloat(getComputedStyle(node).fontSize));
}

test("typographic scale remains readable and temporary family switching never shrinks text",async({page},info)=>{
  await page.route(/^https:\/\/fonts\.googleapis\.com\/css2\?/,async route=>{
    const name=(new URL(route.request().url()).searchParams.get("family")||"Manrope").split(":")[0].replace(/\+/g," ");
    return route.fulfill({status:200,contentType:"text/css",
      body:`@font-face{font-family:"${name}";font-weight:400 700;src:url("${app}/fonts/ubuntu/Ubuntu-Regular.ttf") format("truetype")}`});
  });
  await enterWorkspace(page,"legibility-"+info.project.name+"@example.com");
  const paragraph=await fontSize(page,".page-heading p");
  const caption=await fontSize(page,".page .eyebrow");
  const heading=await fontSize(page,".page-heading h1");
  const button=await fontSize(page,".page .primary-button");
  expect(paragraph).toBeGreaterThanOrEqual(16);
  expect(caption).toBeGreaterThanOrEqual(13);
  expect(heading).toBeGreaterThanOrEqual(28);
  expect(button).toBeGreaterThanOrEqual(15);
  const selector=page.getByRole("combobox",{name:"Fonte para testar no Roteiva"});
  await selector.selectOption("Manrope");
  await expect.poll(()=>page.evaluate(()=>document.documentElement.style.getPropertyValue("--temporary-roteiva-font"))).toContain("Manrope");
  expect(await fontSize(page,".page-heading p")).toBeCloseTo(paragraph,1);
  expect(await fontSize(page,".page .eyebrow")).toBeCloseTo(caption,1);
  await selector.selectOption("Ubuntu");
  expect(await fontSize(page,".page-heading p")).toBeCloseTo(paragraph,1);
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
  await expect(page.getByRole("combobox",{name:"Fonte para testar no Roteiva"})).toBeVisible();
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
