import test from "node:test";
import assert from "node:assert/strict";
import {existsSync, readFileSync, readdirSync} from "node:fs";

const read = (path) => readFileSync(path, "utf8");
test("OS-native pointer has no global decorative cursor layer or forced invisibility", () => {
  const experience=read("src/site-experience.tsx");
  const styles=read("src/site-experience.css");
  assert.match(experience, /brand-intro/); // Brand intro is deliberately preserved.
  assert.doesNotMatch(experience, /studio-cursor|cursorPoint|cursorDialog|createPortal|requestAnimationFrame|data-roteiva-cursor/);
  assert.doesNotMatch(experience, /addEventListener\(["']pointer(move|down|up)["']/);
  assert.doesNotMatch(styles, /studio-cursor|data-roteiva-cursor|cursor\s*:\s*none/);
  for(const path of ["src/features/projects/CoverEditor.tsx","src/features/projects/CoverFrame.tsx","src/features/clients/ClientFormDialog.tsx"])
    assert.doesNotMatch(read(path), /data-native-cursor/, path);
  assert.equal(existsSync("tests/browser/cursor-layer.spec.ts"), false);
  const qa=read(".github/workflows/qa-regression.yml");
  assert.match(qa, /tests\/browser\/native-pointer\.spec\.ts/);
  assert.match(qa, /suite == 'pointer'/);
  assert.doesNotMatch(qa, /cursor-layer\.spec/);
});

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
test("PR smoke is bounded while manual/nightly browser and security coverage remains intact", () => {
  const isolated = read(".github/workflows/qa-isolated-e2e.yml");
  const regression = read(".github/workflows/qa-regression.yml");
  assert.match(isolated, /--grep @ci-smoke --workers=2/);
  assert.match(isolated, /github.event_name == 'pull_request' \|\| github.event_name == 'push'/);
  assert.match(isolated, /github.event_name == 'workflow_dispatch'/);
  assert.doesNotMatch(isolated, /^  schedule:/m, "Do not run duplicate nightly suites");
  assert.match(regression, /schedule:/);
  assert.match(regression, /test:firebase/);
  for (const path of [
    "access-isolated-e2e.spec.ts", "reviews.spec.ts", "reviews-workflow.spec.ts",
    "drive-folders.spec.ts"
  ]) assert.match(read("tests/browser/" + path), /tag:\s*['"]@ci-smoke['"]/, path);
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

test("PROD promotion runs full regression in parallel without weakening authorization", () => {
  const prod = read(".github/workflows/production.yml").replace(/\r\n/g,"\n");
  assert.match(prod, /jobs:\s*\n  authorize:/);
  assert.match(prod, /test "\$GITHUB_ACTOR" = "\$GITHUB_REPOSITORY_OWNER"/);
  assert.match(prod, /test "\$APPROVED_SHA" = "\$GITHUB_SHA"/);
  assert.match(prod, /git ls-remote origin refs\/heads\/master/);
  assert.match(prod, /merged_at != null and \.base\.ref == "master"/);
  assert.match(prod, /needs: \[authorize, checks, browser\]/);
  assert.match(prod, /shard: \[1, 2, 3\]/);
  assert.match(prod, /playwright test --shard=/);
  assert.match(prod, /pnpm test:rules/);
  assert.match(prod, /npm run migrate:local --prefix api/);
  assert.match(prod, /environment: cloudflare-production/);
  assert.match(prod, /environment: firebase-production/);
  assert.match(prod, /guard-environment\.mjs prod --before-migrations/);
  assert.match(prod, /guard-secrets\.mjs prod/);
  assert.match(prod, /guard-migrations\.mjs prod --domain-cutover/);
  assert.match(prod, /if: \$\{\{ !inputs\.domain_cutover \}\}\s+run: \|\s+npm run migrate:prod/);
  assert.match(prod, /hosting:roteiva-web-prod --project roteiva-web-prod/);
  assert.match(prod, /scripts\/smoke-environment\.mjs prod/);
  const browser=prod.split("  browser:\n")[1].split("  worker:\n")[0];
  assert.match(browser, /fail-fast: false/);
  assert.match(browser, /ffmpeg/);
  assert.match(browser, /firebase emulators:exec --project demo-roteiva --only auth,firestore/);
  assert.doesNotMatch(browser, /--grep|--project=desktop|--project=mobile/, "Every browser project/test must run on one shard");
  assert.match(prod, /needs: \[authorize, checks, browser\]\s+if: \$\{\{ !inputs\.frontend_only \}\}/);
  assert.match(prod, /needs\.checks\.result == 'success' && needs\.browser\.result == 'success'/);
  assert.match(prod, /inputs\.frontend_only && needs\.worker\.result == 'skipped'/);
  assert.match(prod, /!inputs\.domain_cutover && !inputs\.frontend_only[^\n]*\n\s+run:[^\n]*--only firestore:rules,firestore:indexes,hosting:/);
});

test("the institutional deployment has its own site and uses the protected PROD environment", () => {
  const workflow = read(".github/workflows/institutional-production.yml");
  const site = JSON.parse(read("firebase.site.prod.json"));
  assert.equal(site.hosting.site,"roteiva-site-prod");
  assert.equal(site.hosting.public,"dist-site");
  assert.deepEqual(Object.keys(site).sort(),["emulators","hosting"]);
  assert.match(workflow,/environment: firebase-production/);
  assert.match(workflow,/test "\$APPROVED_SHA" = "\$GITHUB_SHA"/);
  assert.match(workflow,/--only hosting:roteiva-site-prod/);
  assert.doesNotMatch(workflow,/wrangler deploy|pnpm build:prod|firestore:rules/);
});
