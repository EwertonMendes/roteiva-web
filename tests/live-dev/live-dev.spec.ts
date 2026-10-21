import {test,expect,type Page} from "@playwright/test";

const ORIGIN="https://roteiva-web-dev.web.app";
const API="https://roteiva-api-dev.ewertonmendes9.workers.dev";
const validRoutes=["/","/projetos","/clientes","/calendario","/financeiro","/biblioteca","/aprovacoes","/configuracoes"];
const email=process.env.QA_EXPECTED_EMAIL?.trim()||"";
const folder=process.env.QA_DRIVE_FOLDER_NAME?.trim()||"";
const authFile=process.env.QA_STORAGE_STATE_FILE||"";
const runUploads=process.env.QA_RUN_UPLOAD==="true";

function assertOnDev(url:string) {
  if(new URL(url).origin!==ORIGIN)throw new Error("Test must stay on the published Firebase DEV origin");
}
function watch(page:Page){
  const failures:string[]=[];
  page.on("pageerror",e=>failures.push(e.message));
  return failures;
}
async function authenticated(page:Page){
  if(!authFile||!email)throw new Error("Authenticated QA requires the dedicated QA state and QA_EXPECTED_EMAIL");
  await page.goto("/");
  await expect(page.locator(".app-shell")).toBeVisible({timeout:30000});
  await expect(page.getByText(email,{exact:true})).toBeVisible({timeout:20000});
  await expect(page.getByRole("button",{name:"Sair da conta"})).toBeVisible();
}
async function qaFolder(page:Page){
  if(!folder.startsWith("Roteiva QA"))throw new Error("Write/read QA folder must start with 'Roteiva QA'");
  await page.goto("/biblioteca");
  const library=page.getByRole("region",{name:"Biblioteca Google Drive"});
  await expect(library).toBeVisible();
  await expect(library.getByText("Drive conectado")).toBeVisible({timeout:20000});
  const entry=library.locator(".rl-folder-entry").filter({has:page.locator(".rl-folder-button").filter({hasText:folder})});
  await expect(entry).toHaveCount(1,{timeout:15000});
  await entry.getByRole("button",{name:folder}).click();
  await expect(library.getByRole("region",{name:"Arquivos da pasta"})).toBeVisible();
  return library;
}

test.describe("@public DEV publicado — sem autenticação",()=>{
  test.use({storageState:{cookies:[],origins:[]}});
  test("API real responde e não autoriza identidade inválida",async({request})=>{
    const health=await request.get(API+"/health");
    expect(health.status()).toBe(200);
    expect(await health.json()).toEqual({status:"ok",environment:"dev"});
    for(const endpoint of ["/reviews","/integrations/drive"]){
      const result=await request.get(API+endpoint,{headers:{Authorization:"Bearer invalid"}});
      expect(result.status()).toBe(401);
    }
  });
  test("rotas publicadas renderizam e protegem dados, incluindo refresh desktop/mobile",async({page})=>{
    const errors=watch(page);
    for(const pathname of validRoutes){
      assertOnDev(ORIGIN+pathname);
      const response=await page.goto(pathname,{waitUntil:"domcontentloaded"});
      expect(response?.status()).toBe(200);
      await expect(page.getByRole("button",{name:"Entrar com Google"})).toBeVisible({timeout:20000});
      expect(await page.locator("body").innerText()).not.toContain("Projeto do mal");
      expect(errors,pathname+" - erros de JS").toEqual([]);
    }
  });
  test("link público inválido não expõe material privado",async({page})=>{
    const errors=watch(page);
    await page.goto("/review/"+"A".repeat(43));
    await expect(page.getByText(/não existe|revogado|não está disponível|não foi possível/i).first()).toBeVisible({timeout:20000});
    expect(errors).toEqual([]);
  });
});
test.describe("@auth Leitura real do estúdio QA",()=>{
  test.use({storageState:authFile||{cookies:[],origins:[]}});
  test("sessão exclusiva de QA e navegação com F5",async({page})=>{
    const errors=watch(page);
    await authenticated(page);
    for(const path of validRoutes){
      await page.goto(path);
      await expect(page.locator(".app-shell")).toBeVisible();
      await expect(page.getByText(email,{exact:true})).toBeVisible();
      expect(new URL(page.url()).pathname).toBe(path);
      if(["/biblioteca","/aprovacoes","/projetos"].includes(path)){
        await page.reload();
        await expect(page.locator(".app-shell")).toBeVisible();
        expect(new URL(page.url()).pathname).toBe(path);
      }
    }
    expect(errors).toEqual([]);
  });
  test("pesquisa de aprovações reduz chamadas sem sacrificar resultado",async({page})=>{
    await authenticated(page);
    const searches:string[]=[];
    page.on("request",request=>{
      const url=new URL(request.url());
      if(url.origin===API&&url.pathname==="/reviews"&&url.searchParams.has("q")){
        searches.push(url.searchParams.get("q")||"");
      }
    });
    await page.goto("/aprovacoes");
    await expect(page.getByRole("heading",{name:"Sala de aprovação"})).toBeVisible();
    await expect(page.getByLabel("Buscar aprovações")).toBeVisible();
    const term="QA-BUSCA-SEM-RESULTADO";
    await page.getByLabel("Buscar aprovações").pressSequentially(term,{delay:10});
    await expect.poll(()=>searches.includes(term),{timeout:20000}).toBeTruthy();
    await expect(page.getByText("Nenhuma aprovação encontrada")).toBeVisible();
    const relevant=searches.filter(q=>q.length>0);
    expect(relevant.length,"debounce must prevent per-character backend requests").toBeLessThanOrEqual(3);
  });
  test("biblioteca Google Drive real lista pasta exclusiva e troca visualização",async({page})=>{
    await authenticated(page);
    const errors=watch(page);
    const library=await qaFolder(page);
    await expect(library.getByRole("button",{name:"Visualização em lista"})).toBeVisible();
    await library.getByRole("button",{name:"Visualização em grade"}).click();
    await expect(library.locator(".rl-files")).toHaveAttribute("data-view","grid");
    await library.getByRole("button",{name:"Visualização em lista"}).click();
    await expect(library.locator(".rl-files")).toHaveAttribute("data-view","list");
    const input=library.getByLabel("Filtrar arquivos carregados");
    await input.fill("Roteiva QA");
    await expect(input).toHaveValue("Roteiva QA");
    expect(errors).toEqual([]);
  });
  test("composer de aprovação abre sem publicar nada",async({page})=>{
    await authenticated(page);
    await page.goto("/aprovacoes");
    await page.getByRole("button",{name:"Nova aprovação"}).click();
    const dialog=page.getByRole("dialog",{name:"Enviar materiais para aprovação"});
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Arquivos do Google Drive")).toBeVisible();
    await dialog.getByRole("button",{name:"Fechar"}).click();
    await expect(dialog).toHaveCount(0);
  });
});
test.describe("@write Upload real estritamente na pasta QA com limpeza Google Drive",()=>{
  test.use({storageState:authFile||{cookies:[],origins:[]}});
  test("envia arquivo único, confirma persistência e envia arquivo para lixeira",async({page,request})=>{
    test.skip(!runUploads,"Manual full suite must explicitly enable QA upload");
    const clientId=process.env.QA_GOOGLE_CLIENT_ID||"";
    const clientSecret=process.env.QA_GOOGLE_CLIENT_SECRET||"";
    const refreshToken=process.env.QA_DRIVE_REFRESH_TOKEN||"";
    if(!clientId||!clientSecret||!refreshToken)throw new Error("Missing isolated QA Drive cleanup credentials; refusing to upload");
    await authenticated(page);
    const library=await qaFolder(page);
    const uploadName="Roteiva QA "+Date.now()+" "+test.info().project.name+".png";
    const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/d10AAAAASUVORK5CYII=","base64");
    let uploadedId="";
    try{
      const complete=page.waitForResponse(response=>response.url().startsWith(API)&&
        response.url().includes("/uploads/complete")&&response.request().method()==="POST",{timeout:60000});
      await library.locator('input[aria-label="Selecionar arquivos para enviar"]').setInputFiles({
        name:uploadName,mimeType:"image/png",buffer:png
      });
      const result=await complete;
      expect(result.ok(),"/uploads/complete must succeed").toBeTruthy();
      const payload=await result.json();
      uploadedId=payload?.file?.id||payload?.file?.fileId||"";
      expect(uploadedId).toMatch(/^[A-Za-z0-9_-]{8,}$/);
      await expect(library.getByText(uploadName,{exact:true}).first()).toBeVisible({timeout:30000});
    }finally{
      if(uploadedId){
        const token=await request.post("https://oauth2.googleapis.com/token",{
          form:{client_id:clientId,client_secret:clientSecret,refresh_token:refreshToken,grant_type:"refresh_token"}
        });
        expect(token.ok(),"QA cleanup OAuth must succeed").toBeTruthy();
        const json=await token.json();
        const clean=await request.patch("https://www.googleapis.com/drive/v3/files/"+encodeURIComponent(uploadedId)+"?fields=id%2Ctrashed",{
          headers:{Authorization:"Bearer "+json.access_token,"Content-Type":"application/json"},
          data:{trashed:true}
        });
        expect(clean.ok(),"QA upload cleanup must succeed").toBeTruthy();
        expect((await clean.json()).trashed).toBe(true);
      }
    }
  });
});
