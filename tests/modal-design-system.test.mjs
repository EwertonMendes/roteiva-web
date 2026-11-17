import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";

const read=path=>readFileSync(new URL("../src/"+path,import.meta.url),"utf8");
const gitBlob=contents=>createHash("sha1")
  .update("blob "+Buffer.byteLength(contents)+"\\0").update(contents).digest("hex");

/** PROD master (4a4dfb6): the calendar is the immutable visual reference.
 * Never "standardize" it or its date/time primitives as part of this PR. */
const protectedBlobs={
  "features/calendar/CalendarEventDialog.tsx":"573f764ab73df9115d587121b4ebcdbcc61f9c55",
  "features/calendar/CalendarView.tsx":"2c5f85a102455b78daaf32c25567d7d3ed99a3d7",
  "features/calendar/CalendarDateTimeField.tsx":"19c7640df84178ff70512db70c59fd32c480cff3",
  "features/calendar/calendar.css":"7e2ffe572b88d4da1d3c205e554516e0fb359851",
  "features/ui/AppDateFormField.tsx":"bb95b07bcee305c654511ddfc8c9007acffe3dbb",
  "features/ui/AppSelect.css":"5ba772bb7642fd1ba0e0659b6695701295c062d1",
  "features/ui/controls.css":"a35e37be86d02c2e360761b152516613eb744a68",
  "features/ui/form-controls.css":"36c7717af2e08eb27dee69be66ec6d36c90251a8",
  "features/ui/AppDialog.tsx":"8e601c0c5c1a8e50c66048ecc4b4effc043b2706",
};
test("PROD Novo compromisso and all date/time controls remain byte-for-byte unchanged",()=>{
  for(const [path,sha] of Object.entries(protectedBlobs)){
    assert.equal(gitBlob(read(path)),sha,path+" diverges from the approved PROD baseline");
  }
  assert.doesNotMatch(read("features/calendar/CalendarEventDialog.tsx"),/AppModal/);
});
test("converted modals share the exact calendar header hierarchy and an actual leading icon",()=>{
  const shell=read("features/ui/AppModal.tsx");
  assert.match(shell,/icon:ReactNode/);
  assert.match(shell,/rt-parity-modal/);
  assert.match(shell,/<h2 id=\{titleId\}>\{title\}<\/h2>/);
  assert.match(shell,/className="rt-modal__close"/);
  for(const path of [
    "dashboard-client.tsx",
    "features/clients/ClientFormDialog.tsx",
    "features/drive/AssistedLibraryImport.tsx",
    "features/drive/DriveLibraryUI.tsx",
    "features/drive/DropboxLibraryPicker.tsx",
    "features/drive/LibraryAssetPreview.tsx",
    "features/drive/LibraryReviewDemo.tsx",
    "features/drive/LibraryStructureDialog.tsx",
    "features/drive/MoveDestinationDialog.tsx",
    "features/drive/VirtualLibrary.tsx",
    "features/dropbox/DropboxConnectionPanel.tsx",
    "features/projects/CoverEditor.tsx",
    "features/reviews/ReviewOwnerWorkspace.tsx",
    "features/reviews/ReviewPortal.tsx",
    "features/reviews/ReviewsDashboard.tsx",
    "features/settings/AccountDeletionAction.tsx",
    "features/ui/ConfirmationDialog.tsx"
  ]){
    const source=read(path);
    assert.match(source,/<AppModalHeader\b/,path);
    for(const m of source.matchAll(/<AppModalHeader\b/g)){
      assert.match(source.slice(m.index,m.index+350),/\bicon=\{/,path+" has a modal heading without an icon");
    }
  }
});
test("modal geometry is scoped and does not override the existing calendar date/time picker",()=>{
  const css=read("features/ui/app-modal.css");
  assert.match(css,/dialog\.rt-parity-modal/);
  assert.match(css,/font-size:clamp\(26px,2\.6vw,36px\)/);
  assert.match(css,/font-size:var\(--type-body\)/);
  assert.match(css,/min-height:52px;height:52px/);
  assert.doesNotMatch(css,/\.roteiva-calendar-form\b/);
  assert.doesNotMatch(css,/:root\s+\.rt-input/);
  assert.match(read("main.tsx"),/features\/ui\/app-modal\.css/);
});
test("main business dialogs use shared date, input, select, textarea and money primitives",()=>{
  for(const path of ["dashboard-client.tsx","features/clients/ClientFormDialog.tsx"]){
    const source=read(path);
    assert.doesNotMatch(source,/<(?:input|select|textarea)\b/i,path);
    assert.match(source,/AppInput/);
  }
  const dash=read("dashboard-client.tsx");
  for(const primitive of ["AppSelect","AppTextarea","AppDateFormField","MoneyInput","AppModalSection"]){
    assert.ok(dash.includes(primitive),"missing "+primitive);
  }
  assert.match(read("features/clients/ClientFormDialog.tsx"),/BrazilPhoneInput/);
});
