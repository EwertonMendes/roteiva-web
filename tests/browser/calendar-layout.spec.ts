import {test,expect,type Page} from "./fixtures";

const host="http://127.0.0.1:4173";

async function enterCalendar(page:Page,email:string){
  await page.goto(host);
  await page.getByRole("button",{name:"Criar conta",exact:true}).click();
  const popupPromise=page.waitForEvent("popup");
  await page.getByRole("button",{name:"Cadastrar com Google",exact:true}).click();
  const popup=await popupPromise;
  await popup.waitForLoadState("load");
  await popup.getByRole("button",{name:"Add new account",exact:true}).click();
  await popup.locator("#email-input").fill(email);
  await popup.locator("#display-name-input").fill("Calendário QA");
  await popup.locator("#sign-in").click();
  await page.getByLabel("Como podemos chamar você?").fill("Calendário QA");
  await page.getByLabel("Nome do estúdio ou marca").fill("Estúdio QA");
  await page.getByLabel("Concordo com o uso dos meus dados").check();
  await page.getByRole("button",{name:"Criar meu espaço de trabalho"}).click();
  await expect(page.locator(".app-shell")).toBeVisible();
  const open=page.getByRole("button",{name:"Abrir menu",exact:true});
  if(await open.isVisible())await open.click();
  await page.locator(".sidebar nav").getByRole("button",{name:/^Calendário/}).click();
  await expect(page.locator(".roteiva-calendar")).toBeVisible();
}

test("calendar empty day creation, optional ending, review category, editing and reload",async({page},info)=>{
  await enterCalendar(page,"calendar-flow-"+info.project.name+"@example.com");
  const selected=page.locator(".roteiva-calendar .calendar-grid>button.selected");
  await selected.click();
  const form=page.locator("dialog.roteiva-calendar-form");
  await expect(form).toBeVisible();
  await form.getByLabel("Título do compromisso").fill("Gravação externa — campanha verão");
  await expect(form.getByLabel("Término do compromisso")).toHaveValue("");
  await form.getByRole("combobox",{name:"Tipo de compromisso"}).click();
  await page.getByRole("option",{name:"Revisão"}).click();
  await form.getByRole("button",{name:"Salvar compromisso"}).click();
  await expect(form).toHaveCount(0);
  await expect(page.locator(".roteiva-calendar .calendar-grid>button.selected .calendar-event-counter")).toHaveText("1");

  await selected.click();
  const day=page.locator("dialog.day-events-dialog");
  await expect(day).toBeVisible();
  await expect(day.locator(".calendar-day-record")).toHaveCount(1);
  await expect(day).toContainText("Revisão");
  await expect(day).toContainText("Sem término");
  await day.getByRole("button",{name:/Editar Gravação externa/}).click();

  await expect(form).toBeVisible();
  await form.getByLabel("Término do compromisso").fill("10:00");
  await form.getByRole("button",{name:"Cancelar"}).click();
  await selected.click();
  await expect(day).toContainText("Sem término");
  await day.getByRole("button",{name:/Editar Gravação externa/}).click();
  await form.getByLabel("Término do compromisso").fill("10:00");
  await expect(form.getByLabel("Término do compromisso")).toHaveValue("10:00");
  await form.getByRole("button",{name:"Salvar compromisso"}).click();
  await expect(form).toHaveCount(0);
  await selected.click();
  await expect(day).toContainText("09:00 – 10:00");
  await day.getByRole("button",{name:"Fechar",exact:true}).click();
  // Wait for the cloud command queue; a render update is not a durable write.
  await expect(page.locator(".app-shell")).toHaveAttribute("aria-busy","false");
  await expect(page.locator(".cloud-operation")).toBeHidden();

  await page.reload();
  await expect(page.locator(".roteiva-calendar")).toBeVisible();
  await expect(page.locator(".roteiva-calendar .calendar-grid>button.selected .calendar-event-counter")).toHaveText("1");
  await page.locator(".roteiva-calendar .calendar-grid>button.selected").click();
  await expect(page.locator("dialog.day-events-dialog")).toContainText("09:00 – 10:00");
});

test("calendar grid never overflows and adapts to mobile in both themes",async({page},info)=>{
  await enterCalendar(page,"calendar-grid-"+info.project.name+"@example.com");
  const widths=info.project.name==="mobile"?[390,320]:[1600,1280,1100];
  for(const theme of ["dark","light"]){
    await page.evaluate(value=>{document.documentElement.dataset.theme=value;},theme);
    for(const width of widths){
      await page.setViewportSize({width,height:850});
      const result=await page.evaluate(()=>{
        const grid=document.querySelector(".roteiva-calendar .calendar-grid")!;
        return {
          scroll:document.documentElement.scrollWidth,
          viewport:window.innerWidth,
          count:grid.querySelectorAll(":scope > button").length,
          columns:getComputedStyle(grid).gridTemplateColumns.split(" ").length,
        };
      });
      expect(result.scroll,width+" "+theme+" horizontal overflow").toBeLessThanOrEqual(result.viewport+2);
      expect([28,35,42]).toContain(result.count);
      expect(result.columns).toBe(7);
    }
  }
  await expect(page.getByRole("button",{name:"Exportar cópia"})).toHaveCount(0);
});
