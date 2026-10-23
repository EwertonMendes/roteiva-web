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
    assert.doesNotMatch(read(path), /<select(?=[\s>])/i, path + " should import AppSelect");
  }
  const appSelect = read("src/features/ui/AppSelect.tsx");
  assert.match(appSelect, /role="combobox"/);
  assert.match(appSelect, /role="listbox"/);
  assert.match(appSelect, /type="hidden" name=\{name\}/);
});

// Video fullscreen is owned by the native <video controls> element, not by a
// duplicate application overlay that competes with the browser's player.
test("review video uses only native fullscreen controls", () => {
  const portal = read("src/features/reviews/ReviewPortal.tsx");
  const css = read("src/features/reviews/review-portal-v2.css");
  assert.match(portal, /<video ref=\{videoRef\}/);
  assert.match(portal, /controls controlsList="nodownload noremoteplayback"/);
  for (const orphan of ["videoExpanded", "setVideoExpanded", "review-video-fullscreen", "is-video-expanded", "Ampliar vídeo", "Fechar tela cheia"]) {
    assert.equal(portal.includes(orphan), false, `Obsolete fullscreen UI in ReviewPortal: ${orphan}`);
    assert.equal(css.includes(orphan), false, `Obsolete fullscreen style: ${orphan}`);
  }
});
