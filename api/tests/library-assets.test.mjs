import test from 'node:test';
import assert from 'node:assert/strict';
import {database} from './helpers/database.mjs';
import {encrypt,context,base64url} from '../src/crypto.ts';
import {importLibraryAssets} from '../src/library-assets.ts';
import {libraryFor,mutateLibrary} from '../src/library.ts';
const conn='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
async function setup(t){
 const env={ENVIRONMENT:'dev',TOKEN_KEY_VERSION:'v1',TOKEN_KEYS:JSON.stringify({v1:base64url(crypto.getRandomValues(new Uint8Array(32)))}),GOOGLE_CLIENT_ID:'test',GOOGLE_CLIENT_SECRET:'test'};
 const row={id:conn,owner_uid:'alice',google_account_id:'google-alice',status:'connected',revision:1,scopes:'https://www.googleapis.com/auth/drive.file',encrypted_refresh_token:await encrypt(env,'refresh',context(env,'alice','google-alice'))};
 const f=database(row);t.after(f.close);env.DB=f.DB;
 const fetcher=async u=>String(u).startsWith('https://oauth2.googleapis.com/token')?Response.json({access_token:'mock',token_type:'Bearer',expires_in:3600}):Response.json({id:new URL(u).pathname.split('/').at(-1),name:'Video.mp4',mimeType:'video/mp4',isAppAuthorized:true,trashed:false,headRevisionId:'revision1',size:'1024'});
 return {...f,env,fetcher};
}
test('asset import verifies each source and is idempotent within a virtual folder',async t=>{
 const {env,fetcher,sql}=await setup(t);const item={provider:'google_drive',connectionId:conn,fileId:'FILE_123456789'};
 const input={parentId:'root',items:[item,item]};
 const r=await (await importLibraryAssets(env,'alice',17,input,fetcher)).json();
 assert.equal(r.results[0].id,r.results[1].id);assert.equal(sql.prepare('SELECT count(*) n FROM library_assets').get().n,1);
 assert.equal(sql.prepare("SELECT count(*) n FROM library_nodes WHERE kind='asset'").get().n,1);
 const lib=await libraryFor(env,'alice',17);const folder=(await (await mutateLibrary(env,lib,null,{name:'More'})).json()).id;
 await importLibraryAssets(env,'alice',17,{parentId:folder,items:[item]},fetcher);
 assert.equal(sql.prepare("SELECT count(*) n FROM library_nodes WHERE kind='asset'").get().n,2);
});
test('unselected, trashed and foreign-account sources cannot become published assets',async t=>{
 const {env,fetcher,sql}=await setup(t);const item={provider:'google_drive',connectionId:conn,fileId:'FILE_123456789'};
 for(const patch of [{isAppAuthorized:false},{trashed:true}]){
 const stub=async(u,o)=>String(u).startsWith('https://oauth2.googleapis.com/token')?fetcher(u,o):Response.json({id:item.fileId,name:'x',mimeType:'video/mp4',isAppAuthorized:true,...patch});
 const r=await (await importLibraryAssets(env,'alice',17,{parentId:'root',items:[item]},stub)).json();assert.equal(r.results[0].status,'failed');}
 const foreign=await (await importLibraryAssets(env,'bob',17,{parentId:'root',items:[item]},fetcher)).json();assert.equal(foreign.results[0].code,'connection_not_found');
 assert.equal(sql.prepare('SELECT count(*) n FROM library_assets').get().n,0);
});
