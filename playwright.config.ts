import {defineConfig,devices} from "@playwright/test";
export default defineConfig({
  testDir:"./tests/browser",timeout:60000,expect:{timeout:15000},workers:1,
  reporter:[["list"],["html",{open:"never"}]],
  use:{actionTimeout:15000,navigationTimeout:20000,trace:"retain-on-failure",screenshot:"only-on-failure",reducedMotion:"reduce"},
  projects:[{name:"desktop",use:{...devices["Desktop Chrome"]}},{name:"mobile",use:{...devices["Pixel 7"]}}],
  webServer:[
    {command:"pnpm exec vite preview --outDir dist-emulator --host 127.0.0.1 --port 4173",url:"http://127.0.0.1:4173",reuseExistingServer:false},
    {command:"pnpm exec vite preview --outDir dist-pages --base /roteiva-web/ --host 127.0.0.1 --port 4174",url:"http://127.0.0.1:4174/roteiva-web/",reuseExistingServer:false}
  ]
});
