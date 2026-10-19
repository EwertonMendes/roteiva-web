import test from 'node:test';
import {database} from './helpers/database.mjs';
import assert from 'node:assert/strict';
import {encrypt,base64url,context} from '../src/crypto.ts';
import {listFolders,listFolderItems} from '../src/folders.ts';
import {DRIVE_SCOPE,DRIVE_READ_SCOPE} from '../src/google.ts';

const folderId='FOLDER_1234567890';
const connectionId='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const folderMime='application/vnd.google-apps.folder';
async function setup(scopes=DRIVE_SCOPE+' '+DRIVE_READ_SCOPE) {
  const env={
    ENVIRONMENT:'dev',TOKEN_KEY_VERSION:'v1',
    TOKEN_KEYS:JSON.stringify({v1:base64url(crypto.getRandomValues(new Uint8Array(32)))}),
    GOOGLE_CLIENT_ID:'demo-client',GOOGLE_CLIENT_SECRET:'demo-secret',
  };
  const row={id:connectionId,owner_uid:'alice',google_account_id:'google-alice',
    status:'connected',revision:1,scopes,
    encrypted_refresh_token:await encrypt(env,'test-refresh',context(env,'alice','google-alice'))};
  const db=database(row);env.DB=db.DB;
  const urls=[];
  const fetcher=async(url,options)=>{
    urls.push(String(url));
    if(String(url).startsWith('https://oauth2.googleapis.com/token')){
      assert.equal(options.body.get('refresh_token'),'test-refresh');
      return Response.json({access_token:'ephemeral',token_type:'Bearer',expires_in:3600});
    }
    assert.equal(options.headers.Authorization,'Bearer ephemeral');
    const u=new URL(url);
    if(u.pathname.endsWith('/'+folderId))return Response.json({id:folderId,name:'Campanha',mimeType:folderMime,trashed:false});
    if(u.searchParams.get('fields')?.includes('thumbnailLink')){
      assert.match(u.searchParams.get('q'),/FOLDER_1234567890/);
      return Response.json({files:[
        {id:'video_123456789',name:'Entrega.mp4',mimeType:'video/mp4',size:'2048000',
         webViewLink:'https://drive.google.com/file/d/video_123456789/view',
         thumbnailLink:'https://lh3.googleusercontent.com/d/video_123456789'},
      ],nextPageToken:'next-page'});
    }
    assert.equal(u.searchParams.get('pageSize'),'100');
    return Response.json({files:[{id:folderId,name:'Campanha',mimeType:folderMime,parents:['root']}],
      nextPageToken:'next-page'});
  };
  return {env,fetcher,urls,close:db.close};
}

test('project folder picker lists actual folders through a private user-scoped backend',async(t)=>{
  const {env,fetcher,urls,close}=await setup();t.after(close);
  const response=await listFolders(env,'alice',connectionId,'root',null,fetcher);
  assert.equal(response.status,200);
  assert.deepEqual((await response.json()).folders,[{id:folderId,name:'Campanha',mimeType:folderMime,
    parents:['root']}]);
  const nested=await listFolders(env,'alice',connectionId,folderId,'page-token',fetcher);
  assert.equal(nested.status,200);
  assert.ok(urls.some(url=>url.includes('pageToken=page-token')));
  const all=await listFolders(env,'alice',connectionId,'all',null,fetcher);
  assert.equal(all.status,200);
  assert.ok(urls.some(url=>new URL(url).searchParams.get('q')===`mimeType = '${folderMime}' and trashed = false`));
});

test('folder content lists existing video files without downloading binary objects',async(t)=>{
  const {env,fetcher,urls,close}=await setup();t.after(close);
  const response=await listFolderItems(env,'alice',connectionId,folderId,null,fetcher);
  const data=await response.json();
  assert.equal(data.folder.name,'Campanha');
  assert.equal(data.files[0].mimeType,'video/mp4');
  assert.equal(data.files[0].size,'2048000');
  assert.ok(data.files[0].thumbnailTicket);
  assert.equal(data.files[0].thumbnailLink,undefined,'Upstream thumbnail URLs are never returned in cleartext');
  assert.equal(data.nextPageToken,'next-page');
  assert.ok(urls.every(url=>!url.includes('alt=media')));
});

test('Drive folder browsing rejects other owner, insufficient scope and malformed identifiers',async(t)=>{
  const first=await setup();t.after(first.close);
  await assert.rejects(()=>listFolders(first.env,'bob',connectionId,'root',null,first.fetcher),
    e=>e.status===404);
  const narrow=await setup(DRIVE_SCOPE);t.after(narrow.close);
  await assert.rejects(()=>listFolders(narrow.env,'alice',connectionId,'root',null,narrow.fetcher),
    e=>e.code==='drive_read_permission_missing');
  await assert.rejects(()=>listFolders(first.env,'alice',connectionId,"' or true",null,first.fetcher),
    e=>e.code==='invalid_folder_id');
  await assert.rejects(()=>listFolderItems(first.env,'alice',connectionId,"bad'",null,first.fetcher),
    e=>e.code==='invalid_folder_id');
  await assert.rejects(()=>listFolders(first.env,'alice',connectionId,'root','x'.repeat(2050),first.fetcher),
    e=>e.code==='invalid_page_token');
});

test('remote search stays within a folder, escapes Google Drive query syntax and preserves pagination',async t=>{
  const {env,fetcher,urls,close}=await setup();t.after(close);
  const result=await listFolderItems(env,'alice',connectionId,folderId,'page-2',fetcher,String.raw`client's\\report`);
  assert.equal(result.status,200);
  const searchUrl=urls.map(url=>new URL(url)).find(url=>url.searchParams.get('q')?.includes('name contains'));
  assert.ok(searchUrl);
  const q=searchUrl.searchParams.get('q');
  assert.match(q,/FOLDER_1234567890/);
  assert.ok(q.includes("name contains 'client\\'s\\\\report'"));
  assert.equal(searchUrl.searchParams.get('pageToken'),'page-2');
  await assert.rejects(()=>listFolderItems(env,'alice',connectionId,folderId,null,fetcher,'x'.repeat(101)),
    e=>e.code==='invalid_search');
});
