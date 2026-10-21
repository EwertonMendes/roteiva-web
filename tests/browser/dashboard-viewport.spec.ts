import {test,expect,type Page} from "./fixtures";

const base="http://127.0.0.1:4173";

async function createWorkspace(page:Page,email:string) {
  await page.goto(base);
  await page.getByRole("button",{name:"Criar conta",exact:true}).click();
  const popupPromise=page.waitForEvent("popup");
  await page.getByRole("button",{name:"Cadastrar com Google",exact:true}).click();
  const popup=await popupPromise;
  await popup.waitForLoadState("load");
  await popup.getByRole("button",{name:"Add new account",exact:true}).click();
  await popup.locator("#email-input").fill(email);
  await popup.locator("#display-name-input").fill("QA Dashboard");
  await popup.locator("#sign-in").click();
  await page.getByLabel("Como podemos chamar você?").fill("QA Dashboard");
  await page.getByLabel("Nome do estúdio ou marca").fill("Estúdio Teste");
  await page.getByLabel("Concordo com o uso dos meus dados").check();
  await page.getByRole("button",{name:"Criar meu espaço de trabalho"}).click();
  await expect(page.locator(".app-view-overview")).toBeVisible();
  await expect(page.locator("[aria-busy]").first()).toHaveAttribute("aria-busy","false");
}

test("desktop overview fits viewport without page scrolling, even with projects",async({page},info)=>{
  test.skip(info.project.name==="mobile","Desktop-specific viewport contract");
  await createWorkspace(page,"dashboard-viewport-"+info.project.name+"@example.com");
  await page.getByRole("button",{name:"Criar projeto",exact:true}).click();
  await page.getByRole("textbox",{name:"Nome do projeto"}).fill("Projeto de verificação visual");
  await page.locator("form.project-modal").getByRole("button",{name:/Criar projeto/}).click();
  await expect(page.locator("[aria-busy]").first()).toHaveAttribute("aria-busy","false");
  await page.locator(".sidebar nav").getByRole("button",{name:"Visão geral"}).click();
  await expect(page.locator(".flow-overview")).toContainText("O ritmo do seu estúdio");
  await expect(page.locator(".flow-overview")).toContainText("1 projeto no total");
  for(const {width,height} of [
    {width:1920,height:1080},
    {width:1440,height:900},
    {width:1280,height:720},
    {width:1024,height:768},
    {width:1024,height:650},
  ]){
    await page.setViewportSize({width,height});
    const sizes=await page.evaluate(()=>{
      const el=(selector:string)=>document.querySelector(selector)!.getBoundingClientRect();
      return {
        viewportWidth:document.documentElement.clientWidth,
        viewportHeight:document.documentElement.clientHeight,
        bodyHeight:document.body.scrollHeight,
        docHeight:document.documentElement.scrollHeight,
        docWidth:document.documentElement.scrollWidth,
        card:el(".flow-overview"),
        heading:el(".page-heading"),
        activity:el(".flow-recent-activity"),
        sidebar:el(".sidebar"),
        profile:el(".sidebar-profile"),
      };
    });
    expect(sizes.bodyHeight,`body at ${width}x${height}`).toBeLessThanOrEqual(sizes.viewportHeight+2);
    expect(sizes.docHeight,`document at ${width}x${height}`).toBeLessThanOrEqual(sizes.viewportHeight+2);
    expect(sizes.docWidth,`horizontal document at ${width}x${height}`).toBeLessThanOrEqual(sizes.viewportWidth+2);
    expect(sizes.card.bottom,`card bottom at ${width}x${height}`).toBeLessThanOrEqual(sizes.viewportHeight+1);
    expect(sizes.activity.bottom,`activity at ${width}x${height}`).toBeLessThanOrEqual(sizes.viewportHeight+1);
    expect(sizes.activity.top,`activity remains visible at ${width}x${height}`).toBeGreaterThan(sizes.card.top);
    expect(sizes.profile.bottom,`profile at ${width}x${height}`).toBeLessThanOrEqual(sizes.viewportHeight+1);
    expect(sizes.heading.bottom,`heading precedes card at ${width}x${height}`).toBeLessThan(sizes.card.top+1);
  }
  await page.locator(".flow-recent-activity").click();
  await expect(page.locator("#sidebar-activity-panel")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#sidebar-activity-panel")).toHaveCount(0);
});

test("mobile overview remains naturally scrollable and uses Ubuntu",async({page},info)=>{
  test.skip(info.project.name==="desktop","Mobile-specific contract");
  await createWorkspace(page,"dashboard-mobile-"+info.project.name+"@example.com");
  await page.setViewportSize({width:375,height:667});
  await expect(page.locator(".topbar")).toBeVisible();
  await expect(page.locator(".flow-overview")).toBeVisible();
  const result=await page.evaluate(()=>({
    pageOverflow:getComputedStyle(document.querySelector(".app-view-overview .page")!).overflowY,
    font:getComputedStyle(document.body).fontFamily,
    horizontal:document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  expect(result.pageOverflow).not.toBe("hidden");
  expect(result.font).toContain("Ubuntu");
  expect(result.horizontal).toBeLessThanOrEqual(2);
});
