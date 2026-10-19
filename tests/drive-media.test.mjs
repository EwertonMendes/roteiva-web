import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {hasDriveThumbnailSource} from "../src/features/drive/drive-thumbnail-source.ts";

const ui=readFileSync(new URL("../src/features/drive/DriveLibraryUI.tsx",import.meta.url),"utf8");
const loader=readFileSync(new URL("../src/features/drive/DriveThumbnail.tsx",import.meta.url),"utf8");
const parent=readFileSync(new URL("../src/features/drive/DriveConnectionPanel.tsx",import.meta.url),"utf8");
test("list/grid mode is explicit and stored as a nonprivate local preference",()=>{
  assert.match(ui,/role="group" aria-label="Modo de visualização"/);
  assert.match(ui,/data-view=\{view\}/);
  assert.match(ui,/roteiva-drive-view-v1/);
});
test("thumbnail binary is authenticated, lazy and never loaded from an untrusted link in an image tag",()=>{
  assert.match(loader,/IntersectionObserver/);
  assert.match(loader,/MAX_CONCURRENT=6/);
  assert.match(loader,/MAX_CACHE=64/);
  assert.match(parent,/\/files\/".encodeURIComponent\(file.id\)."\/thumbnail"/);
  assert.match(parent,/getIdToken/);
  assert.doesNotMatch(ui,/<img[^>]*thumbnailLink/);
  assert.match(loader,/URL.revokeObjectURL/);
});
test("preview has keyboard navigation and keeps Drive fallback",()=>{
  assert.match(ui,/event.key==="ArrowLeft"/);
  assert.match(ui,/event.key==="ArrowRight"/);
  assert.match(ui,/Abrir no Drive/);
});

test("thumbnail shows progress during fetch and falls back on unavailable media",()=>{
  assert.match(loader,/type Phase = "idle"\|"loading"\|"loaded"\|"unavailable"/);
  assert.match(loader,/data-thumbnail-state=\{current.phase\}/);
  assert.match(loader,/setState\(\{key,src:null,phase:"loading"\}\)/);
  assert.match(loader,/phase:url\?"loaded":"unavailable"/);
  assert.match(loader,/className="rl-thumb-loading"/);
  assert.match(loader,/IntersectionObserver/);
});

test("fast Drive listing uses account-scoped in-memory cache and debounced remote search",()=>{
  assert.match(parent,/getCachedFolder/);
  assert.match(parent,/setCachedFolder/);
  assert.match(parent,/clearDriveFolderCache/);
  assert.ok(parent.includes("window.setTimeout(async()=>"));
  assert.match(ui,/searchResults/);
  assert.match(parent,/thumbnailTicket/);
  assert.ok(loader.includes("promote(key)"));
});

test("ticket-only Drive v3 responses trigger thumbnail requests, without raw thumbnail links",()=>{
  const item={id:"private-pdf-123",name:"Roteiro.pdf",mimeType:"application/pdf",thumbnailTicket:"opaque-encrypted-ticket"};
  assert.equal(hasDriveThumbnailSource(item),true);
  assert.equal(hasDriveThumbnailSource({...item,thumbnailTicket:undefined}),false);
  assert.equal(hasDriveThumbnailSource({...item,thumbnailTicket:undefined,thumbnailLink:"https://lh3.googleusercontent.com/legacy"}),true);
  assert.equal(hasDriveThumbnailSource({...item,mimeType:"application/vnd.google-apps.folder"}),false);
  assert.ok(loader.includes("hasDriveThumbnailSource(item)"));
  assert.ok(parent.includes("file.thumbnailTicket"));
});
