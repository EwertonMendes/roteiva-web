import {defineConfig,devices} from "@playwright/test";

/** Real Firebase Hosting and Cloudflare DEV only. Never use the emulator webServer fixture. */
const origin="https://roteiva-web-dev.web.app";
export default defineConfig({
  testDir:"./tests/live-dev",
  testMatch:"*.spec.ts",
  timeout:90000,
  expect:{timeout:20000},
  workers:1,
  retries:0,
  reporter:[["list"],["html",{outputFolder:"playwright-real-dev-report",open:"never"}]],
  outputDir:"test-results/real-dev",
  use:{
    baseURL:origin,
    actionTimeout:20000,
    navigationTimeout:30000,
    trace:"off", // Auth traces contain live credentials; do NOT collect them.
    screenshot:"only-on-failure",
    video:"off",
    reducedMotion:"reduce",
    ignoreHTTPSErrors:false,
  },
  projects:[
    {name:"desktop-real",use:{...devices["Desktop Chrome"]}},
    {name:"mobile-real",use:{...devices["Pixel 7"]}},
  ],
});
