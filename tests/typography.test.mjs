import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const sources=[
  "src/globals.css", "src/responsive.css", "src/refined-theme.css",
  "src/features/auth/auth.css", "src/features/settings/settings.css",
  "src/site-experience.css", "src/demo.css",
];

test("every readable legacy font size is tokenized instead of hardcoded below 13px",async()=>{
  for(const file of sources){
    const css=await readFile(file,"utf8");
    const obsolete=[...css.matchAll(/font-size\s*:\s*([0-9]+(?:\.[0-9]+)?)px\b/g)]
      .filter(([,size])=>Number(size)>0&&Number(size)<13)
      .map(m=>m[0]);
    assert.deepEqual(obsolete,[],`Tiny legacy font sizes are still present in ${file}`);
  }
});

test("typography tokens remain relative to the browser root font size",async()=>{
  const css=await readFile("src/typography.css","utf8");
  for(const [key,value] of [
    ["--type-caption","0.8125rem"],["--type-support","0.875rem"],
    ["--type-label","0.9375rem"],["--type-body","1rem"],
    ["--type-card","1.125rem"],["--type-section","1.375rem"],
    ["--type-page","2rem"],
  ]){
    assert.ok(css.includes(key+": "+value),`Missing relative typography token ${key}`);
  }
  assert.match(css,/font-variant-numeric:\s*tabular-nums/);
  assert.doesNotMatch(css,/font-family\s*:\s*monospace/i);
  assert.match(css,/max-width:\s*820px/);
  assert.match(css,/max-width:\s*430px/);
  const app=await readFile("src/main.tsx","utf8");
  assert.ok(app.indexOf('import "./typography.css"')>app.indexOf('import "./features/typography/font-lab.css"'),
    "Semantic typography overrides should follow the temporary font lab CSS");
});
