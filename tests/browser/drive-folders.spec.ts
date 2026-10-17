import { test, expect, type Page } from "@playwright/test";

const cloud = "http://127.0.0.1:4173";
const api = "https://roteiva-api-dev.ewertonmendes9.workers.dev";
const connection = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const folderId = "folder_1234567890";

async function signUp(page:Page,email:string){
  await page.goto(cloud);
  await page.getByRole("button",{name:"Criar conta",exact:true}).click();
  const popupPromise=page.waitForEvent("popup");
  await page.getByRole("button",{name:"Cadastrar com Google",exact:true}).click();
  const popup=await popupPromise;await popup.waitForLoadState("load");
  await popup.getByRole("button",{name:"Add new account",exact:true}).click();
  await popup.locator("#email-input").fill(email);
  await popup.locator("#display-name-input").fill("Usuário Drive QA");
  await popup.locator("#sign-in").click();
  await page.getByLabel("Como podemos chamar você?").fill("Teste Drive");
  await page.getByLabel("Nome do estúdio ou marca").fill("Estúdio Drive");
  await page.getByLabel("Entendo que meu perfil e os dados de trabalho").check();
  await page.getByRole("button",{name:"Criar meu espaço de trabalho"}).click();
  await expect(page.locator(".app-shell")).toBeVisible();
  await expect(page.locator("[aria-busy]").first()).toHaveAttribute("aria-busy","false");
}

async function createProject(page:Page){
  await page.goto(cloud+"/projetos");
  await expect(page.getByRole("heading",{name:"Projetos",exact:true})).toBeVisible();
  await page.locator(".heading-actions").getByRole("button",{name:"Criar projeto",exact:true}).click();
  await page.getByLabel("Nome do projeto",{exact:true}).fill("Projeto Drive Teste");
  await page.locator("form.project-modal").getByRole("button",{name:"Criar projeto",exact:true}).click();
  await expect(page.getByText("Projeto Drive Teste",{exact:true}).first()).toBeVisible();
  await expect(page.locator("[aria-busy]").first()).toHaveAttribute("aria-busy","false");
}

function mockDrive(page:Page,accountAvailable:()=>boolean){
  return page.route(api+"/**",async route=>{
    const request=route.request();
    const endpoint=new URL(request.url());
    const headers={
      "Access-Control-Allow-Origin":cloud,
      "Access-Control-Allow-Headers":"Authorization, Content-Type",
      "Access-Control-Allow-Methods":"GET, POST, OPTIONS",
      "Cache-Control":"no-store",
    };
    if(request.method()==="OPTIONS")return route.fulfill({status:204,headers});
    if(endpoint.pathname==="/integrations/drive"){
      if(!accountAvailable())return route.fulfill({status:503,headers,
        body:JSON.stringify({error:{code:"service_unavailable"}})});
      return route.fulfill({status:200,headers,contentType:"application/json",body:JSON.stringify({connections:[{
        id:connection,google_email:"studio@example.com",status:"connected",
        scopes:"https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.readonly",
      }]})});
    }
    if(endpoint.pathname===`/integrations/drive/${connection}/folders`){
      return route.fulfill({status:200,headers,contentType:"application/json",body:JSON.stringify({
        folders:[{id:folderId,name:"Campanha de vídeos",mimeType:"application/vnd.google-apps.folder"}],
        nextPageToken:null,
      })});
    }
    return route.fulfill({status:404,headers,contentType:"application/json",body:JSON.stringify({error:{code:"not_found"}})});
  });
}

test("connected Drive can link project folders without an F5 or preselected project",async({page},info)=>{
  await mockDrive(page,()=>true);
  await signUp(page,"drive-folder-"+info.project.name+"@example.com");
  await createProject(page);
  await page.goto(cloud+"/biblioteca?driveE2E=1");
  const panel=page.getByRole("region",{name:"Biblioteca Google Drive"});
  await expect(panel.getByText("studio@example.com")).toBeVisible();
  await expect(panel.getByRole("button",{name:"Conectar Google Drive"})).toHaveCount(0);
  const open=panel.getByRole("button",{name:/Vincular pastas/});
  await expect(open).toBeEnabled();
  await open.click();
  const dialog=page.getByRole("dialog",{name:"Selecionar pastas do Google Drive"});
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Escolha um projeto para carregar suas pastas")).toBeVisible();
  await dialog.getByLabel("Projeto para vincular pastas").selectOption({label:"Projeto Drive Teste"});
  await expect(dialog.getByText("Campanha de vídeos")).toBeVisible();
  await dialog.getByRole("button",{name:"Vincular",exact:true}).click();
  await expect(panel.getByText("Campanha de vídeos")).toBeVisible();
  await dialog.getByRole("button",{name:"Fechar seletor"}).click();
  await page.reload();
  await expect(panel.getByText("studio@example.com")).toBeVisible();
  await expect(panel.getByText("Campanha de vídeos")).toBeVisible();
});

test("failed account lookup never displays a misleading Connect action; retry restores account immediately",async({page},info)=>{
  let available=false;
  await mockDrive(page,()=>available);
  await signUp(page,"drive-retry-"+info.project.name+"@example.com");
  await page.goto(cloud+"/biblioteca?driveE2E=1");
  const panel=page.getByRole("region",{name:"Biblioteca Google Drive"});
  const retry=panel.getByRole("button",{name:"Tentar carregar conexão novamente"});
  await expect(retry).toBeVisible();
  await expect(panel.getByRole("button",{name:"Conectar Google Drive"})).toHaveCount(0);
  available=true;
  await retry.click();
  await expect(panel.getByText("studio@example.com")).toBeVisible();
  await expect(panel.getByRole("button",{name:/Vincular pastas/})).toBeEnabled();
  await expect(panel.getByRole("button",{name:"Conectar Google Drive"})).toHaveCount(0);
});
