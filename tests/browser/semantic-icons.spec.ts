import { test, expect, type Page } from "@playwright/test";

const app = "http://127.0.0.1:4173";

async function enterWorkspace(page: Page, email: string) {
  await page.goto(app);
  await page.getByRole("button", { name: "Criar conta", exact: true }).click();
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Cadastrar com Google", exact: true }).click();
  const popup = await popupPromise;
  await popup.waitForLoadState("load");
  await popup.getByRole("button", { name: "Add new account", exact: true }).click();
  await popup.locator("#email-input").fill(email);
  await popup.locator("#display-name-input").fill("QA Iconografia");
  await popup.locator("#sign-in").click();
  await page.getByLabel("Como podemos chamar você?").fill("Teste Ícones");
  await page.getByLabel("Nome do estúdio ou marca").fill("Estúdio QA");
  await page.getByLabel("Entendo que meu perfil e os dados de trabalho").check();
  await page.getByRole("button", { name: "Criar meu espaço de trabalho" }).click();
  await expect(page.locator(".app-shell")).toBeVisible();
  await expect(page.locator("[aria-busy]").first()).toHaveAttribute("aria-busy", "false");
}

test("semantic icon labels remain accessible, responsive and functional", async ({ page }, info) => {
  await enterWorkspace(page, "icons-"+info.project.name+"@example.com");

  await page.goto(app + "/projetos");
  const filters = page.locator(".filter-pills");
  await expect(filters.locator("button")).toHaveCount(5);
  for (const title of ["Todos", "Em produção", "Em aprovação", "Ajustes", "Aprovado"]) {
    const button = filters.getByRole("button", { name: title, exact: true });
    await expect(button).toHaveCount(1);
    await expect(button.locator("svg[aria-hidden='true']")).toHaveCount(1);
  }
  await expect(filters.getByRole("button", { name: "Todos", exact: true })).toHaveAttribute("aria-pressed", "true");
  await filters.getByRole("button", { name: "Em produção", exact: true }).click();
  await expect(filters.getByRole("button", { name: "Em produção", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(filters.getByRole("button", { name: "Todos", exact: true })).toHaveAttribute("aria-pressed", "false");
  // Previous selection may trigger an asynchronous project page refresh.
  // Press Enter on the live button itself (rather than the document's current focus),
  // which re-focuses the target if the filter row was replaced during the refresh.
  await expect(page.locator("[aria-busy]").first()).toHaveAttribute("aria-busy", "false");
  await filters.getByRole("button", { name: "Todos", exact: true }).press("Enter");
  await expect(filters.getByRole("button", { name: "Todos", exact: true })).toHaveAttribute("aria-pressed", "true");

  await page.goto(app + "/clientes");
  await expect(page.locator(".client-summary > div")).toHaveCount(3);
  await expect(page.locator(".client-summary .client-summary-label svg[aria-hidden='true']")).toHaveCount(3);
  await expect(page.getByText("Carteira de clientes", { exact: true })).toBeVisible();

  await page.goto(app + "/financeiro");
  await expect(page.locator(".finance-filters label > .ui-icon-label svg[aria-hidden='true']")).toHaveCount(4);
  await expect(page.locator(".finance-metrics article .finance-metric-label svg[aria-hidden='true']")).toHaveCount(4);
  await expect(page.locator(".finance-filters select")).toHaveCount(4);
  await page.locator(".finance-filters select").nth(3).selectOption({ label: "Recebido" });
  await expect(page.locator(".finance-filters select").nth(3)).toHaveValue("Recebido");
  await expect(page.locator(".revenue-chart-panel .ui-icon-label svg[aria-hidden='true']")).toHaveCount(1);
  await expect(page.locator(".finance-side .ui-icon-label svg[aria-hidden='true']")).toHaveCount(1);

  await page.goto(app + "/configuracoes");
  for (const text of ["Nome profissional", "Nome do estúdio ou marca", "Tipo de atuação"]) {
    const label = page.locator(".settings-field > span").filter({ hasText: text }).first();
    await expect(label).toBeVisible();
    await expect(label.locator("svg[aria-hidden='true']")).toHaveCount(1);
  }
  await expect(page.getByText("Cache neste dispositivo", { exact: false })).toBeVisible();
  await expect(page.getByText("Diagnóstico da sessão", { exact: false })).toBeVisible();

  // Icons are decorative and must never cause page-wide horizontal scrolling,
  // in either theme or at a larger user font preference.
  await page.evaluate(() => { document.documentElement.style.fontSize = "125%"; });
  const overflow = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    width: document.documentElement.clientWidth,
  }));
  expect(overflow.scroll).toBeLessThanOrEqual(overflow.width + 4);
  await page.evaluate(() => { document.documentElement.style.removeProperty("font-size"); });
});
