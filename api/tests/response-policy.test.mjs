import test from 'node:test';
import assert from 'node:assert/strict';
import {applyResponsePolicy} from '../src/response-policy.ts';
const origin='https://roteiva-web-dev.web.app';
for(const path of ['/reviews/media','/integrations/dropbox/media']){
  for(const status of [200,206]){
    test(path+' permits only the frontend to embed a successful PDF '+status,async()=>{
      const response=applyResponsePolicy(new Response('%PDF-1.7',{status,headers:{
        'Content-Type':'application/pdf; charset=binary','Content-Range':'bytes 0-7/100',
        'Content-Disposition':'inline','Accept-Ranges':'bytes'}}),path,origin);
      assert.equal(response.headers.get('Content-Security-Policy'),"default-src 'none'; frame-ancestors "+origin);
      assert.equal(response.headers.get('Cache-Control'),'no-store');
      assert.equal(response.headers.get('Content-Range'),'bytes 0-7/100');
      assert.equal(response.headers.get('Accept-Ranges'),'bytes');
      assert.equal(response.headers.get('Content-Disposition'),'inline');
      assert.equal(await response.text(),'%PDF-1.7');
    });
  }
  for(const [status,mime] of [[403,'application/pdf'],[404,'application/json'],[200,'text/html'],[200,'image/svg+xml']]){
    test(path+' denies embedding for '+status+' '+mime,()=>{
      const result=applyResponsePolicy(new Response('body',{status,headers:{'Content-Type':mime}}),path,origin);
      assert.match(result.headers.get('Content-Security-Policy'),/frame-ancestors 'none'/);
    });
  }
}
test('other routes, invalid environments and SVG sandbox remain restricted',()=>{
  for(const [path,host] of [['/reviews/123',origin],['/integrations/dropbox/media/extra',origin],
    ['/reviews/media','https://evil.example'],['/reviews/media',origin+"; frame-ancestors *"]]){
    const result=applyResponsePolicy(new Response('pdf',{headers:{'Content-Type':'application/pdf'}}),path,host);
    assert.match(result.headers.get('Content-Security-Policy'),/frame-ancestors 'none'/);
  }
  const result=applyResponsePolicy(new Response('<svg/>',{headers:{
    'Content-Type':'image/svg+xml','Content-Security-Policy':"sandbox; default-src 'none'; frame-ancestors *"}}),'/reviews/media',origin);
  assert.equal(result.headers.get('Content-Security-Policy'),"sandbox; default-src 'none'; frame-ancestors 'none'");
  assert.equal(result.headers.get('X-Content-Type-Options'),'nosniff');
});
