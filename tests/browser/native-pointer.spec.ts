import {expect,test} from "@playwright/test";

const demo="http://127.0.0.1:4174/";

test("native pointer works in shared dropdowns and top-layer dialogs without injected overlays",async({page})=>{
  await page.goto(demo);
  await page.locator(".brand-intro").waitFor({state:"detached"});
  const noOverlay=page.locator(".studio-cursor-ring,.studio-cursor-dot");
  await expect(noOverlay).toHaveCount(0);
  await expect(page.locator("html")).not.toHaveAttribute("data-roteiva-cursor","on");

  await page.locator(".sidebar nav").getByRole("button",{name:"Financeiro"}).click();
  const select=page.locator(".finance-filters .rt-select-trigger").nth(3);
  await select.click();
  const option=page.getByRole("option",{name:"Recebido",exact:true});
  await expect(option).toBeVisible();
  expect(await option.evaluate(el=>getComputedStyle(el).cursor)).toBe("pointer");
  await option.click();
  await expect(select).toContainText("Recebido");

  // A native showModal() is in the top layer. Neither the page nor dialog
  // should hide the real OS pointer or require a React cursor portal.
  await page.evaluate(()=>{
    const dialog=document.createElement("dialog");
    dialog.id="qa-native-pointer-dialog";
    dialog.style.cssText="width:320px;max-width:90vw;padding:24px;background:#222;color:#fff";
    const button=document.createElement("button");
    button.textContent="Ação no modal";
    button.style.cssText="padding:12px 18px;cursor:pointer";
    button.addEventListener("click",()=>dialog.close());
    dialog.append(button);
    document.body.append(dialog);
    dialog.showModal();
  });
  const button=page.getByRole("button",{name:"Ação no modal"});
  await expect(button).toBeVisible();
  expect(await button.evaluate(el=>getComputedStyle(el).cursor)).toBe("pointer");
  await button.click();
  await expect(page.locator("#qa-native-pointer-dialog")).not.toBeVisible();
  await expect(noOverlay).toHaveCount(0);
  await expect(page.locator("html")).not.toHaveAttribute("data-roteiva-cursor","on");
  await page.evaluate(()=>document.querySelector("#qa-native-pointer-dialog")?.remove());
});
