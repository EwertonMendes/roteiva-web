import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";

const [, , output, base] = process.argv;
assert.ok(output && base, "Uso: node scripts/verify-static-build.mjs <dist> <base>");
const folder = resolve(output);
const htmlFile = join(folder, "index.html");
assert.ok(existsSync(htmlFile), `Ausente: ${htmlFile}`);
const html = readFileSync(htmlFile, "utf8");

for (const file of ["favicon.svg", "roteiva-logo-white.png", "roteiva-logo-black.png", "fonts/ubuntu/Ubuntu-Regular.ttf"]) {
  assert.ok(existsSync(join(folder, file)), `Asset ausente: ${file}`);
}
const scripts = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map(match => match[1]);
assert.ok(scripts.some(path => path.endsWith(".js")), "JS de entrada ausente");
assert.ok(scripts.some(path => path.endsWith(".css")), "CSS de entrada ausente");
for (const asset of scripts) {
  assert.ok(asset.startsWith(base), `Base URL incorreta: ${asset} (esperada ${base})`);
  const local = asset.slice(base.length).replace(/^\//, "");
  assert.ok(existsSync(join(folder, local)), `Arquivo referenciado ausente: ${local}`);
}
const firebase = JSON.parse(readFileSync(resolve("firebase.json"), "utf8"));
assert.equal(firebase.hosting.public, "dist");
assert.deepEqual(firebase.hosting.rewrites, [{ source: "**", destination: "/index.html" }]);
const pkg = JSON.parse(readFileSync(resolve("package.json"), "utf8"));
for (const forbidden of ["next", "vinext", "wrangler", "drizzle-orm", "@cloudflare/vite-plugin"]) {
  assert.ok(!pkg.dependencies?.[forbidden] && !pkg.devDependencies?.[forbidden], `Dependência backend presente: ${forbidden}`);
}
console.log(`Build estático verificado: ${output}, base ${base}, ${scripts.length} assets referenciados`);
