import { test, expect, type Page } from "./fixtures";

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
  await page.getByLabel("Concordo com o uso dos meus dados").check();
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

function mockDrive(page:Page,accountAvailable:()=>boolean,thumbnail?:{wait:()=>Promise<void>;onRequest?:(url:URL)=>void},manyFiles=false){
  return page.route(api+"/integrations/**",async route=>{
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
    if(endpoint.pathname.endsWith("/thumbnail") && thumbnail){
      thumbnail.onRequest?.(endpoint);
      await thumbnail.wait();
      if(endpoint.pathname.includes("file_unavailable123")){
        return route.fulfill({status:404,headers,body:""});
      }
      // Tiny valid PNG: exercise the same private binary response the Worker returns.
      return route.fulfill({status:200,headers:{...headers,"Content-Type":"image/png"},
        body:Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mPQTZkGAAHpASiHbU1PAAAAAElFTkSuQmCC","base64")});
    }
    if(endpoint.pathname.endsWith("/items")){
      return json({folder:{id:folderId,name:"Campanha de vídeos"},
        files:[{id:"file_1234567890",name:"Roteiro.pdf",mimeType:"application/pdf",size:"33000",
          modifiedTime:"2026-10-17T15:00:00Z",webViewLink:"https://drive.google.com/file/d/file_1234567890/view",
          ...(thumbnail?{thumbnailTicket:"opaque-e2e-pdf-ticket"}:{})},
        ...(thumbnail?[{id:"file_unavailable123",name:"Imagem sem miniatura.jpg",mimeType:"image/jpeg",
          thumbnailTicket:"opaque-e2e-image-ticket"}]:[]),
        ...(manyFiles?Array.from({length:12},(_,index)=>({
          id:"sample_spreadsheet_"+index,name:"Planilha de produção e custos "+index+".gsheet",
          mimeType:"application/vnd.google-apps.spreadsheet",size:"90000",
          modifiedTime:"2026-10-17T15:00:00Z"
        })):[])],
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

test("private thumbnails show loading while pending and recover to image or icon",async({page},info)=>{
  test.skip(info.project.name!=="desktop","Shared component; mobile layout covered in existing test");
  let release!:()=>void;
  const wait=new Promise<void>(resolve=>{release=resolve;});
  const thumbTickets:string[]=[];
  await mockDrive(page,()=>true,{wait:()=>wait,onRequest:url=>{
    thumbTickets.push(url.searchParams.get("ticket")||"");
  }});
  await signUp(page,"drive-loading-"+info.project.name+"@example.com");
  await createProject(page);
  await page.goto(cloud+"/biblioteca?driveE2E=1");
  const panel=page.getByRole("region",{name:"Biblioteca Google Drive"});
  await panel.getByRole("button",{name:"Vincular pasta",exact:true}).first().click();
  const dialog=page.getByRole("dialog",{name:"Selecionar pastas do Google Drive"});
  await dialog.getByLabel("Projeto para vincular pastas").selectOption({label:"Projeto Drive Teste"});
  await dialog.getByRole("checkbox",{name:"Selecionar Campanha de vídeos"}).check();
  await dialog.getByRole("button",{name:"Vincular 1 pasta"}).click();
  await expect(dialog).toHaveCount(0);
  const pdf=panel.getByRole("button",{name:/Roteiro.pdf/});
  const missing=panel.getByRole("button",{name:/Imagem sem miniatura.jpg/});
  await expect(pdf.locator('[data-thumbnail-state="loading"]')).toBeVisible();
  await expect(missing.locator('[data-thumbnail-state="loading"]')).toBeVisible();
  await expect(pdf.locator(".rl-thumb-loading")).toBeVisible();
  release();
  await expect(pdf.locator('[data-thumbnail-state="loaded"] img')).toBeVisible();
  await expect(missing.locator('[data-thumbnail-state="unavailable"] svg')).toBeVisible();
  await expect(panel.locator('[data-thumbnail-state="loading"]')).toHaveCount(0);
  expect(thumbTickets.sort()).toEqual(["opaque-e2e-image-ticket","opaque-e2e-pdf-ticket"]);
});


test("grid cards keep media, names and menus inside separate non-overlapping tracks on desktop/mobile",async({page},info)=>{
  if(info.project.name==="mobile")await page.setViewportSize({width:390,height:844});
  await mockDrive(page,()=>true,undefined,true);
  await signUp(page,"drive-grid-"+info.project.name+"@example.com");
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
  await panel.getByRole("button",{name:"Visualização em grade"}).click();
  const tiles=panel.locator('.rl-files[data-view="grid"] .rl-file-row');
  await expect(tiles).toHaveCount(13);
  // The actual computed geometry catches rows collapsing underneath thumbnails;
  // the previous implementation stacked 50px tracks while cards overflowed them.
  const boxes=await tiles.evaluateAll(elements=>elements.map(element=>{
    const card=element.getBoundingClientRect();
    const media=element.querySelector(".rl-file-icon")!.getBoundingClientRect();
    const name=element.querySelector(".rl-file-name")!.getBoundingClientRect();
    const menu=element.querySelector(".rl-menu")!.getBoundingClientRect();
    const rect=(r:DOMRect)=>({left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height});
    return {card:rect(card),media:rect(media),name:rect(name),menu:rect(menu)};
  }));
  expect(boxes.length).toBe(13);
  for(const [index,tile] of boxes.entries()){
    expect(tile.card.height, "card height "+index).toBeGreaterThanOrEqual(175);
    expect(tile.media.height, "media height "+index).toBeGreaterThan(85);
    expect(tile.media.top, "media starts inside card "+index).toBeGreaterThanOrEqual(tile.card.top-1);
    expect(tile.media.bottom, "media ends before text "+index).toBeLessThanOrEqual(tile.name.top+1);
    expect(tile.name.bottom, "text fits card "+index).toBeLessThanOrEqual(tile.card.bottom+1);
    expect(tile.menu.bottom, "menu fits card "+index).toBeLessThanOrEqual(tile.card.bottom+1);
    expect(tile.menu.left, "menu fits horizontally "+index).toBeGreaterThanOrEqual(tile.card.left-1);
    for(let other=index+1;other<boxes.length;other++){
      const next=boxes[other].card;
      const overlapX=Math.min(tile.card.right,next.right)-Math.max(tile.card.left,next.left);
      const overlapY=Math.min(tile.card.bottom,next.bottom)-Math.max(tile.card.top,next.top);
      expect(overlapX<1 || overlapY<1, "cards "+index+" and "+other+" must not overlap").toBe(true);
    }
  }
  await panel.getByRole("button",{name:"Visualização em lista"}).click();
  await expect(panel.locator('.rl-files[data-view="list"] .rl-file-row')).toHaveCount(13);
  await panel.getByRole("button",{name:"Visualização em grade"}).click();
  await expect(tiles).toHaveCount(13);
});


test("upload uses file picker and drag-and-drop, confirms Drive and updates the current folder",async({page},info)=>{
  if(info.project.name==="mobile")await page.setViewportSize({width:390,height:844});
  await mockDrive(page,()=>true);
  const resource="uploaded_file_123456";
  const external="https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=e2e";
  const seen:{kind:string;body?:unknown}[]=[];
  await page.route(api+"/integrations/drive/"+connection+"/folders/"+folderId+"/uploads**",async route=>{
    const endpoint=new URL(route.request().url());
    const cors={"Access-Control-Allow-Origin":cloud,"Access-Control-Allow-Headers":"Authorization, Content-Type",
      "Access-Control-Allow-Methods":"POST, OPTIONS"};
    if(route.request().method()==="OPTIONS")return route.fulfill({status:204,headers:cors});
    const payload=route.request().postDataJSON();
    if(endpoint.pathname.endsWith("/complete")){
      seen.push({kind:"complete",body:payload});
      return route.fulfill({status:200,headers:cors,contentType:"application/json",
        body:JSON.stringify({file:{id:resource,name:"Novo arquivo.txt",mimeType:"text/plain",size:"3"}})});
    }
    seen.push({kind:"init",body:payload});
    return route.fulfill({status:200,headers:cors,contentType:"application/json",
      body:JSON.stringify({sessionUrl:external,chunkSize:262144})});
  });
  await page.route(/https:\/\/www\.googleapis\.com\/upload\/drive\/v3\/files\?/,async route=>{
    const cors={"Access-Control-Allow-Origin":cloud,"Access-Control-Allow-Methods":"PUT, OPTIONS",
      "Access-Control-Allow-Headers":"Content-Type, Content-Range","Access-Control-Expose-Headers":"Range"};
    if(route.request().method()==="OPTIONS")return route.fulfill({status:204,headers:cors});
    expect(route.request().method()).toBe("PUT");
    expect(route.request().headers()["authorization"]).toBeUndefined();
    return route.fulfill({status:201,headers:cors,contentType:"application/json",
      body:JSON.stringify({id:resource,name:"Novo arquivo.txt",mimeType:"text/plain",size:"3"})});
  });
  await signUp(page,"drive-upload-"+info.project.name+"@example.com");
  await createProject(page);
  await page.goto(cloud+"/biblioteca?driveE2E=1");
  const panel=page.getByRole("region",{name:"Biblioteca Google Drive"});
  await panel.getByRole("button",{name:"Vincular pasta",exact:true}).first().click();
  const dialog=page.getByRole("dialog",{name:"Selecionar pastas do Google Drive"});
  await dialog.getByLabel("Projeto para vincular pastas").selectOption({label:"Projeto Drive Teste"});
  await dialog.getByRole("checkbox",{name:"Selecionar Campanha de vídeos"}).check();
  await dialog.getByRole("button",{name:"Vincular 1 pasta"}).click();
  await expect(panel.getByRole("button",{name:"Enviar arquivos"})).toBeVisible();
  await panel.getByLabel("Selecionar arquivos para enviar").setInputFiles({
    name:"Novo arquivo.txt",mimeType:"text/plain",buffer:Buffer.from("abc")
  });
  const queue=panel.getByLabel("Transferências para Google Drive");
  await expect(queue.getByText("Arquivo enviado para Campanha de vídeos")).toBeVisible();
  await expect(panel.locator(".rl-files .rl-file-open").filter({hasText:"Novo arquivo.txt"})).toBeVisible();
  expect(seen.filter(x=>x.kind==="init")).toHaveLength(1);
  expect(seen.filter(x=>x.kind==="complete")).toHaveLength(1);
  const init=seen.find(x=>x.kind==="init")!.body as Record<string,unknown>;
  expect(init.linkedFolderId).toBe(folderId);
  expect(init.size).toBe(3);
  if(info.project.name==="desktop"){
    await panel.locator(".rl-content").evaluate(element=>{
      const data=new DataTransfer();
      data.items.add(new File(["def"],"Arrasto.txt",{type:"text/plain"}));
      element.dispatchEvent(new DragEvent("dragover",{bubbles:true,cancelable:true,dataTransfer:data}));
      element.dispatchEvent(new DragEvent("drop",{bubbles:true,cancelable:true,dataTransfer:data}));
    });
    await expect(queue.getByText("Arrasto.txt")).toBeVisible();
    await expect(queue.getByText("Arquivo enviado para Campanha de vídeos")).toHaveCount(2);
  }
});
