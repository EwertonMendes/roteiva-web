import test from "node:test";
import assert from "node:assert/strict";
import {existsSync, readFileSync, readdirSync} from "node:fs";

const read = (path) => readFileSync(path, "utf8");
test("GitHub Pages and workflow_run coupling are removed", () => {
  for (const removed of [
    ".github/workflows/deploy-pages.yml",
    ".github/workflows/deploy-firebase.yml",
    ".github/workflows/api-dev.yml"
  ]) assert.equal(existsSync(removed), false, removed);
  for (const active of ["frontend.yml","api.yml","firebase-infra.yml"]) {
    const body = read(".github/workflows/" + active);
    assert.ok(!body.includes("workflow_run:"), active);
    assert.ok(!body.includes("deploy-pages"), active);
  }
});
test("quick deploys avoid E2E, separate Hosting from Firestore and guard DEV", () => {
  const frontend = read(".github/workflows/frontend.yml");
  assert.ok(!frontend.includes("playwright"));
  assert.match(frontend, /--only hosting --project roteiva-web-dev/);
  assert.match(frontend, /firebase-development/);
  const api = read(".github/workflows/api.yml");
  assert.match(api, /migrate:dev/);
  assert.match(api, /cloudflare-development/);
  assert.ok(!api.includes("firebase-development"));
  assert.match(read(".github/workflows/firebase-infra.yml"), /test:rules/);
  assert.match(read(".github/workflows/qa-regression.yml"), /test:firebase/);
});
test("admin Firestore remains disabled for public Actions and never reuses deployment identity", () => {
  const ops = read(".github/workflows/firebase-ops.yml");
  assert.match(ops, /\.private/);
  assert.match(ops, /FIREBASE_DATA_SERVICE_ACCOUNT/);
  assert.match(ops, /FIREBASE_DATA_OPS_ENABLED/);
  assert.ok(!ops.includes("secrets.FIREBASE_SERVICE_ACCOUNT"));
});

// The visual contract must be reused: native selects reintroduce OS-specific menus.
test("all frontend selects use the shared AppSelect primitive", () => {
  const walk = (dir) => readdirSync(dir, {withFileTypes:true}).flatMap(entry => {
    const path = dir + "/" + entry.name;
    return entry.isDirectory() ? walk(path) : path.endsWith(".tsx") ? [path] : [];
  });
  for (const path of walk("src")) {
    assert.doesNotMatch(read(path), /<select(?=[\\s>])/i, path + " should import AppSelect");
  }
  const appSelect = read("src/features/ui/AppSelect.tsx");
  assert.match(appSelect, /role="combobox"/);
  assert.match(appSelect, /role="listbox"/);
  assert.match(appSelect, /type="hidden" name=\{name\}/);
});
