import {assertReviewPageGuards} from "./review-browser-guards";
import { chooseAppSelect } from "./select-helpers";
import {test,expect,type Page} from './fixtures';
import {initializeTestEnvironment} from '@firebase/rules-unit-testing';
import {collection,doc,getDocs,query,setDoc,where,Timestamp} from 'firebase/firestore';
const root='http://127.0.0.1:4173',api='https://roteiva-api-dev.ewertonmendes9.workers.dev';
const connection='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',folder='REVIEW_FOLDER_12345',childFolder='REVIEW_CHILD_FOLDER_12345';
const file={fileId:'REVIEW_FILE_12345678',name:'Corte.mp4',mimeType:'video/mp4'};
const second={fileId:'REVIEW_FILE_22345678',name:'Corte final.mp4',mimeType:'video/mp4',thumbnailTicket:'sealed-thumb-qa'};
const token='w'.repeat(43);

async function prepare(page:Page,email:string){
  await page.goto(root);
  await page.getByRole('button',{name:'Criar conta',exact:true}).click();
  const next=page.waitForEvent('popup');
  await page.getByRole('button',{name:'Cadastrar com Google',exact:true}).click();
  const popup=await next;await popup.waitForLoadState('load');
  await popup.getByRole('button',{name:'Add new account',exact:true}).click();
  await popup.locator('#email-input').fill(email);
  await popup.locator('#display-name-input').fill('QA Aprovações');
  await popup.locator('#sign-in').click();
  await page.getByLabel('Como podemos chamar você?').fill('QA Aprovações');
  await page.getByLabel('Concordo com o uso dos meus dados').check();
  await page.getByRole('button',{name:'Criar meu espaço de trabalho'}).click();
  await expect(page.locator('.app-shell')).toBeVisible();
  await page.goto(root+'/clientes');
  await page.getByRole('button',{name:'Novo cliente',exact:true}).click();
  await page.getByLabel('Nome do cliente',{exact:true}).fill('Cliente Revisão');
  await page.getByLabel('Contato principal',{exact:true}).fill('Cliente QA');
  await page.getByRole('button',{name:'Salvar cliente'}).click();
  await expect(page.getByText('Cliente Revisão',{exact:true})).toBeVisible();
  await expect(page.locator('[aria-busy]').first()).toHaveAttribute('aria-busy','false');
  await page.goto(root+'/projetos');
  await page.locator('.heading-actions').getByRole('button',{name:'Criar projeto',exact:true}).click();
  await page.getByLabel('Nome do projeto',{exact:true}).fill('Projeto Revisão');
  await chooseAppSelect(page, page.locator('form.project-modal .rt-select:has(input[name="clientId"]) .rt-select-trigger'), {label:'Cliente Revisão'});
  await page.locator('form.project-modal').getByRole('button',{name:'Criar projeto',exact:true}).click();
  await expect(page.locator('[aria-busy]').first()).toHaveAttribute('aria-busy','false');
  const env=await initializeTestEnvironment({projectId:'demo-roteiva',firestore:{host:'127.0.0.1',port:8080}});
  let projectId=0,clientId=0;
  try{await env.withSecurityRulesDisabled(async context=>{
    const db=context.firestore();
    const users=await getDocs(query(collection(db,'users'),where('email','==',email)));
    expect(users.size).toBe(1);const uid=users.docs[0].id;
    const projects=await getDocs(collection(db,'users',uid,'projects'));
    expect(projects.size).toBe(1);projectId=Number(projects.docs[0].id);clientId=projects.docs[0].data().clientId;
    await setDoc(doc(db,'users',uid,'driveFolders',projectId+'_'+connection+'_'+folder),{
      ownerUid:uid,schemaVersion:1,projectId,connectionId:connection,folderId:folder,
      folderName:'Materiais autorizados',createdAt:Timestamp.now()});
  });}finally{await env.cleanup();}
  return {projectId,clientId};
}

test('profissional cria, cliente comenta/pede ajustes, V2 aprovada e encerramento bloqueia link',async({page,context},info)=>{
  const {projectId,clientId}=await prepare(page,'reviews-cycle-'+info.project.name+'@example.com');
  const review={id:'review-e2e',clientId,projectId,clientName:'Cliente Revisão',projectName:'Projeto Revisão',
    studioName:'Estúdio QA',title:'',message:'',recipientEmail:'',mode:'link',status:'draft',version:1,
    expiresAt:Date.now()+86400000,createdAt:Date.now(),updatedAt:Date.now(),url:root+'/review/'+token};
  let created=false,selected=[file],createCalls=0,publishCalls=0,revisionCalls=0,closeCalls=0;
  const searchTerms:string[]=[];let thumbCalls=0;
  const uploaded={id:'UPLOADED_REVIEW_12345',name:'Envio.mp4',mimeType:'video/mp4',size:'300000'};
  let uploadConfirmed=false,attemptId='',putCalls=0,releaseUpload!:()=>void;
  const uploadGate=new Promise<void>(resolve=>{releaseUpload=resolve;});
  await context.route('https://www.googleapis.com/upload/drive/v3/files?upload_id=reviews-e2e',async route=>{
    const req=route.request(),headers={'Access-Control-Allow-Origin':root,
      'Access-Control-Allow-Methods':'PUT,OPTIONS','Access-Control-Allow-Headers':'Content-Type,Content-Range',
      'Access-Control-Expose-Headers':'Range'};
    if(req.method()==='OPTIONS')return route.fulfill({status:204,headers});
    expect(req.method()).toBe('PUT');putCalls++;
    if(putCalls===1){
      expect(req.headers()['content-range']).toBe('bytes 0-262143/300000');
      expect(req.postDataBuffer()?.length).toBe(262144);await uploadGate;
      return route.fulfill({status:308,headers:{...headers,Range:'bytes=0-262143'}});
    }
    expect(req.headers()['content-range']).toBe('bytes 262144-299999/300000');
    expect(req.postDataBuffer()?.length).toBe(37856);
    return route.fulfill({status:201,headers,contentType:'application/json',body:JSON.stringify(uploaded)});
  });
  const comments:Record<string,unknown>[]=[],decisions:Record<string,unknown>[]=[];
  const detail=()=>({review,assets:selected.map(f=>({...f,version:review.version,grantState:'granted',
    connectionId:connection,linkedFolderId:folder})),comments,decisions});
  await context.route(api+'/**',async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname;
    if(!path.startsWith('/reviews')&&!path.includes('/folders/')&&!path.endsWith('/thumbnail')&&!path.endsWith('/metadata'))return route.fallback();
    const headers={'Access-Control-Allow-Origin':root,'Access-Control-Allow-Methods':'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers':'Authorization,Content-Type,X-Review-Token','Cache-Control':'no-store'};
    const json=(body:unknown,status=200)=>route.fulfill({status,headers,contentType:'application/json',body:JSON.stringify(body)});
    if(req.method()==='OPTIONS')return route.fulfill({status:204,headers});
    if(path.endsWith('/metadata')){
      expect(req.method()).toBe('GET');
      expect(req.headers().authorization).toMatch(/^Bearer /);
      const id=url.searchParams.get('fileId');
      expect([file.fileId,uploaded.id,second.fileId]).toContain(id);
      return json({file:{id,parents:[id===file.fileId?childFolder:folder]}});
    }
    if(path.endsWith('/thumbnail')){
      expect(req.headers().authorization).toMatch(/^Bearer /);
      const ticket=url.searchParams.get('ticket');
      if(ticket)expect(ticket).toBe('sealed-thumb-qa');
      else expect([file.fileId,uploaded.id,second.fileId]).toContain(path.split('/').at(-2));
      thumbCalls++;
      return route.fulfill({status:200,headers,contentType:'image/png',
        body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2qFqsAAAAASUVORK5CYII=','base64')});
    }
    if(path.startsWith('/reviews/public')){
      expect(req.headers()['x-review-token']).toBe(token);
      if(review.status==='closed')return json({error:{code:'review_not_found'}},404);
      if(req.method()==='GET')return json({...detail(),assets:selected});
      // HTML5 streaming is optional: this account's selected Drive file doesn't
      // permit alt=media. The real portal must fall back to Drive preview while
      // keeping manual timecodes and all customer review actions available.
      if(path.endsWith('/media-ticket')){
        expect(req.postDataJSON().version).toBe(review.version);
        return json({error:{code:'media_unavailable'}},409);
      }
      const body=req.postDataJSON();expect(body.version).toBe(review.version);expect(body.authorName).toBe('Cliente QA');
      expect(review.status).toBe('pending');
      if(path.endsWith('/comment')){
        expect(selected.some(f=>f.fileId===body.fileId)).toBe(true);
        expect(body.body).toBe('Aumentar legenda');expect(body.seconds).toBe(35);
        comments.push({id:'comment-1',version:review.version,file_id:body.fileId,
          author_name:body.authorName,body:body.body,seconds:body.seconds,created_at:Date.now()});
      }else{
        expect(['approved','changes']).toContain(body.decision);
        if(body.decision==='changes')expect(body.message).toBe('Ajustar encerramento');
        review.status=body.decision;decisions.push({version:review.version,decision:body.decision,
          author_name:body.authorName,message:body.message,created_at:Date.now()});
      }
      return json({saved:true});
    }
    expect(req.headers().authorization).toMatch(/^Bearer /);
    if(path.endsWith('/uploads')){
      const body=req.postDataJSON();expect(body.projectId).toBe(projectId);expect(body.linkedFolderId).toBe(folder);
      expect(body.name).toBe(uploaded.name);expect(body.size).toBe(300000);expect(body.mimeType).toBe('video/mp4');
      attemptId=body.attemptId;expect(attemptId).toMatch(/^[a-f0-9-]{36}$/);
      return json({attemptId,sessionUrl:'https://www.googleapis.com/upload/drive/v3/files?upload_id=reviews-e2e',chunkSize:262144});
    }
    if(path.endsWith('/uploads/complete')){
      expect(req.postDataJSON()).toEqual({attemptId,projectId,linkedFolderId:folder,fileId:uploaded.id,size:300000});
      expect(putCalls).toBe(2);uploadConfirmed=true;return json({file:uploaded});
    }
    if(path.endsWith('/items')){
      const term=url.searchParams.get('search');
      if(term)searchTerms.push(term);
      const all=[...([file,second].map(f=>({...f,id:f.fileId}))),...(uploadConfirmed?[uploaded]:[])];
      return json({files:term?all.filter(f=>f.name.toLowerCase().includes(term.toLowerCase())):all,nextPageToken:null});
    }
    if(path==='/reviews'&&req.method()==='GET')return json({reviews:created?[review]:[],hasMore:false});
    if(path==='/reviews'&&req.method()==='POST'){
      const body=req.postDataJSON();expect(body.clientId).toBe(clientId);expect(body.projectId).toBe(projectId);
      expect(uploadConfirmed).toBe(true);
      expect(body.assets).toEqual([file.fileId,uploaded.id].map(fileId=>({fileId,connectionId:connection,linkedFolderId:folder,provider:'google_drive'})));
      expect(body.mode).toBe('link');expect(body.expiresInDays).toBe(14);expect(body.title).toBe('Corte para revisão');
      created=true;createCalls++;review.title=body.title;selected=[file,{...uploaded,fileId:uploaded.id}];return json({id:review.id},201);
    }
    if(path.endsWith('/publish')){expect(created).toBe(true);publishCalls++;review.status='pending';return json({review:detail()});}
    if(path.endsWith('/revise')){
      expect(review.status).toBe('changes');
      expect(req.postDataJSON().assets).toEqual([{fileId:second.fileId,connectionId:connection,linkedFolderId:folder,provider:'google_drive'}]);
      revisionCalls++;selected=[second];review.version=2;review.status='pending';return json({review:detail()});
    }
    if(path.endsWith('/close')){closeCalls++;review.status='closed';return json({closed:true});}
    if(path==='/reviews/'+review.id)return json(detail());
    throw new Error('Unexpected review request: '+path);
  });
  await page.goto(root+'/aprovacoes');
  await page.getByRole('button',{name:'Nova aprovação',exact:true}).click();
  const composer=page.getByRole('dialog',{name:'Enviar materiais para aprovação'});
  await expect(composer.getByText('Selecione um cliente.',{exact:true})).toBeVisible();
  await composer.getByRole('button',{name:'Selecionar materiais'}).click();
  await expect(composer.getByRole('alert')).toContainText('Selecione um cliente.');
  await chooseAppSelect(page, composer.getByRole('combobox',{name:'Cliente',exact:true}), {label:'Cliente Revisão'});
  await chooseAppSelect(page, composer.getByRole('combobox',{name:'Projeto',exact:true}), {label:'Projeto Revisão'});
  await composer.getByLabel('Título da aprovação').fill('Corte para revisão');
  await chooseAppSelect(page, composer.getByRole('combobox',{name:'Tipo de acesso'}), 'google');
  const directAccess=composer.getByRole('checkbox',{name:/Permitir abrir também pelo Google Drive/});
  await expect(directAccess).not.toBeChecked();
  await directAccess.check();
  const removePublic=composer.getByRole('checkbox',{name:/Remover acesso público existente no Drive/});
  await expect(removePublic).toBeVisible();
  await expect(removePublic).not.toBeChecked();
  await chooseAppSelect(page, composer.getByRole('combobox',{name:'Tipo de acesso'}), 'link');
  await expect(removePublic).toHaveCount(0);
  await composer.getByRole('button',{name:'Selecionar materiais'}).click();
  await expect(composer.locator('.review-folder-tabs button.active')).toHaveText('Materiais autorizados · Drive');
  await expect(composer.getByRole('link',{name:'Abrir pasta no Drive'})).toHaveAttribute(
    'href','https://drive.google.com/drive/folders/'+folder);
  await expect(composer.getByRole('link',{name:'Abrir Corte final.mp4 no Google Drive'}))
    .toHaveAttribute('href',new RegExp('drive.google.com'));
  const thumb=composer.locator('[data-mime="video/mp4"][data-thumbnail-state]').last();
  await thumb.scrollIntoViewIfNeeded();
  await expect(thumb).toHaveAttribute('data-thumbnail-state','loaded');
  const driveSearch=composer.getByRole('searchbox',{name:'Buscar arquivos na pasta'});
  await driveSearch.fill('Corte final');
  await expect(composer.getByText('Corte final.mp4',{exact:true})).toBeVisible();
  await expect(composer.getByText('Corte.mp4',{exact:true})).toHaveCount(0);
  await expect.poll(()=>searchTerms.includes('Corte final')).toBe(true);
  await driveSearch.fill('');
  await expect(composer.getByText('Corte.mp4',{exact:true})).toBeVisible();
  await composer.getByText('Corte.mp4',{exact:true}).click();
  await composer.locator('input[type=file]').setInputFiles({name:uploaded.name,mimeType:'video/mp4',buffer:Buffer.alloc(300000)});
  await expect(composer.getByRole('button',{name:'Gerar aprovação'})).toBeDisabled();
  releaseUpload();
  await expect(composer.locator('.review-composer-footnote')).toContainText('2 material(is) selecionado(s)');
  await expect(composer.getByRole('button',{name:'Gerar aprovação'})).toBeEnabled();
  await composer.getByRole('button',{name:'Gerar aprovação'}).click();
  const owner=page.getByRole('dialog',{name:'Detalhes da revisão'});
  const gallery=owner.getByLabel('Galeria de materiais');
  await expect(gallery.getByRole('button',{name:'Selecionar arquivo Corte.mp4'})).toHaveAttribute('aria-pressed','true');
  const cardThumb=gallery.getByRole('button',{name:'Selecionar arquivo Corte.mp4'}).locator('[data-thumbnail-state]');
  await cardThumb.scrollIntoViewIfNeeded();
  await expect(cardThumb).toHaveAttribute('data-thumbnail-state','loaded');
  await expect(gallery.getByRole('button',{name:'Selecionar arquivo Envio.mp4'})).toHaveCount(1);
  const sharing=owner.getByRole('region',{name:'Compartilhar aprovação'});
  const summary=owner.getByRole('region',{name:'Situação da aprovação'});
  await expect(sharing.getByLabel('Link da revisão')).toHaveValue(review.url);
  await expect(sharing.getByRole('button',{name:/Copiar link/})).toBeVisible();
  await expect(sharing.getByRole('link',{name:/Compartilhar aprovação por WhatsApp/})).toBeVisible();
  const [sharingBounds,summaryBounds]=await Promise.all([sharing.boundingBox(),summary.boundingBox()]);
  expect(sharingBounds).toBeTruthy();expect(summaryBounds).toBeTruthy();
  expect(sharingBounds!.y).toBeLessThan(summaryBounds!.y);
  const folderLink=owner.getByRole('link',{name:'Abrir pasta do arquivo no Google Drive'});
  await expect(folderLink).toHaveAttribute('href','https://drive.google.com/drive/folders/'+childFolder);
  await expect(owner.getByRole('link',{name:'Abrir arquivo Corte.mp4 no Google Drive'}))
    .toHaveAttribute('href','https://drive.google.com/file/d/'+file.fileId+'/view');
  await owner.getByRole('button',{name:/Envio.mp4/}).click();
  await expect(folderLink).toHaveAttribute('href','https://drive.google.com/drive/folders/'+folder);
  await page.screenshot({path:info.outputPath('professional-review.png'),fullPage:true});
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.reload();await expect(page.getByText('Corte para revisão',{exact:true})).toBeVisible();
  const guest=await context.newPage();await guest.goto(review.url);
  await guest.getByPlaceholder('Como podemos chamar você?').fill('Cliente QA');
  await guest.getByPlaceholder('O que você gostaria de comentar?').fill('Aumentar legenda');
  await guest.getByPlaceholder('Ex.: 01:25').fill('00:35');
  await guest.getByRole('button',{name:'Adicionar comentário'}).click();
  await expect(guest.getByText('Aumentar legenda',{exact:true})).toBeVisible();
  await guest.getByRole('button',{name:'Solicitar ajustes',exact:true}).click();
  await guest.getByPlaceholder('Descreva os ajustes desejados…').fill('Ajustar encerramento');
  await guest.getByRole('button',{name:'Confirmar decisão'}).click();
  await expect(guest.getByRole('heading',{name:'Feedback enviado'})).toBeVisible();
  await page.reload();await page.getByText('Corte para revisão',{exact:true}).click();
  const ownerDetail=page.getByRole('dialog',{name:'Detalhes da revisão'});
  await expect(ownerDetail.getByText('O cliente pediu alterações')).toBeVisible();
  await expect(ownerDetail.getByText('Ajustar encerramento',{exact:true})).toBeVisible();
  await expect(ownerDetail.getByText('Aumentar legenda',{exact:true})).toBeVisible();
  await expect(ownerDetail.getByRole('button',{name:'Ver material Corte.mp4 no minuto 0:35'})).toBeVisible();
  await ownerDetail.getByRole('button',{name:'Ver material Corte.mp4 no minuto 0:35'}).click();
  await expect(ownerDetail.getByText(/A prévia do Drive não permite avançar automaticamente/)).toBeVisible();
  await expect(ownerDetail.locator('iframe[title="Prévia de Corte.mp4"]')).toHaveCount(1);
  await page.screenshot({path:info.outputPath('professional-contextual-feedback.png'),fullPage:true});
  await page.getByRole('button',{name:'Enviar nova versão',exact:true}).click();
  await expect(composer.locator('.review-folder-tabs button.active')).toHaveText('Materiais autorizados · Drive');
  await composer.getByText('Corte final.mp4',{exact:true}).click();
  await composer.getByRole('button',{name:'Enviar nova versão',exact:true}).click();
  await expect(page.getByLabel('Link da revisão')).toBeVisible();
  await guest.reload();await expect(guest.getByText('Versão 2',{exact:true})).toBeVisible();
  await guest.getByPlaceholder('Como podemos chamar você?').fill('Cliente QA');
  await guest.getByRole('button',{name:'Aprovar material'}).click();
  await guest.getByRole('button',{name:'Confirmar decisão'}).click();
  await expect(guest.getByRole('heading',{name:'Material aprovado'})).toBeVisible();
  await guest.screenshot({path:info.outputPath('customer-approved-v2.png'),fullPage:true});
  await page.keyboard.press('Escape');await page.reload();await page.getByText('Corte para revisão',{exact:true}).click();
  await expect(page.getByText('Material aprovado · V2')).toBeVisible();
  const approvedDetail=page.getByRole('dialog',{name:'Detalhes da revisão'});
  await expect(approvedDetail.getByRole('heading',{name:'Materiais · V2'})).toBeVisible();
  await expect(approvedDetail.getByText('Aumentar legenda',{exact:true})).toBeHidden();
  await approvedDetail.getByText('Histórico das versões anteriores').click();
  await expect(approvedDetail.getByText('Ajustar encerramento',{exact:true})).toBeVisible();
  await expect(approvedDetail.getByText('Aumentar legenda',{exact:true})).toBeVisible();
  page.once('dialog',dialog=>dialog.accept());
  await page.getByRole('button',{name:'Encerrar revisão',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await guest.reload();await expect(guest.getByRole('heading',{name:'Material indisponível'})).toBeVisible();
  expect(thumbCalls).toBeGreaterThan(0);
  expect({createCalls,publishCalls,revisionCalls,closeCalls}).toEqual({createCalls:1,publishCalls:1,revisionCalls:1,closeCalls:1});
  await guest.close();
});

test('galeria de aprovação mantém miniaturas e filtros rápidos com mais de 20 arquivos',async({page,context},info)=>{
  const {clientId,projectId}=await prepare(page,'reviews-many-'+info.project.name+'@example.com');
  const items=Array.from({length:23},(_,i)=>{
    const num=String(i+1).padStart(2,'0');
    const image=i%2===0;
    return {fileId:'QA_MATERIAL_'+num+'_1234567890',name:(image?'Arte ':'Vídeo ')+num+(image?'.png':'.mp4'),
      mimeType:image?'image/png':'video/mp4',version:1,grantState:'granted',
      connectionId:connection,linkedFolderId:folder};
  });
  let calls=0;
  const data={review:{id:'review-many',clientId,projectId,clientName:'Cliente Revisão',
    projectName:'Projeto Revisão',studioName:'Estúdio QA',title:'Campanha completa',message:'',
    recipientEmail:'',mode:'link',status:'pending',version:1,
    expiresAt:Date.now()+86400000,createdAt:Date.now(),updatedAt:Date.now(),
    url:root+'/review/'+token},assets:items,comments:[],decisions:[]};
  await context.route(api+'/**',async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname;
    if(req.method()==='OPTIONS')return route.fulfill({status:204,headers:{
      'Access-Control-Allow-Origin':root,'Access-Control-Allow-Methods':'GET,POST',
      'Access-Control-Allow-Headers':'Authorization,Content-Type'}});
    const headers={'Access-Control-Allow-Origin':root,'Cache-Control':'no-store'};
    if(path.endsWith('/thumbnail')){
      calls++;
      expect(req.headers().authorization).toMatch(/^Bearer /);
      const id=path.split('/').at(-2)||'';
      if(id===items[4].fileId)return route.fulfill({status:404,headers,
        contentType:'application/json',body:JSON.stringify({error:{code:'thumbnail_unavailable'}})});
      return route.fulfill({status:200,headers,contentType:'image/png',
        body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2qFqsAAAAASUVORK5CYII=','base64')});
    }
    if(path==='/reviews/review-many/image'){
      expect(req.headers().authorization).toMatch(/^Bearer /);
      expect(items.some(item=>item.fileId===url.searchParams.get('fileId')&&item.mimeType.startsWith('image/'))).toBe(true);
      return route.fulfill({status:200,headers:{...headers,'Cache-Control':'private, no-store'},
        contentType:'image/png',
        body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2qFqsAAAAASUVORK5CYII=','base64')});
    }
    if(path.endsWith('/metadata'))return route.fulfill({status:200,headers,contentType:'application/json',
      body:JSON.stringify({file:{parents:[folder]}})});
    if(path==='/reviews')return route.fulfill({status:200,headers,contentType:'application/json',
      body:JSON.stringify({reviews:[data.review],hasMore:false})});
    if(path==='/reviews/review-many')return route.fulfill({status:200,headers,contentType:'application/json',
      body:JSON.stringify(data)});
    return route.fallback();
  });
  await page.goto(root+'/aprovacoes');
  await page.getByText('Campanha completa',{exact:true}).click();
  const owner=page.getByRole('dialog',{name:'Detalhes da revisão'});
  const gallery=owner.getByLabel('Galeria de materiais');
  await expect(gallery.getByRole('button')).toHaveCount(6);
  const first=gallery.getByRole('button',{name:'Selecionar arquivo Arte 01.png'});
  await first.scrollIntoViewIfNeeded();
  await expect(first.locator('[data-thumbnail-state]')).toHaveAttribute('data-thumbnail-state','loaded');
  expect(calls).toBeLessThan(23);
  const ownerImage=owner.locator('.rowner-preview-stage.is-image .review-image-viewport');
  await expect(ownerImage).toBeVisible();
  await expect(owner.locator('.rowner-preview-stage.is-image img.review-private-preview-image')).toHaveAttribute('src',/^blob:/);
  await ownerImage.hover();
  const ownerScroller=owner.locator('.rowner-body');
  const ownerScrollBefore=await ownerScroller.evaluate(el=>el.scrollTop);
  await page.mouse.wheel(0,-160);
  await expect(owner.locator('.rowner-preview-stage.is-image').getByLabel('Zoom da imagem')).toHaveText('120%');
  expect(await ownerScroller.evaluate(el=>el.scrollTop)).toBe(ownerScrollBefore);
  await owner.locator('.rowner-preview-stage.is-image .rz-zoom-toolbar output').hover();
  const secondScrollBefore=await ownerScroller.evaluate(el=>el.scrollTop);
  await page.mouse.wheel(0,-160);
  await expect(owner.locator('.rowner-preview-stage.is-image').getByLabel('Zoom da imagem')).toHaveText('144%');
  expect(await ownerScroller.evaluate(el=>el.scrollTop)).toBe(secondScrollBefore);
  await owner.getByRole('button',{name:'Ver materiais em lista'}).click();
  await expect(gallery).toHaveAttribute('data-view','list');
  await owner.getByRole('button',{name:'Ver materiais em grade'}).click();
  await expect(gallery).toHaveAttribute('data-view','grid');
  await owner.getByRole('button',{name:/Mostrar mais 6 de 17 arquivos/}).click();
  await expect(gallery.getByRole('button')).toHaveCount(12);
  await owner.getByRole('searchbox',{name:'Buscar materiais por nome'}).fill('Vídeo 22');
  await expect(gallery.getByRole('button')).toHaveCount(1);
  await gallery.getByRole('button',{name:'Selecionar arquivo Vídeo 22.mp4'}).click();
  await expect(owner.locator('iframe[title="Prévia de Vídeo 22.mp4"]')).toHaveCount(1);
  await owner.getByRole('searchbox',{name:'Buscar materiais por nome'}).fill('');
  await chooseAppSelect(page, owner.getByRole('combobox',{name:'Filtrar materiais por tipo'}), 'image');
  await expect(gallery.getByRole('button')).toHaveCount(6);
  await owner.getByRole('button',{name:/Mostrar mais 6 de 6 arquivos/}).click();
  await expect(gallery.getByRole('button')).toHaveCount(12);
  const noThumbnail=gallery.getByRole('button',{name:'Selecionar arquivo Arte 05.png'});
  await noThumbnail.scrollIntoViewIfNeeded();
  await expect(noThumbnail.locator('[data-thumbnail-state]')).toHaveAttribute('data-thumbnail-state','unavailable');
  await page.screenshot({path:info.outputPath('review-thumbnail-gallery.png'),fullPage:true});
});

test('Google-only review renders private images in both themes without third-party Drive cookies',async({page,context},info)=>{
  await page.emulateMedia({colorScheme:'light'});
  await prepare(page,'reviews-private-preview-'+info.project.name+'@example.com');
  const first={fileId:'REVIEW_IMAGE_12345678',name:'Arte.png',mimeType:'image/png'};
  const second={fileId:'REVIEW_IMAGE_22345678',name:'Arte final.png',mimeType:'image/png'};
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2qFqsAAAAASUVORK5CYII=','base64');
  let denied=false,requests=0;
  const mediaGets=new Map<string,number>();
  await context.route(api+'/reviews/public**',async route=>{
    const req=route.request(),path=new URL(req.url()).pathname;
    const headers={'Access-Control-Allow-Origin':root,'Access-Control-Allow-Methods':'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers':'Authorization,Content-Type,X-Review-Token',
      'Access-Control-Expose-Headers':'Content-Range,Content-Length,Content-Type','Cache-Control':'no-store'};
    if(req.method()==='OPTIONS')return route.fulfill({status:204,headers});
    expect(req.headers()['x-review-token']).toBe(token);
    expect(req.headers().authorization).toMatch(/^Bearer /);
    if(path==='/reviews/public')return route.fulfill({status:200,headers,contentType:'application/json',
      body:JSON.stringify({review:{title:'Arte com acesso privado',studioName:'Estúdio QA',message:'',
        mode:'google',role:'reviewer',version:1,status:'pending',expiresAt:Date.now()+86400000},
        assets:[first,second],comments:[],decisions:[]})});
    if(path==='/reviews/public/media-ticket'){
      requests++;
      const params=req.postDataJSON();
      expect(params).toEqual({fileId:expect.any(String),version:1});
      if(denied&&params.fileId===second.fileId)
        return route.fulfill({status:403,headers,contentType:'application/json',
          body:JSON.stringify({error:{code:'review_recipient_denied'}})});
      return route.fulfill({status:200,headers,contentType:'application/json',
        body:JSON.stringify({url:api+'/reviews/media?ticket='+params.fileId,expiresAt:Date.now()+600000})});
    }
    return route.fulfill({status:404,headers,body:'{}'});
  });
  await context.route(api+'/reviews/media?*',async route=>{
    const id=new URL(route.request().url()).searchParams.get('ticket')||'';
    mediaGets.set(id,(mediaGets.get(id)||0)+1);
    return route.fulfill({status:200,contentType:'image/png',
      headers:{'Access-Control-Allow-Origin':root,'Cache-Control':'private, no-store',
        'Content-Length':String(png.byteLength)},body:png});
  });
  await page.goto(root+'/review/'+token);
  await expect(page.getByRole('heading',{name:'Arte com acesso privado'})).toBeVisible();
  await assertReviewPageGuards(page);
  const preview=page.locator('img.review-private-preview-image');
  await expect(preview).toBeVisible();
  await expect(preview).toHaveAttribute('src',/^blob:/);
  await expect(page.locator('.review-portal-stage iframe')).toHaveCount(0);
  const stage=page.locator('.review-portal-stage.is-image');
  await expect(stage).toBeVisible();
  await expect(preview).toHaveCSS('object-fit','contain');
  const viewport=stage.locator('.review-image-viewport');
  const dimensions=await stage.evaluate(el=>{
    const box=el.getBoundingClientRect();
    const image=el.querySelector('img')!.getBoundingClientRect();
    return {stageHeight:box.height,imageHeight:image.height,stageWidth:box.width,imageWidth:image.width};
  });
  expect(dimensions.imageHeight).toBeLessThanOrEqual(dimensions.stageHeight+1);
  expect(dimensions.imageWidth).toBeLessThanOrEqual(dimensions.stageWidth+1);
  await stage.getByRole('button',{name:'Ampliar zoom'}).click();
  await expect(stage.getByLabel('Zoom da imagem')).toHaveText('130%');
  await stage.getByRole('button',{name:'Ajustar imagem à tela'}).click();
  await expect(stage.getByLabel('Zoom da imagem')).toHaveText('100%');
  await viewport.hover();
  const pageScrollBefore=await page.evaluate(()=>document.scrollingElement?.scrollTop||0);
  await page.mouse.wheel(0,-180);
  await expect(stage.getByLabel('Zoom da imagem')).toHaveText('120%');
  expect(await page.evaluate(()=>document.scrollingElement?.scrollTop||0)).toBe(pageScrollBefore);
  await stage.locator('.rz-zoom-toolbar output').hover();
  const toolbarScrollBefore=await page.evaluate(()=>document.scrollingElement?.scrollTop||0);
  await page.mouse.wheel(0,-180);
  await expect(stage.getByLabel('Zoom da imagem')).toHaveText('144%');
  expect(await page.evaluate(()=>document.scrollingElement?.scrollTop||0)).toBe(toolbarScrollBefore);
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.getByRole('heading',{name:'Arte com acesso privado'}).hover();
  await page.mouse.wheel(0,420);
  await expect.poll(()=>page.evaluate(()=>document.scrollingElement?.scrollTop||0)).toBeGreaterThan(0);
  await stage.getByRole('button',{name:'Ajustar imagem à tela'}).click();
  await viewport.dblclick({position:{x:140,y:120}});
  await expect(stage.getByLabel('Zoom da imagem')).toHaveText('200%');
  await stage.getByRole('button',{name:'Ver imagem em tela cheia'}).click();
  await expect(page.getByRole('dialog',{name:'Imagem ampliada: Arte.png'})).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog',{name:'Imagem ampliada: Arte.png'})).toHaveCount(0);
  await stage.getByRole('button',{name:'Ajustar imagem à tela'}).click();
  await expect(page.locator('.review-portal-stage.is-private')).toBeVisible();
  await page.getByRole('button',{name:'Ativar tema escuro'}).click();
  await expect(page.locator('main.review-portal')).toHaveAttribute('data-theme','dark');
  await page.getByRole('button',{name:'Ativar tema claro'}).click();
  await expect(page.locator('main.review-portal')).toHaveAttribute('data-theme','light');
  denied=true;
  await page.getByRole('button',{name:'Arte final.png'}).click();
  await expect(page.getByText('Não foi possível mostrar a prévia')).toBeVisible();
  await expect(page.locator('.review-portal-stage iframe')).toHaveCount(0);
  denied=false;
  await page.getByRole('button',{name:'Tentar novamente'}).click();
  await expect(preview).toBeVisible();
  await expect(preview).toHaveAttribute('src',/^blob:/);
  await page.getByRole('button',{name:'Arte.png'}).click();
  await expect(preview).toBeVisible();
  await expect(preview).toHaveAttribute('src',/^blob:/);
  expect(mediaGets.get(first.fileId)).toBe(1);
  expect(mediaGets.get(second.fileId)).toBe(1);
  expect(requests).toBe(3); // first, denied second, retried second; back to first uses memory
});


test('Dropbox: vincular pasta funciona com Todos os projetos, sem mudar o filtro global',async({page,context},info)=>{
  const email='dropbox-link-'+info.project.name+'@example.com';
  const {projectId}=await prepare(page,email);
  const connectionId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const linkedFolderId='id:AAAAAAAAAAAAAAABBBBBBBB';
  let attempts=0;
  await context.route(api+'/integrations/dropbox**',async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname;
    const headers={
      'Access-Control-Allow-Origin':root,
      'Access-Control-Allow-Methods':'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers':'Authorization,Content-Type',
      'Cache-Control':'no-store'
    };
    if(req.method()==='OPTIONS')return route.fulfill({status:204,headers});
    const json=(data:unknown,status=200)=>route.fulfill({status,headers,contentType:'application/json',body:JSON.stringify(data)});
    if(path==='/integrations/dropbox')return json({connections:[{
      id:connectionId,email:'qa-dropbox@example.com',status:'connected',
      scopes:'account_info.read files.metadata.read files.content.read files.content.write'
    }]});
    if(path==='/integrations/dropbox/'+connectionId+'/folders'){
      attempts++;
      if(attempts===1)return json({error:{code:'dropbox_unavailable'}},502);
      return json({folder:{id:'root',name:'Meu Dropbox'},files:[{
        id:linkedFolderId,name:'Materiais Dropbox',mimeType:'application/vnd.roteiva.folder',isFolder:true
      }],nextPageToken:null});
    }
    if(path==='/integrations/dropbox/'+connectionId+'/folders/'+encodeURIComponent(linkedFolderId)+'/items'||
      path==='/integrations/dropbox/'+connectionId+'/folders/'+linkedFolderId+'/items')
      return json({folder:{id:linkedFolderId,name:'Materiais Dropbox'},files:[],nextPageToken:null});
    return route.fallback();
  });
  await page.goto(root+'/biblioteca?driveE2E=1');
  await page.getByRole('tab',{name:'Dropbox'}).click();
  const library=page.getByRole('region',{name:'Biblioteca Dropbox'});
  await expect(library.getByText('Dropbox conectado')).toBeVisible();
  const linkButton=library.getByRole('button',{name:'Vincular pasta',exact:true});
  await expect(linkButton).toBeEnabled();
  await linkButton.click();
  const dialog=page.getByRole('dialog',{name:'Vincular pasta Dropbox'});
  await expect(dialog).toBeVisible();
  // One available project: the project picker must be usable even when the
  // global filter says "Todos os projetos".
  await expect(dialog.getByRole('combobox',{name:'Projeto para vincular a pasta'})).toContainText('Projeto Revisão');
  await expect(dialog.getByRole('alert')).toContainText('Dropbox');
  await dialog.getByRole('button',{name:'Tentar novamente'}).click();
  await expect(dialog.getByRole('button',{name:'Vincular',exact:true})).toBeEnabled();
  await dialog.getByRole('button',{name:'Vincular',exact:true}).click();
  await expect(dialog).not.toBeVisible();
  await expect(library.getByLabel('Pastas Dropbox vinculadas').getByText('Materiais Dropbox',{exact:true})).toBeVisible();
  const env=await initializeTestEnvironment({projectId:'demo-roteiva',firestore:{host:'127.0.0.1',port:8080}});
  try{await env.withSecurityRulesDisabled(async admin=>{
    const db=admin.firestore();
    const users=await getDocs(query(collection(db,'users'),where('email','==',email)));
    expect(users.size).toBe(1);
    const links=await getDocs(collection(db,'users',users.docs[0].id,'dropboxFolders'));
    expect(links.size).toBe(1);
    expect(links.docs[0].data()).toMatchObject({
      projectId,connectionId,folderId:linkedFolderId,folderName:'Materiais Dropbox'
    });
  });}finally{await env.cleanup();}
});
