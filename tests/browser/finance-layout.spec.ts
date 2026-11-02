import {test,expect,type Page} from "./fixtures";

const host="http://127.0.0.1:4173";

async function enterFinance(page:Page,email:string){
  await page.goto(host);
  await page.getByRole("button",{name:"Criar conta",exact:true}).click();
  const popupPromise=page.waitForEvent("popup");
  await page.getByRole("button",{name:"Cadastrar com Google",exact:true}).click();
  const popup=await popupPromise;
  await popup.waitForLoadState("load");
  await popup.getByRole("button",{name:"Add new account",exact:true}).click();
  await popup.locator("#email-input").fill(email);
  await popup.locator("#display-name-input").fill("Financeiro QA");
  await popup.locator("#sign-in").click();
  await page.getByLabel("Como podemos chamar você?").fill("Financeiro QA");
  await page.getByLabel("Nome do estúdio ou marca").fill("Produtora QA");
  await page.getByLabel("Concordo com o uso dos meus dados").check();
  await page.getByRole("button",{name:"Criar meu espaço de trabalho"}).click();
  await expect(page.locator(".app-shell")).toBeVisible();
  await expect(page.locator("[aria-busy]").first()).toHaveAttribute("aria-busy","false");
  const open=page.getByRole("button",{name:"Abrir menu",exact:true});
  if(await open.isVisible())await open.click();
  await page.locator(".sidebar nav").getByRole("button",{name:/^Financeiro/}).click();
  await expect(page.locator(".app-view-finance")).toBeVisible();
}

test("financial mockup uses the viewport evenly in light/dark and on desktop/mobile",async({page},info)=>{
  await enterFinance(page,"finance-layout-"+info.project.name+"@example.com");
  const widths=info.project.name==="mobile"?[390,320]:[1600,1360,1100];
  for(const theme of ["dark","light"] as const){
    await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;},theme);
    for(const width of widths){
      await page.setViewportSize({width,height:850});
      const result=await page.evaluate(()=>{
        const rect=(selector:string)=>document.querySelector(selector)!.getBoundingClientRect();
        const cards=[...document.querySelectorAll(".finance-metrics article")].map(e=>e.getBoundingClientRect());
        const row=[...document.querySelectorAll(".finance-main-grid > *")].map(e=>e.getBoundingClientRect());
        const layout=rect(".finance-layout");
        const page=document.querySelector(".page")!;
        const contentRight=page.getBoundingClientRect().right-parseFloat(getComputedStyle(page).paddingRight);
        const ring=getComputedStyle(document.querySelector<HTMLElement>(".donut")!).backgroundImage;
        return {viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth,
          rightGap:contentRight-layout.right,
          cards:cards.map(c=>({top:c.top,right:c.right,width:c.width})),
          main:row.map(c=>({top:c.top,right:c.right})),
          surface:getComputedStyle(document.querySelector(".finance-filters")!).backgroundColor,
          donut:ring};
      });
      expect(result.scrollWidth,width+" "+theme+" horizontal overflow").toBeLessThanOrEqual(result.viewport+2);
      expect(Math.abs(result.rightGap),width+" "+theme+" right gutter").toBeLessThan(4);
      expect(result.cards).toHaveLength(4);
      expect(result.main).toHaveLength(2);
      expect(result.donut,"No 0% donut seam in "+theme+" at "+width+"px").toBe("none");
      if(width>=1360) {
        expect(Math.max(...result.cards.map(c=>c.top))-Math.min(...result.cards.map(c=>c.top))).toBeLessThan(3);
      } else {
        expect(result.main[1].top).toBeGreaterThan(result.main[0].top);
      }
      if(width===390){
        const scroll=await page.locator(".finance-chart-scroll").evaluate(el=>({scroll:el.scrollWidth,client:el.clientWidth}));
        expect(scroll.scroll).toBeGreaterThan(scroll.client);
      }
    }
  }
  await expect(page.getByRole("heading",{name:"Gestão financeira"})).toBeVisible();
  await expect(page.locator(".finance-metrics article")).toHaveCount(4);
  await expect(page.getByRole("button",{name:"Exportar CSV"})).toBeVisible();
  await expect(page.getByRole("button",{name:"Nova receita"})).toBeVisible();
  await expect(page.getByRole("button",{name:"Exportar cópia"})).toHaveCount(0);
});

test("financial entries, export, edit and month selection survive the new layout",async({page},info)=>{
  await enterFinance(page,"finance-actions-"+info.project.name+"@example.com");
  await page.getByRole("button",{name:"Nova receita"}).click();
  await page.getByLabel("Valor do trabalho").fill("30000");
  await page.getByLabel("Previsão de recebimento").fill(await page.evaluate(()=>new Date().toLocaleDateString("en-CA")));
  await page.locator("form.finance-modal").getByRole("button",{name:"Adicionar lançamento"}).click();
  await expect(page.locator(".finance-table")).toContainText("300,00");
  await expect(page.locator(".finance-metrics .featured")).toContainText("300,00");
  await expect(page.locator(".finance-metrics .finance-result")).toContainText("300,00");
  const csvPromise=page.waitForEvent("download");
  await page.getByRole("button",{name:"Exportar CSV"}).click();
  expect((await csvPromise).suggestedFilename()).toMatch(/^Roteiva-\d{4}-\d{2}\.csv$/);
  await page.locator(".finance-table .edit-revenue-button").first().click();
  await expect(page.getByLabel("Valor do trabalho")).toHaveValue("300,00");
  await page.locator("form.finance-modal").getByRole("button",{name:"Salvar alterações"}).click();
  // Value labels follow their own bar tops, including a zero-value column,
  // rather than occupying an unrelated heading row at the top of the chart.
  const labelPosition=await page.evaluate(()=>{
    const bars=[...document.querySelectorAll<HTMLElement>(".bar-column")];
    const get=(button:HTMLElement)=>{
      const column=button.querySelector<HTMLElement>("i")!;
      const label=button.querySelector<HTMLElement>(".bar-value")!;
      const a=column.getBoundingClientRect(),b=label.getBoundingClientRect();
      return {barTop:a.top,barBottom:a.bottom,labelBottom:b.bottom};
    };
    return {zero:get(bars[0]),active:get(bars.find(b=>b.getAttribute("aria-pressed")==="true")!)};
  });
  for(const position of [labelPosition.zero,labelPosition.active]){
    expect(position.barTop-position.labelBottom,"Value appears just above its own bar").toBeGreaterThan(2);
    expect(position.barTop-position.labelBottom).toBeLessThan(13);
  }
  expect(labelPosition.zero.labelBottom,"Zero values sit near the baseline").toBeGreaterThan(labelPosition.active.labelBottom+35);
  const active=page.locator(".bar-column[aria-pressed='true']");
  await expect(active).toHaveCount(1);
  const scroll=page.locator(".finance-chart-scroll");
  await scroll.scrollIntoViewIfNeeded();
  await scroll.evaluate(node=>{node.scrollLeft=0;});
  const firstBar=page.locator(".bar-column").first();
  const geometry=await firstBar.evaluate(el=>{
    const bar=el.getBoundingClientRect();
    const parent=el.closest(".finance-chart-scroll")!.getBoundingClientRect();
    return {bar:{x:bar.x,y:bar.y,width:bar.width,height:bar.height},
      scroll:{x:parent.x,y:parent.y,width:parent.width,height:parent.height},
      display:getComputedStyle(el).display,visibility:getComputedStyle(el).visibility};
  });
  expect(geometry.bar.width,"Every bar must remain touchable at mobile size").toBeGreaterThan(19);
  expect(geometry.bar.height).toBeGreaterThan(40);
  await firstBar.click();
  await expect(page.locator(".bar-column").first()).toHaveAttribute("aria-pressed","true");
});
