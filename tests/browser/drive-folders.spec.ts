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
    const endpoint=new URL(route.request().url());
    const headers={
      "Access-Control-Allow-Origin":cloud,
      "Access-Control-Allow-Headers":"Authorization, Content-Type",
      "Access-Control-Allow-Methods":"GET, POST, OPTIONS",
      "Cache-Control":"no-store",
    };
    const json=(body:unknown)=>route.fulfill({status:200,headers,contentType:"application/json",body:JSON.stringify(body)});
    if(route.request().method()==="OPTIONS")return route.fulfill({status:204,headers});
    if(endpoint.pathname==="/integrations/drive"){
      if(!accountAvailable())return route.fulfill({status:503,headers,
        body:JSON.stringify({error:{code:"service_unavailable"}})});
      return json({connections:[{
        id:connection,google_email:"studio@example.com",status:"connected",
        scopes:"https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.readonly",
      }]});
    }
    if(endpoint.pathname==="/integrations/drive/"+connection+"/folders"){
      return json({
        folders:[
          {id:folderId,name:"Campanha de vídeos",mimeType:"application/vnd.google-apps.folder"},
          {id:"folder_abcdef12345",name:"Documentos cliente",mimeType:"application/vnd.google-apps.folder"},
        ],nextPageToken:null,
      });
    }
    if(endpoint.pathname.endsWith("/items")){
      return json({folder:{id:folderId,name:"Campanha de vídeos"},
        files:[{id:"file_1234567890",name:"Roteiro.pdf",mimeType:"application/pdf",size:"33000",
          modifiedTime:"2026-10-17T15:00:00Z",webViewLink:"https://drive.google.com/file/d/file_1234567890/view"}],
        nextPageToken:null,
      });
    }
    return route.fulfill({status:404,headers,contentType:"application/json",body:JSON.stringify({error:{code:"not_found"}})});
  });
}

test("folder picker links multiple folders, explorer opens files in one click and links survive reload",async({page},info)=>{
  test.skip(info.project.name!=="desktop","Desktop explorer covered separately from mobile hierarchy");
  await mockDrive(page,()=>true);
  await signUp(page,"drive-folder-"+info.project.name+"@example.com");
  await createProject(page);
  await page.goto(cloud+"/biblioteca?driveE2E=1");
  const panel=page.getByRole("region",{name:"Biblioteca Google Drive"});
  await expect(panel.getByRole("button",{name:"Conectar Drive"})).toHaveCount(0);
  await panel.getByRole("button",{name:"Vincular pasta",exact:true}).first().click();
  const dialog=page.getByRole("dialog",{name:"Selecionar pastas do Google Drive"});
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/Escolha um projeto para carregar suas pastas/)).toBeVisible();
  await dialog.getByLabel("Projeto para vincular pastas").selectOption({label:"Projeto Drive Teste"});
  await expect(dialog.getByText("Campanha de vídeos")).toBeVisible();
  await dialog.getByRole("checkbox",{name:"Selecionar Campanha de vídeos"}).check();
  await dialog.getByRole("checkbox",{name:"Selecionar Documentos cliente"}).check();
  await dialog.getByRole("button",{name:"Vincular 2 pastas"}).click();
  await expect(dialog).toHaveCount(0);
  await expect(panel.getByTitle("Campanha de vídeos")).toBeVisible();
  await expect(panel.getByTitle("Documentos cliente")).toBeVisible();
  await expect(panel.getByRole("button",{name:/Roteiro.pdf/})).toBeVisible();
  await panel.getByTitle("Documentos cliente").click();
  await expect(panel.getByText("Documentos cliente").first()).toBeVisible();
  await page.reload();
  await expect(panel.getByTitle("Campanha de vídeos")).toBeVisible();
  await expect(panel.getByTitle("Documentos cliente")).toBeVisible();
  await expect(page.getByRole("button",{name:/Biblioteca/}).first()).toContainText("2");
});

test("account retrieval error never shows a fake disconnected state and retries safely",async({page},info)=>{
  let available=false;
  await mockDrive(page,()=>available);
  await signUp(page,"drive-retry-"+info.project.name+"@example.com");
  await page.goto(cloud+"/biblioteca?driveE2E=1");
  const panel=page.getByRole("region",{name:"Biblioteca Google Drive"});
  await expect(panel.getByRole("button",{name:"Tentar novamente"})).toBeVisible();
  await expect(panel.getByRole("button",{name:"Conectar Drive"})).toBeDisabled();
  available=true;
  await panel.getByRole("button",{name:"Tentar novamente"}).click();
  await expect(panel.getByRole("button",{name:"Vincular pasta",exact:true}).first()).toBeEnabled();
  await panel.locator(".rl-account > summary").click();
  await expect(panel.getByText("studio@example.com")).toBeVisible();
});

test("mobile shows one navigation level and a full-height folder picker",async({page},info)=>{
  test.skip(info.project.name!=="mobile","Covered by the mobile Playwright project");
  await page.setViewportSize({width:390,height:844});
  await mockDrive(page,()=>true);
  await signUp(page,"drive-mobile-"+info.project.name+"@example.com");
  await createProject(page);
  await page.goto(cloud+"/biblioteca?driveE2E=1");
  const panel=page.getByRole("region",{name:"Biblioteca Google Drive"});
  await panel.getByRole("button",{name:"Vincular pasta",exact:true}).first().click();
  const dialog=page.getByRole("dialog",{name:"Selecionar pastas do Google Drive"});
  await dialog.getByLabel("Projeto para vincular pastas").selectOption({label:"Projeto Drive Teste"});
  await dialog.getByRole("checkbox",{name:"Selecionar Campanha de vídeos"}).check();
  await dialog.getByRole("button",{name:"Vincular 1 pasta"}).click();
  await expect(dialog).toHaveCount(0);
  await expect(panel.getByRole("button",{name:/Roteiro.pdf/})).toBeVisible();
  await panel.getByRole("button",{name:"Voltar para as pastas"}).click();
  await expect(panel.getByTitle("Campanha de vídeos")).toBeVisible();
  await panel.getByTitle("Campanha de vídeos").click();
  await expect(panel.getByRole("button",{name:/Roteiro.pdf/})).toBeVisible();
});
