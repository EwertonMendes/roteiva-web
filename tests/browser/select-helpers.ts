import type { Locator, Page } from "@playwright/test";

/** Choose from the shared styled select instead of relying on native selectOption. */
export async function chooseAppSelect(
  page: Page,
  control: Locator,
  choice: { label: string } | { value: string } | string,
) {
  await control.click();
  if (typeof choice === "string") {
    await page.locator(`.rt-select-menu [role="option"][data-value=${JSON.stringify(choice)}]`).click();
  } else if ("label" in choice) {
    await page.getByRole("option", { name: choice.label, exact: true }).click();
  } else {
    await page.locator(`.rt-select-menu [role="option"][data-value=${JSON.stringify(choice.value)}]`).click();
  }
}
