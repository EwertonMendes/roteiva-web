import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

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
  assert.match(loader,/MAX_CONCURRENT=4/);
  assert.match(loader,/MAX_CACHE=48/);
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
