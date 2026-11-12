import {test,expect} from './fixtures';
const web='http://127.0.0.1:4173',api='http://127.0.0.1:8787',invite='i'.repeat(43),session='s'.repeat(43);
test.skip(!process.env.VIRTUAL_LIBRARY_E2E,'Run with the dedicated virtual-library build/config.');
test('open-link portal exchanges invitation, protects media with session and resumes after reload without workspace registration',async({page,context})=>{
 const calls:string[]=[];
 const headers={'Access-Control-Allow-Origin':web,'Access-Control-Allow-Headers':'Authorization, Content-Type, X-Review-Token, X-Review-Session, Range','Access-Control-Allow-Methods':'GET, POST, HEAD, OPTIONS'};
 await context.route(api+'/**',async route=>{
  const req=route.request(),url=new URL(req.url());if(req.method()==='OPTIONS')return route.fulfill({status:204,headers});
  calls.push(url.pathname);
  if(url.pathname==='/reviews/public/session'){
   expect(req.headers()['x-review-token']).toBe(invite);return route.fulfill({headers,json:{session,expiresAt:Date.now()+30*60*1000}});
  }
  expect(req.headers()['x-review-session']).toBe(session);
  if(url.pathname==='/reviews/media')return route.fulfill({headers:{...headers,'Content-Type':'image/png'},body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64')});
  if(url.pathname==='/reviews/public')return route.fulfill({headers,json:{review:{title:'Versão publicada QA',message:'',studioName:'Estúdio',clientName:'Cliente',projectName:'Projeto',status:'pending',version:1,expiresAt:Date.now()+86400000,mode:'link',role:'reviewer'},assets:[{fileId:'FILE_REVIEW_12345',name:'Imagem.png',mimeType:'image/png'}],comments:[],decisions:[],mediaTickets:{FILE_REVIEW_12345:{url:api+'/reviews/media?ticket=synthetic.ticket',expiresAt:Date.now()+600000}}}});
  return route.fulfill({status:404,headers,json:{error:{code:'not_found'}}});
 });
 await page.goto(web+'/review#invite='+invite);
 await expect(page.getByText('Versão publicada QA',{exact:true}).first()).toBeVisible();
 await expect(page).toHaveURL(web+'/review');
 await expect.poll(()=>calls.includes('/reviews/media')).toBe(true);
 await page.reload();await expect(page.getByText('Versão publicada QA',{exact:true}).first()).toBeVisible();
 expect(calls.filter(x=>x==='/reviews/public/session')).toHaveLength(1);
 expect(calls.some(x=>x.startsWith('/access/')||x.startsWith('/account/'))).toBe(false);
 await expect(page.getByRole('button',{name:'Criar meu espaço de trabalho'})).toHaveCount(0);
});
