import { test, expect, type Page } from "@playwright/test";

const app = "http://127.0.0.1:4173";
const candidates = [
  "Ubuntu", "Manrope", "Plus Jakarta Sans", "DM Sans", "Instrument Sans",
  "Geist", "Sora", "Space Grotesk", "Outfit", "Inter", "Onest",
];

async function register(page: Page, email: string) {
  await page.goto(app);
  await page.getByRole("button", {name:"Criar conta", exact:true}).click();
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", {name:"Cadastrar com Google", exact:true}).click();
  const popup = await popupPromise;
  await popup.waitForLoadState("load");
  await popup.getByRole("button", {name:"Add new account", exact:true}).click();
  await popup.locator("#email-input").fill(email);
  await popup.locator("#display-name-input").fill("Typography QA");
  await popup.locator("#sign-in").click();
  await page.getByLabel("Como podemos chamar você?").fill("Tipografia");
  await page.getByLabel("Nome do estúdio ou marca").fill("Estúdio de Teste");
  await page.getByLabel("Concordo com o uso dos meus dados").check();
  await page.getByRole("button",{name:"Criar meu espaço de trabalho"}).click();
  await expect(page.locator(".app-shell")).toBeVisible();
  await expect(page.locator("[aria-busy]").first()).toHaveAttribute("aria-busy", "false");
}

test("temporary font lab: 10 remote choices + Ubuntu, on-demand switch, contrast, persistence and reset",async({page},info)=>{
  let requested=0;
  // The test never depends on Google Fonts connectivity. The real app still
  // downloads the genuine selected font directly from fonts.googleapis.com.
  await page.route(/^https:\/\/fonts\.googleapis\.com\/css2\?/,async route=>{
    requested++;
    const query=new URL(route.request().url()).searchParams.get("family")||"";
    const family=query.split(":")[0].replace(/\+/g," ");
    const css=`@font-face{font-family:"${family}";font-style:normal;font-weight:400 700;src:url("${app}/fonts/ubuntu/Ubuntu-Regular.ttf") format("truetype");}`;
    await route.fulfill({status:200, contentType:"text/css", body:css});
  });

  await register(page,"font-lab-"+info.project.name+"@example.com");
  const select=page.getByRole("combobox",{name:"Fonte para testar no Roteiva"});
  await expect(select).toBeVisible();
  await expect(select.locator("option")).toHaveCount(11);
  expect(await select.locator("option").evaluateAll(nodes=>nodes.map(n=>(n as HTMLOptionElement).value))).toEqual(candidates);
  await expect(select).toHaveValue("Ubuntu");
  expect(requested).toBe(0);

  await select.selectOption("Manrope");
  await expect.poll(()=>page.evaluate(()=>document.documentElement.style.getPropertyValue("--temporary-roteiva-font"))).toContain("Manrope");
  await expect(page.locator("html")).toHaveAttribute("data-typography-lab","true");
  await expect(select).toHaveValue("Manrope");
  expect(requested).toBe(1);

  const selectedStyle=await select.evaluate(el=>getComputedStyle(el).fontFamily);
  expect(selectedStyle).toContain("Manrope");
  const lightOption=await select.locator('option[value="Manrope"]').evaluate(el=>({
    foreground:getComputedStyle(el).color,
    background:getComputedStyle(el).backgroundColor,
  }));
  expect(lightOption).toEqual({foreground:"rgb(27, 27, 27)",background:"rgb(255, 255, 255)"});

  await page.getByRole("button",{name:"Ativar modo escuro"}).click();
  const darkOption=await select.locator('option[value="Manrope"]').evaluate(el=>({
    foreground:getComputedStyle(el).color,
    background:getComputedStyle(el).backgroundColor,
  }));
  expect(darkOption).toEqual({foreground:"rgb(245, 245, 245)",background:"rgb(36, 36, 36)"});

  await page.goto(app+"/projetos");
  await expect(select).toHaveValue("Manrope");
  await page.reload();
  await expect(select).toHaveValue("Manrope");
  await expect.poll(()=>page.evaluate(()=>document.documentElement.style.getPropertyValue("--temporary-roteiva-font"))).toContain("Manrope");
  await expect(select).toBeInViewport();

  await select.selectOption("Ubuntu");
  await expect(page.locator("html")).not.toHaveAttribute("data-typography-lab","true");
  await expect.poll(()=>page.evaluate(()=>document.documentElement.style.getPropertyValue("--temporary-roteiva-font"))).toBe("");
});
