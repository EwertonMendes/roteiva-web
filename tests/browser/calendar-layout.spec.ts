import {test,expect,type Page} from "./fixtures";
import {expectCompactConfirmationGeometry} from "./compact-confirmation-geometry";

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
  // Route transitions temporarily mount a 100vh loading screen alongside
  // the inert workspace. Measure only after that transition is complete.
  await expect(page.locator(".studio-loading")).toHaveCount(0);
  await expect(page.locator("[inert]")).toHaveCount(0);
}

test("calendar empty day creation, optional ending, review category, editing and reload",async({page},info)=>{
  await enterCalendar(page,"calendar-flow-"+info.project.name+"@example.com");
  const selected=page.locator(".roteiva-calendar .calendar-grid>button.selected");
  await selected.click();
  const form=page.locator("dialog.roteiva-calendar-form");
  await expect(form).toBeVisible();
  await form.getByLabel("Título do compromisso").fill("Gravação externa — campanha verão");
  await expect(form.getByRole("textbox",{name:"Término do compromisso"})).toHaveValue("");
  await form.getByRole("combobox",{name:"Tipo de compromisso"}).click();
  await page.getByRole("option",{name:"Revisão"}).click();
  await form.getByRole("button",{name:"Salvar compromisso"}).click();
  await expect(form).toHaveCount(0);
  await expect(page.locator(".rt-toast--success")).toContainText("Compromisso salvo.");
  await expect(page.locator(".toast")).toHaveCount(1);
  await expect(page.locator(".cloud-operation")).toHaveCount(0);
  await expect(page.locator(".roteiva-calendar .calendar-grid>button.selected .calendar-event-counter")).toHaveText("1");

  await selected.click();
  const day=page.locator("dialog.day-events-dialog");
  await expect(day).toBeVisible();
  await expect(day.locator(".calendar-day-record")).toHaveCount(1);
  await expect(day.locator(".calendar-day-footer")).toHaveCount(0);
  await expect(day.getByRole("button",{name:"Fechar",exact:true})).toHaveCount(0);
  await expect(day).toContainText("Revisão");
  await expect(day).toContainText("Sem término");
  await day.getByRole("button",{name:/Editar Gravação externa/}).click();

  await expect(form).toBeVisible();
  await form.getByRole("textbox",{name:"Término do compromisso"}).fill("10:00");
  await form.getByRole("button",{name:"Cancelar"}).click();
  await expect(day).toBeVisible();
  await expect(day).toContainText("Sem término");
  await day.getByRole("button",{name:/Editar Gravação externa/}).click();
  await form.getByRole("textbox",{name:"Término do compromisso"}).fill("10:00");
  await expect(form.getByRole("textbox",{name:"Término do compromisso"})).toHaveValue("10:00");
  await form.getByRole("button",{name:"Salvar compromisso"}).click();
  await expect(form).toHaveCount(0);
  await expect(day).toBeVisible();
  await expect(day).toContainText("09:00 – 10:00");
  await day.getByRole("button",{name:"Fechar compromissos do dia"}).click();
  // Wait for the cloud command queue; a render update is not a durable write.
  await expect(page.locator("[aria-busy]").first()).toHaveAttribute("aria-busy","false");
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


test("date/time controls use Roteiva popovers, align fields and preserve keyboard editing",async({page},info)=>{
  await enterCalendar(page,"calendar-pickers-"+info.project.name+"@example.com");
  await page.getByRole("button",{name:"Novo compromisso",exact:true}).first().click();
  const form=page.locator("dialog.roteiva-calendar-form");
  await expect(form).toBeVisible();
  const date=form.getByRole("textbox",{name:"Data do compromisso"});
  const start=form.getByRole("textbox",{name:"Início do compromisso"});
  const end=form.getByRole("textbox",{name:"Término do compromisso"});
  await expect(date).toHaveAttribute("type","text");
  await expect(start).toHaveAttribute("type","text");
  await expect(end).toHaveAttribute("type","text");
  await form.getByRole("button",{name:"Abrir calendário de data"}).click();
  const datePicker=form.getByRole("dialog",{name:"Escolher data"});
  await expect(datePicker).toBeVisible();
  await datePicker.locator("button.today").first().click();
  await expect(date).toHaveValue(/^\d{2}\/\d{2}\/\d{4}$/);
  await date.fill("20/11/2026");
  await expect(date).toHaveValue("20/11/2026");
  await form.getByRole("button",{name:"Escolher início do compromisso"}).click();
  const startPicker=form.getByRole("dialog",{name:"Selecionar início do compromisso"});
  await expect(startPicker).toBeVisible();
  await startPicker.getByRole("group",{name:"Horas"}).getByRole("button",{name:"11",exact:true}).click();
  await startPicker.getByRole("group",{name:"Minutos"}).getByRole("button",{name:"30",exact:true}).click();
  await startPicker.getByRole("button",{name:"Concluir"}).click();
  await expect(start).toHaveValue("11:30");
  await form.getByRole("button",{name:"Escolher término do compromisso"}).click();
  const endPicker=form.getByRole("dialog",{name:"Selecionar término do compromisso"});
  await expect(endPicker).toBeVisible();
  await endPicker.getByRole("group",{name:"Horas"}).getByRole("button",{name:"12",exact:true}).click();
  await endPicker.getByRole("group",{name:"Minutos"}).getByRole("button",{name:"00",exact:true}).click();
  await endPicker.getByRole("button",{name:"Concluir"}).click();
  await expect(end).toHaveValue("12:00");
  const fields=await form.locator(".calendar-datetime-field").evaluateAll(els=>els.map(el=>{
    const caption=el.querySelector(".calendar-field-caption")!.getBoundingClientRect();
    const control=el.querySelector(".calendar-picker-control")!.getBoundingClientRect();
    return {labelY:caption.y,labelHeight:caption.height,y:control.y,height:control.height};
  }));
  expect(fields).toHaveLength(3);
  expect(Math.abs(fields[1].y-fields[2].y)).toBeLessThan(2);
  expect(Math.abs(fields[0].height-fields[2].height)).toBeLessThan(2);
  if(info.project.name==="desktop")expect(Math.abs(fields[0].y-fields[1].y)).toBeLessThan(2);
  await form.getByRole("button",{name:"Cancelar"}).click();
  await expect(form).toHaveCount(0);
});

test("desktop calendar fits the viewport and scrolls only upcoming events",async({page},info)=>{
  if(info.project.name==="mobile")return;
  await enterCalendar(page,"calendar-height-"+info.project.name+"@example.com");
  for(const [width,height] of [[1700,900],[1440,800],[1280,760]]){
    await page.setViewportSize({width,height});
    const measured=await page.evaluate(()=>{
      const main=document.querySelector(".app-view-calendar .main")!.getBoundingClientRect();
      const grid=document.querySelector(".roteiva-calendar .calendar-grid")!.getBoundingClientRect();
      const upcoming=document.querySelector(".roteiva-calendar .upcoming-scroll")!;
      const cells=[...document.querySelectorAll(".roteiva-calendar .calendar-grid>button")].map(el=>el.getBoundingClientRect());
      return {
        viewport:innerHeight,scrollHeight:document.documentElement.scrollHeight,
        mainBottom:main.bottom,gridBottom:grid.bottom,lastCellBottom:cells.at(-1)!.bottom,
        upcomingOverflow:getComputedStyle(upcoming).overflowY,
      };
    });
    expect(measured.scrollHeight,"no document scroll at "+width+"x"+height).toBeLessThanOrEqual(height+2);
    expect(measured.mainBottom).toBeLessThanOrEqual(height+2);
    expect(measured.gridBottom).toBeLessThanOrEqual(height+2);
    expect(measured.lastCellBottom).toBeLessThanOrEqual(measured.gridBottom+1);
    expect(measured.upcomingOverflow).toBe("auto");
  }
});


test("masked times, invalid dates, inline validation and label spacing on desktop/mobile",async({page},info)=>{
  await enterCalendar(page,"calendar-validation-"+info.project.name+"@example.com");
  await page.getByRole("button",{name:"Novo compromisso",exact:true}).first().click();
  const form=page.locator("dialog.roteiva-calendar-form");
  const title=form.getByRole("textbox",{name:"Título do compromisso"});
  const date=form.getByRole("textbox",{name:"Data do compromisso"});
  const start=form.getByRole("textbox",{name:"Início do compromisso"});
  const end=form.getByRole("textbox",{name:"Término do compromisso"});
  await title.fill("Teste de validação");

  // Regression: raw numeric strings from phone numeric keyboards must be formatted.
  await start.fill("");
  await start.pressSequentially("0922");
  await expect(start).toHaveValue("09:22");
  await end.fill("12221");
  await expect(end).toHaveValue("12:22");
  await end.fill("2460");
  await end.blur();
  await expect(end).toHaveAttribute("aria-invalid","true");
  await expect(form).toContainText("Horário inválido.");
  await form.getByRole("button",{name:"Salvar compromisso"}).click();
  await expect(form).toBeVisible();

  // Cross-field check: an otherwise valid end must be strictly after start.
  await end.fill("0810");
  await end.blur();
  await expect(end).toHaveValue("08:10");
  await expect(end).toHaveAttribute("aria-invalid","true");
  await expect(form).toContainText("O término precisa ser após o início.");
  await end.fill("1030");
  await end.blur();
  await expect(end).toHaveValue("10:30");
  await expect(end).toHaveAttribute("aria-invalid","false");

  await date.fill("31/02/2026");
  await date.blur();
  await expect(date).toHaveAttribute("aria-invalid","true");
  await expect(form).toContainText("Data inválida.");
  await form.getByRole("button",{name:"Salvar compromisso"}).click();
  await expect(form).toBeVisible();
  await date.fill("16/12/2222");
  await date.blur();
  await expect(date).toHaveAttribute("aria-invalid","true");
  await date.fill("29/02/2028");
  await date.blur();
  await expect(date).toHaveValue("29/02/2028");
  await expect(date).toHaveAttribute("aria-invalid","false");

  // Invalid state reserves room for feedback instead of shifting modal controls.
  const measurements=await form.evaluate(root=>{
    const basic=[...root.querySelectorAll(".calendar-form-basic>.calendar-basic-field")];
    const link=root.querySelector(".calendar-link-fields>label")!;
    function gap(el:Element,control:Element){
      const range=document.createRange();
      range.selectNodeContents(el.firstChild!);
      return control.getBoundingClientRect().top-range.getBoundingClientRect().bottom;
    }
    const first=basic[0],second=basic[1];
    const field=first.querySelector("input")!;
    const secondField=second.querySelector(".calendar-field-with-icon")!;
    const linkField=link.querySelector(".calendar-field-with-icon")!;
    const row=[...root.querySelectorAll(".calendar-datetime-field .calendar-picker-control")];
    return {
      titleGap:gap(first,field),typeGap:gap(second,secondField),clientGap:gap(link,linkField),
      startHeight:row[1].getBoundingClientRect().height,
      endHeight:row[2].getBoundingClientRect().height,
      dialogWidth:root.getBoundingClientRect().width,
      viewport:window.innerWidth,
      maxScroll:document.documentElement.scrollWidth,
    };
  });
  expect(measurements.titleGap).toBeGreaterThanOrEqual(8);
  expect(measurements.typeGap).toBeGreaterThanOrEqual(8);
  expect(Math.abs(measurements.titleGap-measurements.clientGap)).toBeLessThan(3);
  expect(Math.abs(measurements.typeGap-measurements.clientGap)).toBeLessThan(3);
  expect(Math.abs(measurements.startHeight-measurements.endHeight)).toBeLessThan(2);
  expect(measurements.dialogWidth).toBeLessThanOrEqual(measurements.viewport);
  expect(measurements.maxScroll).toBeLessThanOrEqual(measurements.viewport+2);
  await form.getByRole("button",{name:"Salvar compromisso"}).click();
  await expect(form).toHaveCount(0);
});


test("nested day/editor/confirmation dialogs keep the underlying day and lock background",async({page},info)=>{
  await enterCalendar(page,"calendar-modal-stack-"+info.project.name+"@example.com");
  const selected=page.locator(".roteiva-calendar .calendar-grid>button.selected");
  await selected.click();
  const editor=page.locator("dialog.roteiva-calendar-form");
  await expect(editor).toBeVisible();
  await editor.getByLabel("Título do compromisso").fill("Teste pilha modal");
  await editor.getByRole("button",{name:"Salvar compromisso"}).click();
  await expect(editor).toHaveCount(0);
  await expect(selected.locator(".calendar-event-counter")).toHaveText("1");

  await selected.click();
  const day=page.locator("dialog.day-events-dialog");
  await expect(day).toBeVisible();
  async function expectBackgroundLocked(){
    const state=await page.evaluate(()=>{
      const root=getComputedStyle(document.documentElement);
      const body=getComputedStyle(document.body);
      const main=document.querySelector(".app-shell > .main");
      return {html:root.overflowY,body:body.overflowY,main:main?getComputedStyle(main).overflowY:"missing"};
    });
    expect(state.html).toBe("hidden");
    expect(state.body).toBe("hidden");
    expect(state.main).toBe("hidden");
  }
  await expectBackgroundLocked();

  // Day is NEVER unmounted when a form is opened on top.
  await day.getByRole("button",{name:"Novo compromisso"}).click();
  await expect(editor).toBeVisible();
  await expect(day).toBeVisible();
  await expectBackgroundLocked();
  await page.keyboard.press("Escape");
  await expect(editor).toHaveCount(0);
  await expect(day).toBeVisible();
  await expectBackgroundLocked();

  await day.getByRole("button",{name:"Editar Teste pilha modal"}).click();
  await expect(editor).toBeVisible();
  await editor.getByRole("button",{name:"Cancelar"}).click();
  await expect(day).toBeVisible();
  await expect(editor).toHaveCount(0);

  await day.getByRole("button",{name:"Excluir Teste pilha modal"}).click();
  const confirm=page.locator("dialog.rt-confirm-dialog");
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText("Excluir compromisso?");
  for(const theme of ["light","dark"] as const){
    await page.evaluate(value=>{document.documentElement.dataset.theme=value;},theme);
    await expectCompactConfirmationGeometry(confirm);
  }
  await expect(day).toBeVisible();
  await expectBackgroundLocked();
  await page.keyboard.press("Escape");
  await expect(confirm).toHaveCount(0);
  await expect(day).toBeVisible();
  await expect(day.locator(".calendar-day-record")).toHaveCount(1);
  await day.getByRole("button",{name:"Excluir Teste pilha modal"}).click();
  await confirm.getByRole("button",{name:"Manter compromisso"}).click();
  await expect(day.locator(".calendar-day-record")).toHaveCount(1);
  await day.getByRole("button",{name:"Excluir Teste pilha modal"}).click();
  await confirm.getByRole("button",{name:"Excluir compromisso",exact:true}).click();
  await expect(confirm).toHaveCount(0);
  await expect(day).toBeVisible();
  await expect(day.locator(".calendar-day-record")).toHaveCount(0);
  await expectBackgroundLocked();
  await page.keyboard.press("Escape");
  await expect(day).toHaveCount(0);
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await expect(page.locator("html")).not.toHaveCSS("overflow-y","hidden");
});

test("native project and client dialogs share the global scroll lock",async({page},info)=>{
  await enterCalendar(page,"global-modal-scroll-"+info.project.name+"@example.com");
  const sidebar=page.locator(".sidebar nav");
  async function navigateTo(name:RegExp){
    if(info.project.name==="mobile")await page.getByRole("button",{name:"Abrir menu",exact:true}).click();
    await sidebar.getByRole("button",{name}).click();
  }
  await navigateTo(/^Projetos/);
  await page.getByRole("button",{name:"Criar projeto"}).first().click();
  await expect(page.locator("dialog.rt-project-dialog")).toBeVisible();
  await expect(page.locator("html")).toHaveCSS("overflow-y","hidden");
  await expect(page.locator("body")).toHaveCSS("overflow-y","hidden");
  await page.locator(".project-modal").getByRole("button",{name:"Cancelar"}).click();
  await expect(page.locator("dialog.rt-project-dialog")).toHaveCount(0);
  await expect(page.locator("html")).not.toHaveCSS("overflow-y","hidden");

  await navigateTo(/^Clientes/);
  await page.getByRole("button",{name:"Novo cliente"}).first().click();
  const dialog=page.locator("dialog.cd-form-dialog");
  await expect(dialog).toBeVisible();
  await expect(page.locator("html")).toHaveCSS("overflow-y","hidden");
  await dialog.getByRole("button",{name:/Fechar|Cancelar/}).first().click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator("html")).not.toHaveCSS("overflow-y","hidden");
});


test("modal surfaces are opaque and identical across calendar, confirmations and clients in both themes",async({page},info)=>{
  await enterCalendar(page,"modal-surface-"+info.project.name+"@example.com");
  const edit=page.locator("dialog.roteiva-calendar-form");
  const day=page.locator("dialog.day-events-dialog");
  const confirm=page.locator("dialog.rt-confirm-dialog");
  const clientDialog=page.locator("dialog.cd-form-dialog");
  const selected=page.locator(".roteiva-calendar .calendar-grid>button.selected");
  const menu=page.getByRole("button",{name:"Abrir menu",exact:true});
  async function goTo(name:RegExp){
    if(await menu.isVisible())await menu.click();
    await page.locator(".sidebar nav").getByRole("button",{name}).click();
    await expect(page.locator(".studio-loading")).toHaveCount(0);
    await expect(page.locator("[inert]")).toHaveCount(0);
  }
  async function colorOf(selector:string){
    return page.locator(selector).evaluate(node=>getComputedStyle(node).backgroundColor);
  }
  // Create a real event so we can exercise the nested confirmation as well.
  await page.getByRole("button",{name:"Novo compromisso",exact:true}).first().click();
  await edit.getByLabel("Título do compromisso").fill("Superfície de modal");
  await edit.getByRole("button",{name:"Salvar compromisso"}).click();
  await expect(edit).toHaveCount(0);
  await expect(selected.locator(".calendar-event-counter")).toHaveText("1");

  for(const theme of ["light","dark"] as const){
    await page.evaluate(value=>{document.documentElement.dataset.theme=value;},theme);
    const expected=theme==="light"?"rgb(245, 245, 245)":"rgb(16, 16, 16)";

    await selected.click();
    await expect(day).toBeVisible();
    const dayColor=await colorOf("dialog.day-events-dialog");
    expect(dayColor).toBe(expected);

    await day.getByRole("button",{name:"Novo compromisso"}).click();
    await expect(edit).toBeVisible();
    expect(await colorOf("dialog.roteiva-calendar-form")).toBe(expected);
    await edit.getByRole("button",{name:"Cancelar"}).click();
    await expect(day).toBeVisible();

    await day.getByRole("button",{name:"Excluir Superfície de modal"}).click();
    await expect(confirm).toBeVisible();
    expect(await colorOf("dialog.rt-confirm-dialog")).toBe(expected);
    await confirm.getByRole("button",{name:"Manter compromisso"}).click();
    await expect(day).toBeVisible();
    await day.getByRole("button",{name:"Fechar compromissos do dia"}).click();

    await goTo(/^Clientes/);
    await page.getByRole("button",{name:"Novo cliente"}).first().click();
    await expect(clientDialog).toBeVisible();
    expect(await colorOf("dialog.cd-form-dialog")).toBe(expected);
    await clientDialog.getByRole("button",{name:"Fechar cadastro"}).click();
    await goTo(/^Calendário/);
    await expect(page.locator(".roteiva-calendar")).toBeVisible();
    await expect(selected.locator(".calendar-event-counter")).toHaveText("1");
  }
});


test("project, client and finance modals match PROD calendar heading and single-ring date field",async({page},info)=>{
  await enterCalendar(page,"modal-parity-"+info.project.name+"@example.com");
  const nav=async(name:string)=>{
    const opener=page.getByRole("button",{name:"Abrir menu",exact:true});
    if(await opener.isVisible())await opener.click();
    await page.locator(".sidebar nav").getByRole("button",{name:new RegExp("^"+name)}).click();
    await expect(page.locator("[inert]")).toHaveCount(0);
  };
  await page.getByRole("button",{name:"Novo compromisso",exact:true}).first().click();
  const canonical=page.locator("dialog.roteiva-calendar-form");
  await expect(canonical).toBeVisible();
  const ref=await canonical.evaluate(dialog=>{
    const header=dialog.querySelector<HTMLElement>(".calendar-form-title")!;
    const h2=header.querySelector("h2")!;
    const sub=header.querySelector("p")!;
    const icon=header.querySelector(":scope > svg")!;
    const field=dialog.querySelector<HTMLInputElement>(".calendar-basic-field > input")!;
    const h=getComputedStyle(h2),p=getComputedStyle(sub),i=icon.getBoundingClientRect(),f=field.getBoundingClientRect();
    return {size:h.fontSize,weight:h.fontWeight,line:h.lineHeight,subtitle:p.fontSize,iconWidth:i.width,
      inputHeight:f.height,headerPadding:i.left-dialog.getBoundingClientRect().left};
  });
  await canonical.getByRole("button",{name:"Cancelar"}).click();
  const compare=async(selector:string,hasInput=true)=>{
    const modal=page.locator(selector);
    await expect(modal).toBeVisible();
    const current=await modal.evaluate((dialog,hasInput)=>{
      const header=dialog.querySelector<HTMLElement>(".rt-modal__header")!;
      const h2=header.querySelector("h2")!;
      const sub=header.querySelector("p")!;
      const icon=header.querySelector(".rt-modal__icon svg")!;
      const field=dialog.querySelector<HTMLInputElement>(".rt-modal__section > label > input.rt-input")!;
      const h=getComputedStyle(h2),p=getComputedStyle(sub),i=icon.getBoundingClientRect();
      return {size:h.fontSize,weight:h.fontWeight,line:h.lineHeight,subtitle:p.fontSize,
        iconWidth:i.width,inputHeight:hasInput?field.getBoundingClientRect().height:0,
        headerPadding:i.left-dialog.getBoundingClientRect().left};
    },hasInput);
    expect(current.size).toBe(ref.size);
    expect(current.weight).toBe(ref.weight);
    expect(current.line).toBe(ref.line);
    expect(current.subtitle).toBe(ref.subtitle);
    expect(Math.abs(current.iconWidth-ref.iconWidth)).toBeLessThan(1);
    expect(Math.abs(current.headerPadding-ref.headerPadding)).toBeLessThan(2);
    if(hasInput)expect(Math.abs(current.inputHeight-ref.inputHeight)).toBeLessThan(1);
    await expect(modal.locator(".rt-modal__icon svg")).toBeVisible();
    await expect(modal.locator(".rt-modal__heading p")).toBeVisible();
  };
  await nav("Projetos");
  await page.getByRole("button",{name:"Criar projeto",exact:true}).first().click();
  await compare("dialog.rt-project-dialog");
  const project=page.locator("dialog.rt-project-dialog");
  // A paired select/date row must share one label baseline and one field height.
  // On mobile the grid stacks, but both controls still retain the 52px contract.
  const alignment=await project.locator(".rt-modal__section .form-grid").first().evaluate(row=>{
    const client=row.querySelector<HTMLElement>(":scope > label")!;
    const due=row.querySelector<HTMLElement>(":scope > .rt-date-form-field")!;
    const dateLabel=due.querySelector<HTMLElement>(".rt-date-form-label")!;
    const clientControl=client.querySelector<HTMLElement>(".rt-select-trigger")!;
    const dateControl=due.querySelector<HTMLElement>(".calendar-picker-control")!;
    const a=client.getBoundingClientRect(),b=dateLabel.getBoundingClientRect();
    const c=clientControl.getBoundingClientRect(),d=dateControl.getBoundingClientRect();
    return {stacked:window.matchMedia("(max-width:700px)").matches,
      labelTopDifference:Math.abs(a.top-b.top),
      controlTopDifference:Math.abs(c.top-d.top),
      clientHeight:c.height,dateHeight:d.height};
  });
  expect(Math.abs(alignment.clientHeight-alignment.dateHeight)).toBeLessThan(1);
  expect(alignment.clientHeight).toBe(52);
  expect(alignment.dateHeight).toBe(52);
  if(!alignment.stacked){
    expect(alignment.labelTopDifference).toBeLessThan(2);
    expect(alignment.controlTopDifference).toBeLessThan(2);
  }
  const date=project.locator(".calendar-picker-control").first();
  await project.getByRole("button",{name:"Abrir calendário de data"}).click();
  await expect(page.getByRole("dialog",{name:"Escolher data"})).toBeVisible();
  const focus=await date.evaluate(el=>{
    const inner=el.querySelector<HTMLInputElement>("input.rt-input")!;
    const outer=getComputedStyle(el),input=getComputedStyle(inner);
    return {border:outer.borderTopColor,shadow:outer.boxShadow,inputBorder:input.borderTopWidth,inputShadow:input.boxShadow};
  });
  expect(focus.shadow).not.toBe("none");
  expect(focus.inputBorder).toBe("0px");
  expect(focus.inputShadow).toBe("none");
  await page.keyboard.press("Escape");
  await project.getByRole("button",{name:"Cancelar"}).click();
  await nav("Clientes");
  await page.getByRole("button",{name:"Novo cliente",exact:true}).first().click();
  await compare("dialog.cd-form-dialog");
  await page.locator("dialog.cd-form-dialog").getByRole("button",{name:"Cancelar"}).click();
  await nav("Financeiro");
  await page.getByRole("button",{name:"Nova receita"}).click();
  await compare("dialog.rt-finance-dialog",false);
  await expect(page.locator("dialog.rt-finance-dialog .rt-date-form-field .calendar-picker-control")).toBeVisible();
  await page.locator("dialog.rt-finance-dialog").getByRole("button",{name:"Cancelar"}).click();
});
