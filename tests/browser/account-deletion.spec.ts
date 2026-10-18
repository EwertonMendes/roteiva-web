import {expect,test,type Page} from "@playwright/test";

const cloud="http://127.0.0.1:4173";
const api="https://roteiva-api-dev.ewertonmendes9.workers.dev";

async function createTestAccount(page:Page,email:string){
  await page.goto(cloud);
  await page.getByRole("button",{name:"Criar conta",exact:true}).click();
  const popupPromise=page.waitForEvent("popup");
  await page.getByRole("button",{name:"Cadastrar com Google",exact:true}).click();
  const popup=await popupPromise;
  await popup.waitForLoadState("load");
  await popup.getByRole("button",{name:"Add new account",exact:true}).click();
  await popup.locator("#email-input").fill(email);
  await popup.locator("#display-name-input").fill("Pessoa QA Exclusão");
  await popup.locator("#sign-in").click();
  await page.getByLabel("Como podemos chamar você?").fill("Pessoa QA");
  await page.getByLabel("Nome do estúdio ou marca").fill("Estúdio Exclusão QA");
  await page.getByLabel("Entendo que meu perfil e os dados de trabalho").check();
  await page.getByRole("button",{name:"Criar meu espaço de trabalho"}).click();
  await expect(page.locator(".app-shell")).toBeVisible();
  await expect(page.locator("[aria-busy]").first()).toHaveAttribute("aria-busy","false");
}

test("deletion modal blocks incomplete confirmation and cancellation never calls the API",async({page},info)=>{
  let submissions=0;
  await page.route(api+"/account/deletion**",async route=>{
    if(route.request().url().includes("/account/deletion/status")){
      return route.fulfill({status:200,headers:{"Access-Control-Allow-Origin":cloud},
        contentType:"application/json",body:JSON.stringify({available:true,operation:null})});
    }
    submissions++;
    return route.fulfill({status:503,headers:{"Access-Control-Allow-Origin":cloud},
      contentType:"application/json",body:JSON.stringify({error:{code:"deletion_unavailable"}})});
  });
  await createTestAccount(page,"deletion-confirm-"+info.project.name+"@example.com");
  await page.goto(cloud+"/configuracoes");
  const open=page.getByRole("button",{name:"Excluir conta",exact:true});
  await expect(open).toBeEnabled();
  await open.click();
  const dialog=page.getByRole("dialog",{name:"Excluir sua conta?"});
  await expect(dialog).toBeVisible();
  const submit=dialog.getByRole("button",{name:"Excluir definitivamente"});
  await expect(submit).toBeDisabled();
  await dialog.getByLabel("Digite EXCLUIR MINHA CONTA para confirmar:").fill("EXCLUIR");
  await expect(submit).toBeDisabled();
  await dialog.getByLabel("Digite EXCLUIR MINHA CONTA para confirmar:").fill("EXCLUIR MINHA CONTA");
  await expect(submit).toBeDisabled();
  await dialog.getByRole("checkbox",{name:"Entendo que esta exclusão é irreversível."}).check();
  await expect(submit).toBeEnabled();
  await dialog.getByRole("button",{name:"Cancelar"}).click();
  await expect(dialog).toHaveCount(0);
  await open.click();
  await expect(submit).toBeDisabled();
  await expect(dialog.getByLabel("Digite EXCLUIR MINHA CONTA para confirmar:")).toHaveValue("");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  expect(submissions).toBe(0);
});
