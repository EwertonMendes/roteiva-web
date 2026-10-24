import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validStorageFileId,validStorageFolderId,validConnectionId,isStorageSelection,storageFileKey,STORAGE_CAPABILITIES} from '../src/storage.ts';
const uuid='1840f767-720d-4f8f-a8b9-244ea2d3ef10';
test('Google ID compatibility',()=>{
 assert.equal(validStorageFileId('google_drive','abc_XYZ-0987654321'),true);
 assert.equal(validStorageFileId('google_drive','id:AbcDEFGhijklmnop'),false);
 assert.equal(validStorageFolderId('google_drive','root',true),true);
 assert.equal(validStorageFolderId('google_drive','root'),false);
});
test('Dropbox IDs cannot be confused with paths or Drive IDs',()=>{
 assert.equal(validStorageFileId('dropbox','id:aBcD12345_qWERt'),true);
 for(const bad of ['/home/file','../../secret','id:','id:a/b','http://x','abc_XYZ-0987654321'])
  assert.equal(validStorageFileId('dropbox',bad),false);
});
test('selection is provider-bound with stable namespaced key',()=>{
 assert.ok(validConnectionId(uuid));
 assert.ok(isStorageSelection({provider:'dropbox',connectionId:uuid,fileId:'id:aBcD12345_qWERt',linkedFolderId:'id:aBcD12345_qWERt'}));
 assert.equal(storageFileKey({provider:'dropbox',fileId:'id:aBcD12345_qWERt'}),'dropbox:id:aBcD12345_qWERt');
 assert.equal(isStorageSelection({provider:'google_drive',connectionId:uuid,fileId:'id:aBcD12345_qWERt',linkedFolderId:'root'}),false);
 assert.equal(Object.values(STORAGE_CAPABILITIES.dropbox).every(Boolean),true);
});
