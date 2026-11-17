import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,readdirSync} from "node:fs";
import {relative,join} from "node:path";
import {fileURLToPath} from "node:url";

const base=fileURLToPath(new URL("../src/",import.meta.url));
const read=path=>readFileSync(new URL("../src/"+path,import.meta.url),"utf8");
function walk(folder){
 return readdirSync(folder,{withFileTypes:true}).flatMap(item=>{
  const path=join(folder,item.name);
  return item.isDirectory()?walk(path):item.name.endsWith(".tsx")?[path]:[];
 });
}
test("all internal selects use the reusable AppSelect rather than native markup",()=>{
 for(const path of walk(base)){
  const relativePath=relative(base,path).replaceAll("\\","/");
  const source=readFileSync(path,"utf8");
  assert.equal([...source.matchAll(/<select(?=[\s/>])/g)].length,0,relativePath+" contains a native select");
 }
});
test("modal design system uses native modal semantics and centralized geometry",()=>{
 const modal=read("features/ui/AppModal.tsx");
 const chrome=read("features/ui/app-modal.css");
 const entry=read("main.tsx");
 assert.match(modal,/return <AppDialog/);
 for(const fragment of ["AppModalHeader","AppModalBody","AppModalFooter","onCloseRequest","rt-modal--"]){
  assert.ok(modal.includes(fragment),"missing modal contract "+fragment);
 }
 assert.match(chrome,/background:var\(--modal-surface\)/);
 assert.match(chrome,/--rt-control-height:52px/);
 assert.match(chrome,/overflow:auto;overscroll-behavior:contain/);
 assert.match(chrome,/prefers-reduced-motion/);
 assert.match(entry,/features\/ui\/app-modal\.css/);
});
test("primary business dialogs reuse the modal shell instead of hand-made overlays",()=>{
 const migrated=[
  "calendar/CalendarEventDialog.tsx","calendar/CalendarView.tsx",
  "clients/ClientFormDialog.tsx",
  "reviews/ReviewsDashboard.tsx","reviews/ReviewPortal.tsx",
  "drive/VirtualLibrary.tsx","drive/LibraryStructureDialog.tsx",
  "drive/AssistedLibraryImport.tsx","drive/MoveDestinationDialog.tsx",
  "drive/DropboxLibraryPicker.tsx","drive/DriveLibraryUI.tsx",
  "drive/LibraryReviewDemo.tsx","settings/AccountDeletionAction.tsx"
 ];
 for(const path of migrated){
  const source=read("features/"+path);
  assert.match(source,/<AppModal\b/,path+" must use the shared shell");
 }
 const dashboard=read("dashboard-client.tsx");
 assert.equal((dashboard.match(/<AppModal\b/g)||[]).length,2);
 assert.doesNotMatch(dashboard,/<div className="modal-backdrop"/);
 assert.doesNotMatch(read("features/reviews/ReviewsDashboard.tsx"),/review-modal-backdrop/);
});
