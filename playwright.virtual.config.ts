import {defineConfig} from '@playwright/test';
import base from './playwright.config';
export default defineConfig({...base,
 testMatch:['virtual-library.spec.ts','virtual-review.spec.ts','authenticated-media.spec.ts'],
 webServer:[
  {command:'pnpm exec vite preview --outDir dist-virtual --host 127.0.0.1 --port 4173',url:'http://127.0.0.1:4173',reuseExistingServer:false},
  {command:'pnpm exec vite preview --outDir dist-demo --host 127.0.0.1 --port 4174',url:'http://127.0.0.1:4174',reuseExistingServer:false},
 ],
});
