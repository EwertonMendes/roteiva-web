import {expect,test} from '@playwright/test';
import {createServer} from 'node:http';
import {once} from 'node:events';

const app='https://app.roteiva.com';
const preview='http://127.0.0.1:5012';
const token='a'.repeat(43);

test('redirects every legacy route, including project and client details',async({request})=>{
  for(const path of ['/index.html', '/projetos', '/projetos/123', '/clientes', '/clientes/123',
    '/calendario', '/financeiro', '/biblioteca', '/configuracoes', '/aprovacoes', '/review',
    '/review/'+token]){
    const url=path+'?source=legacy&billing=return';
    const response=await request.get(url,{maxRedirects:0});
    expect(response.status(),path).toBe(302);
    expect(response.headers().location,path).toBe(app+url);
  }
});

test('the browser keeps the path, query and invitation fragment on the new origin',async({page})=>{
  const destination=createServer((_,res)=>{
    res.writeHead(200,{'Content-Type':'text/html'});
    res.end('<h1>Destino isolado</h1>');
  }).listen(0,'127.0.0.1');
  await once(destination,'listening');
  const address=destination.address();
  if(!address||typeof address==='string')throw Error('Isolated destination unavailable');
  const appFixture='http://127.0.0.1:'+address.port;
  try{
    await page.route(preview+'/**',async route=>{
      const response=await route.fetch({maxRedirects:0});
      expect(response.status()).toBe(302);
      const location=new URL(response.headers().location);
      expect(location.origin).toBe(app);
      // Only replace the origin with the loopback fixture. Chromium processes
      // the actual 302 and must inherit the fragment on a cross-origin redirect.
      await route.fulfill({response,headers:{...response.headers(),location:appFixture+location.pathname+location.search}});
    });
    for(const url of ['/review?source=legacy#invite='+token,'/review/'+token+'?source=legacy#section',
      '/biblioteca?drive=connected#folder']){
      await page.goto(url);
      await expect(page).toHaveURL(appFixture+url);
      await expect(page.getByRole('heading',{name:'Destino isolado'})).toBeVisible();
    }
  }finally{
    destination.closeAllConnections();
    destination.close();
  }
});

test('the homepage serves the announcement and links to the app at desktop and mobile widths',async({page})=>{
  const response=await page.goto('/?source=legacy');
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading',{name:'Vem novidade por aí.'})).toBeVisible();
  expect(await page.locator('html').evaluate(el=>getComputedStyle(el).colorScheme)).toBe('dark');
  await expect(page.getByRole('img',{name:'Roteiva',exact:true})).toHaveAttribute('src','/brand/roteiva-wordmark-white.svg');
  await expect(page.getByRole('link',{name:'Acessar o aplicativo'})).toHaveAttribute('href',app+'/');
  await expect(page.getByRole('link',{name:'Privacidade',exact:true})).toBeVisible();
  expect(await page.locator('html').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
});

test('legacy billing returns on the homepage still reach the app',async({page})=>{
  await page.route(app+'/**',route=>route.fulfill({contentType:'text/html',body:'<h1>Destino isolado</h1>'}));
  await page.goto('/?billing=return#section',{waitUntil:'commit'});
  await expect(page).toHaveURL(app+'/?billing=return#section');
  await expect(page.getByRole('heading',{name:'Destino isolado'})).toBeVisible();
});

test('public documents and assets are available independently of React',async({request})=>{
  for(const path of ['/sobre.html','/suporte.html','/privacidade.html','/termos.html',
    '/googleb5008dcbf685c696.html','/legal.css','/brand/roteiva-wordmark-black.svg']){
    const response=await request.get(path,{maxRedirects:0});
    expect(response.status(),path).toBe(200);
    expect(await response.text(),path).not.toContain('<div id="root">');
  }
  for(const path of ['/unmapped','/roteiva-media-sw.js','/roteiva-build.json','/__/auth/handler']){
    // The Hosting emulator does not supply Google's reserved auth response.
    expect((await request.get(path,{maxRedirects:0})).status(),path).toBe(404);
  }
});
