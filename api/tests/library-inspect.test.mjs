import test from 'node:test';
import assert from 'node:assert/strict';
import {database} from './helpers/database.mjs';
import {encrypt,base64url,context} from '../src/crypto.ts';
import {inspectLibrarySelection} from '../src/library-inspect.ts';
const account='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',folder='FOLDER_SELECTED_12345',file='FILE_SELECTED_12345';
test('assisted inspection reads only the explicit selection and a folder grant never enumerates its children',async t=>{
 const env={ENVIRONMENT:'dev',TOKEN_KEY_VERSION:'v1',TOKEN_KEYS:JSON.stringify({v1:base64url(crypto.getRandomValues(new Uint8Array(32)))}),GOOGLE_CLIENT_ID:'test',GOOGLE_CLIENT_SECRET:'test'};
 const f=database({id:account,owner_uid:'alice',google_account_id:'google-alice',status:'connected',revision:1,scopes:'https://www.googleapis.com/auth/drive.file',encrypted_refresh_token:await encrypt(env,'refresh',context(env,'alice','google-alice'))});env.DB=f.DB;t.after(f.close);
 const ids=[];
 const fetcher=async(url)=>{
  const u=new URL(url);if(u.hostname==='oauth2.googleapis.com')return Response.json({access_token:'test-token',token_type:'Bearer',expires_in:3600});
  const id=u.pathname.split('/').at(-1);ids.push(id);assert.ok([folder,file].includes(id));assert.equal(u.searchParams.has('q'),false);
  return Response.json({id,name:id===folder?'Vídeos':'Corte.mp4',mimeType:id===folder?'application/vnd.google-apps.folder':'video/mp4',parents:id===file?[folder]:[],isAppAuthorized:true,capabilities:{canDownload:true}});
 };
 const body={provider:'google_drive',connectionId:account,items:[{fileId:folder}]};
 const result=await (await inspectLibrarySelection(env,'alice',body,fetcher)).json();assert.equal(result.results[0].source.kind,'folder');assert.deepEqual(ids,[folder]);
 const second=await (await inspectLibrarySelection(env,'alice',{...body,items:[{fileId:file}]},fetcher)).json();assert.deepEqual(second.results[0].source.parentIds,[folder]);
 const foreign=await (await inspectLibrarySelection(env,'bob',body,fetcher)).json();assert.equal(foreign.results[0].status,'failed');assert.deepEqual(ids,[folder,file]);
});
