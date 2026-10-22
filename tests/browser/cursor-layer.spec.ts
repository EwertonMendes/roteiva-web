import {expect, test} from "@playwright/test";

const demo = "http://127.0.0.1:4174/";

test("custom cursor stays in front of shared dropdowns and native dialogs without stealing clicks", async ({page}, info) => {
  test.skip(info.project.name === "mobile", "Custom cursor is deliberately disabled on touch-only devices.");
  await page.emulateMedia({reducedMotion:"no-preference"});
  await page.goto(demo);
  await page.locator(".brand-intro").waitFor({state:"detached"});
  await page.locator(".sidebar nav").getByRole("button",{name:"Financeiro"}).click();

  const select = page.locator(".finance-filters .rt-select-trigger").nth(3);
  await select.click();
  const option = page.getByRole("option",{name:"Recebido",exact:true});
  await expect(option).toBeVisible();
  await option.hover();
  const ring = page.locator(".studio-cursor-ring");
  await expect(ring).toHaveClass(/is-visible/);
  await expect(ring).toHaveCSS("z-index","2147483000");
  await expect(page.locator("html")).toHaveAttribute("data-roteiva-cursor","on");
  const order = await page.evaluate(() => ({
    cursor: Number(getComputedStyle(document.querySelector(".studio-cursor-ring")!).zIndex),
    menu: Number(getComputedStyle(document.querySelector(".rt-select-menu")!).zIndex),
    cursorDoesNotCapture: getComputedStyle(document.querySelector(".studio-cursor-ring")!).pointerEvents === "none",
  }));
  expect(order.cursor).toBeGreaterThan(order.menu);
  expect(order.cursorDoesNotCapture).toBe(true);
  await option.click();
  await expect(select).toContainText("Recebido");

  // A native modal is a separate browser top layer, not a high-z-index div.
  await page.evaluate(() => {
    const dialog = document.createElement("dialog");
    dialog.id = "qa-cursor-modal";
    dialog.style.cssText = "width:340px;height:200px;background:#222;color:white;border:0;border-radius:14px";
    const button = document.createElement("button");
    button.id = "qa-cursor-button";
    button.textContent = "Ação no modal";
    button.style.cssText = "width:200px;height:60px;margin:32px;background:#444;color:white";
    dialog.append(button);
    document.body.append(dialog);
    dialog.showModal();
  });
  await page.locator("#qa-cursor-button").hover();
  await expect(ring).toHaveClass(/is-visible/);
  expect(await ring.evaluate(el => el.parentElement?.id)).toBe("qa-cursor-modal");
  expect(await page.locator("#qa-cursor-button").evaluate(el => getComputedStyle(el).cursor)).toBe("none");
  await page.locator("#qa-cursor-button").click();
  await page.evaluate(() => {
    const dialog = document.querySelector<HTMLDialogElement>("#qa-cursor-modal")!;
    dialog.close();
    dialog.remove();
  });
  await page.locator(".finance-filters .rt-select-trigger").nth(3).hover();
  await expect(ring).toHaveClass(/is-visible/);
  expect(await ring.evaluate(el => el.parentElement?.tagName)).toBe("BODY");

  // Specialized editors intentionally use a native cursor for image gestures.
  await page.evaluate(() => {
    const dialog = document.createElement("dialog");
    dialog.id = "qa-native-cursor-modal";
    dialog.dataset.nativeCursor = "";
    const button = document.createElement("button");
    button.textContent = "Arrastar imagem";
    button.style.cssText = "width:180px;height:65px";
    dialog.append(button);
    document.body.append(dialog);
    dialog.showModal();
  });
  const nativeButton = page.locator("#qa-native-cursor-modal button");
  await nativeButton.hover();
  await expect(page.locator("html")).not.toHaveAttribute("data-roteiva-cursor","on");
  expect(await nativeButton.evaluate(el => getComputedStyle(el).cursor)).not.toBe("none");
  await page.evaluate(() => document.querySelector<HTMLDialogElement>("#qa-native-cursor-modal")!.remove());
});
