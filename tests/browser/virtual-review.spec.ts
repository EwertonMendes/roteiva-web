import {test,expect} from './fixtures';
import {withMediaServer} from './media-fixture';
const web='http://127.0.0.1:4173',api='http://127.0.0.1:8787',invite='i'.repeat(43),session='s'.repeat(43);

test.skip(!process.env.VIRTUAL_LIBRARY_E2E,'Run with the dedicated virtual-library build/config.');

test('open-link portal exchanges invitation, protects media with session and resumes after reload without workspace registration',async({page})=>{
 let decided=false,checks=0;
 await withMediaServer(async received=>{
  await page.goto(web+'/review#invite='+invite);
  await expect(page.getByText('Versão publicada QA',{exact:true}).first()).toBeVisible();
  await expect(page).toHaveURL(web+'/review');
  await expect.poll(()=>received.some(x=>x.path==='/reviews/media')).toBe(true);
  expect(received.find(x=>x.path==='/reviews/media')?.session).toBe(session);
  await page.reload();await expect(page.getByText('Versão publicada QA',{exact:true}).first()).toBeVisible();
  expect(received.filter(x=>x.path==='/reviews/public/session')).toHaveLength(1);
  expect(received.some(x=>x.path.startsWith('/access/')||x.path.startsWith('/account/'))).toBe(false);
  await expect(page.getByRole('button',{name:'Criar meu espaço de trabalho'})).toHaveCount(0);
  await page.getByPlaceholder('Como podemos chamar você?').fill('Cliente QA');
  await page.getByRole('button',{name:'Aprovar material',exact:true}).click();
  await page.getByRole('button',{name:'Confirmar decisão',exact:true}).click();
  await expect.poll(()=>decided).toBe(true);expect(checks).toBe(2);
 },req=>{
  if(req.path==='/reviews/public/session'&&req.invite===invite)return {json:{session,expiresAt:Date.now()+30*60*1000}};
  if(req.session!==session)return {status:401,json:{error:{code:'review_session_required'}}};
  if(req.path==='/reviews/public/decision-check'){
   if(req.body?.version!==1||req.body?.manifestHash!=='manifest-qa')return {status:409,json:{error:{code:'review_manifest_changed'}}};
   checks++;return {json:{ready:checks===2,proof:'proof-'+checks}};
  }
  if(req.path==='/reviews/public/decide'){
   if(req.body?.version!==1||req.body?.manifestHash!=='manifest-qa'||req.body?.proof!=='proof-2'||req.body?.decision!=='approved')return {status:409,json:{error:{code:'review_decision_check_required'}}};
   decided=true;return {json:{saved:true,status:'approved'}};
  }
  if(req.path==='/reviews/public')return {json:{manifestHash:'manifest-qa',review:{title:'Versão publicada QA',message:'',studioName:'Estúdio',clientName:'Cliente',projectName:'Projeto',status:decided?'approved':'pending',version:1,expiresAt:Date.now()+86400000,mode:'link',role:'reviewer'},assets:[{fileId:'FILE_REVIEW_12345',name:'Imagem.png',mimeType:'image/png'}],comments:[],decisions:[],mediaTickets:{FILE_REVIEW_12345:{url:api+'/reviews/media?ticket=synthetic.ticket',expiresAt:Date.now()+600000}}}};
 });
});
