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

test("desktop overview fits viewport without page scrolling",async({page},info)=>{
  test.skip(info.project.name==="mobile","Desktop-specific viewport contract");
  await createWorkspace(page,"dashboard-viewport-"+info.project.name+"@example.com");
  await expect(page.locator(".flow-overview")).toContainText("O ritmo do seu estúdio");
  await expect(page.locator(".flow-overview")).toContainText("0 projetos no total");
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
        activity:el(".flow-activity-preview"),
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
  await page.getByRole("button",{name:"Ver histórico completo"}).click();
  await expect(page.getByRole("dialog",{name:"Histórico de atividades"})).toBeVisible();
  await expect(page.getByRole("button",{name:"Todas"})).toHaveAttribute("aria-pressed","true");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog",{name:"Histórico de atividades"})).toHaveCount(0);
});

test("mobile overview remains naturally scrollable and uses Ubuntu",async({page},info)=>{
  test.skip(info.project.name==="desktop","Mobile-specific contract");
  await createWorkspace(page,"dashboard-mobile-"+info.project.name+"@example.com");
  await page.setViewportSize({width:375,height:667});
  await expect(page.locator(".topbar")).toHaveCount(0);
  await expect(page.getByRole("button",{name:"Abrir menu",exact:true})).toBeVisible();
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

test("workspace page headings share Projects typography and coordinates without changing Dashboard",async({page},info)=>{
 await createWorkspace(page,"page-heading-"+info.project.name+"@example.com");
 const style=async()=>page.locator(".page > .page-heading").evaluate(element=>{
  const title=element.querySelector("h1")!;
  const subtitle=element.querySelector("p")!;
  const heading=element.getBoundingClientRect();
  const titleBox=title.getBoundingClientRect();
  const subtitleBox=subtitle.getBoundingClientRect();
  const a=getComputedStyle(title),b=getComputedStyle(subtitle),h=getComputedStyle(element);
  return {
   headingTop:heading.top,headingLeft:heading.left,
   titleTop:titleBox.top,titleLeft:titleBox.left,subtitleTop:subtitleBox.top,
   titleFont:a.fontSize,titleWeight:a.fontWeight,titleSpacing:a.letterSpacing,
   titleLineHeight:a.lineHeight,titleMargin:a.marginBottom,
   subtitleFont:b.fontSize,subtitleLineHeight:b.lineHeight,
   alignItems:h.alignItems,marginBottom:h.marginBottom,
  };
 });
 const dashboard=await style();
 await page.goto(base+"/projetos");
 await expect(page.locator(".page > .page-heading h1")).toHaveText("Projetos");
 const projects=await style();
 await page.goto(base+"/clientes");
 await expect(page.locator(".page > .page-heading h1")).toHaveText("Clientes");
 const clients=await style();
 for(const property of ["titleFont","titleWeight","titleSpacing","titleLineHeight",
  "titleMargin","subtitleFont","subtitleLineHeight","alignItems","marginBottom"] as const)
  expect(clients[property],property+" matches Projects on "+info.project.name).toBe(projects[property]);
 for(const property of ["headingTop","headingLeft","titleTop","titleLeft","subtitleTop"] as const)
  expect(Math.abs(clients[property]-projects[property]),property+" matches Projects").toBeLessThanOrEqual(1);
 expect(dashboard.titleFont).not.toBe(projects.titleFont);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(2);
});
