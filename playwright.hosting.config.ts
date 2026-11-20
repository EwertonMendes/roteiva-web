import {defineConfig,devices} from '@playwright/test';

const baseURL='http://127.0.0.1:5012';
export default defineConfig({
  testDir:'tests/hosting',
  use:{baseURL,serviceWorkers:'block'},
  projects:[{name:'desktop',use:devices['Desktop Chrome']},{name:'mobile',use:devices['Pixel 7']}],
  webServer:{
    command:'node scripts/stage-institutional-hosting.mjs && pnpm exec firebase emulators:start --project demo-roteiva-site --config firebase.site.prod.json --only hosting',
    url:baseURL+'/sobre.html',
    timeout:60_000,
    reuseExistingServer:false,
  },
});
