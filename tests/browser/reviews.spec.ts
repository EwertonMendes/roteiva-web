import {test,expect} from "./fixtures";
const ROOT="http://127.0.0.1:4173";
const API="https://roteiva-api-dev.ewertonmendes9.workers.dev";
const TOKEN="x".repeat(43);
function publicApi(page:import("@playwright/test").Page){
  const comments:{id:string;file_id:string;author_name:string;body:string;seconds:number|null;created_at:number}[]=[];
  const review={title:"Corte institucional",message:"Confira esta versão",studioName:"Estúdio QA",
    clientName:"Empresa Teste",projectName:"Campanha",status:"pending",version:1,
    expiresAt:Date.now()+86400000,mode:"link"};
  const assets=[{fileId:"FILE_REVIEW_12345678",name:"Primeiro corte.mp4",mimeType:"video/mp4"}];
  const decisions:{version:number;decision:string;author_name:string;message:string;created_at:number}[]=[];
  return page.route(API+"/reviews/public**",async route=>{
    const request=route.request(),path=new URL(request.url()).pathname;
    const headers={
      "Access-Control-Allow-Origin":ROOT,
      "Access-Control-Allow-Methods":"GET,POST,OPTIONS",
      "Access-Control-Allow-Headers":"Authorization,Content-Type,X-Review-Token",
      "Cache-Control":"no-store"
    };
    if(request.method()==="OPTIONS")return route.fulfill({status:204,headers});
    if(request.headers()["x-review-token"]!==TOKEN)return route.fulfill({status:404,headers,body:"{}"});
    let result:unknown,code=200;
    if(path.endsWith("/public")){
      result={review,assets,comments,decisions};
    }else if(path.endsWith("/comment")){
      const payload=request.postDataJSON() as {authorName:string;fileId:string;body:string;seconds:number|null};
      expect(request.postDataJSON().version).toBe(review.version);
      expect(payload.fileId).toBe(assets[0].fileId);expect(payload.body.trim()).not.toBe('');
      if(review.status!=="pending"){code=409;result={error:{code:"review_already_decided"}};}
      else{comments.push({id:String(comments.length+1),file_id:payload.fileId,author_name:payload.authorName,
        body:payload.body,seconds:payload.seconds,created_at:Date.now()});result={saved:true};}
    }else if(path.endsWith("/decide")){
      const payload=request.postDataJSON() as {authorName:string;decision:string;message:string};
      expect(request.postDataJSON().version).toBe(review.version);expect(['approved','changes']).toContain(payload.decision);
      if(review.status!=="pending"){code=409;result={error:{code:"review_already_decided"}};}
      else{review.status=payload.decision;decisions.push({version:1,decision:payload.decision,
        author_name:payload.authorName,message:payload.message,created_at:Date.now()});
        result={saved:true,status:payload.decision};}
    }else{code=404;result={};}
    await route.fulfill({status:code,headers,contentType:"application/json",body:JSON.stringify(result)});
  });
}
test("cliente sem conta deixa comentário e aprova em desktop/mobile",async({page})=>{
  await publicApi(page);
  await page.goto(ROOT+"/review/"+TOKEN);
  await expect(page.getByRole("heading",{name:"Corte institucional"})).toBeVisible();
  await expect(page.locator('iframe[title="Prévia de Primeiro corte.mp4"]')).toHaveCount(1);
  await expect(page.getByRole("link",{name:"Abrir no Drive"})).toHaveAttribute("href",/drive\.google\.com/);
  await page.getByPlaceholder("Como podemos chamar você?").fill("Renata Cliente");
  await page.getByPlaceholder("O que você gostaria de comentar?").fill("Aumentar a legenda");
  await page.getByPlaceholder("Ex.: 01:25").fill("00:35");
  await page.getByRole("button",{name:"Adicionar comentário"}).click();
  await expect(page.getByText("Aumentar a legenda")).toBeVisible();
  await expect(page.getByText("Renata Cliente",{exact:true})).toBeVisible();
  await expect(page.getByRole("button",{name:"0:35"})).toBeVisible();
  await page.getByRole("button",{name:"Aprovar material"}).click();
  await expect(page.getByRole("dialog",{name:"Confirmar decisão"})).toBeVisible();
  await page.getByRole("button",{name:"Confirmar decisão"}).click();
  await expect(page.getByRole("heading",{name:"Material aprovado"})).toBeVisible();
  await expect(page.getByRole("button",{name:"Aprovar material"})).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading",{name:"Material aprovado"})).toBeVisible();
});
test("cliente explica ajustes antes da decisão e vê confirmação",async({page})=>{
  await publicApi(page);
  await page.goto(ROOT+"/review/"+TOKEN);
  await page.getByRole("button",{name:"Solicitar ajustes"}).click();
  await expect(page.getByRole("button",{name:"Confirmar decisão"})).toBeDisabled();
  await page.getByPlaceholder("Descreva os ajustes desejados…").fill("Alterar o encerramento");
  await page.getByPlaceholder("Seu nome").fill("Cliente B");
  await page.getByRole("button",{name:"Confirmar decisão"}).click();
  await expect(page.getByRole("heading",{name:"Feedback enviado"})).toBeVisible();
});

test('portal remove material anterior quando recarregamento é recusado e permite recuperar da falha de rede',async({page})=>{
  await publicApi(page);
  await page.goto(ROOT+'/review/'+TOKEN);
  await expect(page.getByRole('heading',{name:'Corte institucional'})).toBeVisible();
  await page.route(API+'/reviews/public',route=>route.abort('internetdisconnected'));
  await page.reload();
  await expect(page.getByRole('heading',{name:'Material indisponível'})).toBeVisible();
  await expect(page.locator('iframe[title^="Prévia de"]')).toHaveCount(0);
  await expect(page.getByText(/Sem conexão com o serviço/)).toBeVisible();
  await page.unroute(API+'/reviews/public');
  await page.getByRole('button',{name:'Tentar novamente'}).click();
  await expect(page.getByRole('heading',{name:'Corte institucional'})).toBeVisible();
  await page.getByRole('button',{name:'Aprovar material'}).click();
  await expect(page.locator('body')).toHaveCSS('overflow','hidden');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test("portal guest switches dark/light without Google login and preserves preference",async({page})=>{
  await page.emulateMedia({colorScheme:"light"});
  await publicApi(page);
  await page.goto(ROOT+"/review/"+TOKEN);
  await expect(page.getByRole("heading",{name:"Corte institucional"})).toBeVisible();
  await expect(page.locator("main.review-portal")).toHaveAttribute("data-theme","light");
  await page.getByRole("button",{name:"Ativar tema escuro"}).click();
  await expect(page.locator("main.review-portal")).toHaveAttribute("data-theme","dark");
  await expect(page.locator('.review-portal-header img')).toHaveAttribute("src","/roteiva-logo-white.png");
  await page.reload();
  await expect(page.locator("main.review-portal")).toHaveAttribute("data-theme","dark");
  await page.getByRole("button",{name:"Ativar tema claro"}).click();
  await expect(page.locator("main.review-portal")).toHaveAttribute("data-theme","light");
});
test("video input masks timestamps and prevents invalid submissions",async({page})=>{
  await publicApi(page);
  await page.goto(ROOT+"/review/"+TOKEN);
  await expect(page.getByRole("heading",{name:"Corte institucional"})).toBeVisible();
  await page.getByPlaceholder("Como podemos chamar você?").fill("Cliente QA");
  await page.getByPlaceholder("O que você gostaria de comentar?").fill("Ajustar corte");
  const time=page.getByPlaceholder("Ex.: 01:25");
  await time.fill("oi01:69");
  await expect(time).toHaveValue("01:69");
  await expect(time).toHaveAttribute("aria-invalid","true");
  await expect(page.getByRole("button",{name:"Adicionar comentário"})).toBeDisabled();
  await time.fill("0125");
  await expect(time).toHaveValue("01:25");
  await expect(time).toHaveAttribute("aria-invalid","false");
  await expect(page.getByRole("button",{name:"Adicionar comentário"})).toBeEnabled();
});
test("image-only reviews hide all video timestamp controls",async({page})=>{
  await page.route(API+"/reviews/public**",async route=>{
    if(!route.request().url().endsWith("/public"))return route.fulfill({status:404,body:"{}"});
    const body={review:{title:"Avaliação da arte",message:"Confira a capa",studioName:"Studio",
      status:"pending",version:1,expiresAt:Date.now()+86400000,mode:"link"},
      assets:[{fileId:"REVIEW_IMAGE_12345678",name:"Capa.png",mimeType:"image/png"}],
      comments:[],decisions:[]};
    await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(body)});
  });
  await page.goto(ROOT+"/review/"+TOKEN);
  await expect(page.getByRole("heading",{name:"Avaliação da arte"})).toBeVisible();
  await expect(page.locator('iframe[title="Prévia de Capa.png"]')).toHaveCount(1);
  await expect(page.getByPlaceholder("Ex.: 01:25")).toHaveCount(0);
  await expect(page.getByRole("button",{name:/Usar tempo atual|Marcar este instante/})).toHaveCount(0);
  await page.getByPlaceholder("Como podemos chamar você?").fill("Cliente");
  await page.getByPlaceholder("O que você gostaria de comentar?").fill("A arte ficou boa.");
  await page.getByRole("button",{name:"Adicionar comentário"}).click();
});
