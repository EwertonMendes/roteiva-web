import test from "node:test";
import assert from "node:assert/strict";
import {
 mediaKey,loadStorageImage,cachedMediaUrl,clearStorageImageCache,
 invalidateStorageFile,invalidateStorageConnection
} from "../src/features/drive/storage-image-cache.ts";

const media=(uid="alpha",revision="v1")=>({
 uid,provider:"google_drive",connectionId:"conn-1",fileId:"file-1",variant:"thumbnail",revision
});
const jpeg=()=>new Blob([new Uint8Array([255,216,255,217])],{type:"image/jpeg"});
test("identity contains user, provider, connection, file and revision",()=>{
 assert.notEqual(mediaKey(media("alpha")),mediaKey(media("beta")));
 assert.notEqual(mediaKey(media()),mediaKey(media("alpha","v2")));
 assert.notEqual(mediaKey(media()),mediaKey({...media(),provider:"dropbox"}));
 assert.notEqual(mediaKey(media()),mediaKey({...media(),connectionId:"conn-2"}));
});
test("deduplicates simultaneous downloads and returns cached object URL",async()=>{
 await clearStorageImageCache(undefined,false);
 let calls=0;
 const fetch=async()=>{calls++;return jpeg();};
 const [a,b]=await Promise.all([
  loadStorageImage(media(),fetch,{persist:false}),
  loadStorageImage(media(),fetch,{persist:false}),
 ]);
 assert.equal(calls,1);assert.equal(a,b);
 assert.equal(await loadStorageImage(media(),fetch,{persist:false}),a);
 assert.equal(calls,1);
 await clearStorageImageCache(undefined,false);
 assert.equal(cachedMediaUrl(media()),null);
});
test("independent revisions and providers never reuse an unrelated image",async()=>{
 await clearStorageImageCache(undefined,false);
 let count=0;
 const load=async()=>{count++;return jpeg();};
 await loadStorageImage(media(),load,{persist:false});
 await loadStorageImage(media("alpha","v2"),load,{persist:false});
 await loadStorageImage({...media(),provider:"dropbox"},load,{persist:false});
 assert.equal(count,3);
 await invalidateStorageFile(media());
 assert.equal(cachedMediaUrl(media()),null);
 assert.equal(cachedMediaUrl({...media(),provider:"dropbox"})!==null,true);
 await invalidateStorageConnection("alpha","dropbox","conn-1");
 assert.equal(cachedMediaUrl({...media(),provider:"dropbox"}),null);
 await clearStorageImageCache(undefined,false);
});
test("rejects invalid media and does not cache it",async()=>{
 await clearStorageImageCache(undefined,false);
 await assert.rejects(loadStorageImage(media(),async()=>new Blob(["<html/>"],{type:"text/html"}),{persist:false}),/Imagem inválida/);
 assert.equal(cachedMediaUrl(media()),null);
});
test("in-flight results after logout are not admitted to memory",async()=>{
 await clearStorageImageCache(undefined,false);
 let release;
 const gate=new Promise(resolve=>{release=resolve;});
 const work=loadStorageImage(media(),async()=>{await gate;return jpeg();},{persist:false});
 await new Promise(resolve=>setTimeout(resolve,0));
 await clearStorageImageCache(undefined,false);
 release();
 await assert.rejects(work,/Sessão de imagens alterada/);
 assert.equal(cachedMediaUrl(media()),null);
});
