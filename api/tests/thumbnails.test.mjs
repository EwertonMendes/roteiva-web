import test from 'node:test';
import assert from 'node:assert/strict';
import {database} from './helpers/database.mjs';
import {base64url, context, encrypt} from '../src/crypto.ts';
import {DRIVE_SCOPE, DRIVE_READ_SCOPE} from '../src/google.ts';
import {allowedThumbnailUrl, thumbnail} from '../src/thumbnails.ts';

const id='photo_1234567890';
const account='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
async function fixture({scopes=DRIVE_SCOPE+' '+DRIVE_READ_SCOPE,thumb='https://lh3.googleusercontent.com/d/thumbnail123',length=3,mime='image/jpeg',status=200}={}) {
  const env={ENVIRONMENT:'dev',TOKEN_KEY_VERSION:'v1',
    TOKEN_KEYS:JSON.stringify({v1:base64url(crypto.getRandomValues(new Uint8Array(32)))}),
    GOOGLE_CLIENT_ID:'test-client',GOOGLE_CLIENT_SECRET:'test-secret'};
  const row={id:account,owner_uid:'alice',google_account_id:'google-alice',
    status:'connected',revision:1,scopes,
    encrypted_refresh_token:await encrypt(env,'test-refresh',context(env,'alice','google-alice'))};
  const db=database(row);env.DB=db.DB;
  const urls=[];
  const fetcher=async(url,init)=>{
    const u=new URL(url);urls.push(u.toString());
    if(u.hostname==='oauth2.googleapis.com')return Response.json({access_token:'example-access',token_type:'Bearer',expires_in:3600});
    assert.equal(init?.headers.Authorization,'Bearer example-access');
    assert.equal(init?.redirect,'manual');
    if(u.hostname==='www.googleapis.com'){
      assert.equal(u.searchParams.get('fields'),'id,mimeType,thumbnailLink,trashed');
      assert.equal(u.searchParams.get('alt'),null);
      return Response.json({id,mimeType:'image/jpeg',thumbnailLink:thumb,trashed:false});
    }
    assert.equal(u.hostname,'lh3.googleusercontent.com');
    return new Response(new Uint8Array(length).fill(7),{status,headers:{'Content-Type':mime}});
  };
  return {env,close:db.close,urls,fetcher};
}

test('thumbnail proxy reads private metadata and returns bounded image without binary originals',async t=>{
  const f=await fixture();t.after(f.close);
  const response=await thumbnail(f.env,'alice',account,id,f.fetcher);
  assert.equal(response.status,200);
  assert.equal(response.headers.get('Content-Type'),'image/jpeg');
  assert.equal(response.headers.get('Cache-Control'),'private, no-store');
  assert.equal((await response.arrayBuffer()).byteLength,3);
  assert.equal(f.urls.some(url=>url.includes('alt=media')),false);
});

test('the upstream thumbnail URL must be Google HTTPS without embedded credentials',()=>{
  assert.equal(allowedThumbnailUrl('https://lh3.googleusercontent.com/short')?.hostname,'lh3.googleusercontent.com');
  for(const input of ['https://evil.test/pic','http://lh3.googleusercontent.com/pic',
    'https://lh3.googleusercontent.com.evil.test/a','https://a:token@lh3.googleusercontent.com/a',
    'https://drive.google.com.evil.test/x','ftp://drive.google.com/x']){
    assert.equal(allowedThumbnailUrl(input),null,input);
  }
});

test('owner, scope and file identifiers are enforced before any thumbnail fetch',async t=>{
  const f=await fixture();t.after(f.close);
  await assert.rejects(()=>thumbnail(f.env,'bob',account,id,f.fetcher),e=>e.status===404);
  await assert.rejects(()=>thumbnail(f.env,'alice',account,'bad?',f.fetcher),e=>e.status===400);
  const g=await fixture({scopes:DRIVE_SCOPE});t.after(g.close);
  await assert.rejects(()=>thumbnail(g.env,'alice',account,id,g.fetcher),e=>e.code==='drive_read_permission_missing');
});

test('oversized images, redirects and unsupported MIME types are never returned',async t=>{
  const huge=await fixture({length:1024*1024+1});t.after(huge.close);
  await assert.rejects(()=>thumbnail(huge.env,'alice',account,id,huge.fetcher),e=>e.code==='thumbnail_unavailable');
  const redirect=await fixture({status:302});t.after(redirect.close);
  await assert.rejects(()=>thumbnail(redirect.env,'alice',account,id,redirect.fetcher),e=>e.code==='thumbnail_unavailable');
  const html=await fixture({mime:'text/html'});t.after(html.close);
  await assert.rejects(()=>thumbnail(html.env,'alice',account,id,html.fetcher),e=>e.code==='thumbnail_unavailable');
  const noThumb=await fixture({thumb:'https://malicious.example/x'});t.after(noThumb.close);
  await assert.rejects(()=>thumbnail(noThumb.env,'alice',account,id,noThumb.fetcher),e=>e.code==='thumbnail_unavailable');
});
