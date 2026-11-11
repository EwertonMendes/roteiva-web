import { parseEnvironment } from "./src/lib/environment-config.ts";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// Frontend estático para Firebase Hosting. O modo demo existe apenas localmente para QA.
// Não existe mais deploy no GitHub Pages.
export default defineConfig(({mode,isPreview}) => {
  const config = isPreview ? undefined : parseEnvironment({...loadEnv(mode, process.cwd(), "VITE_"), ...Object.fromEntries(Object.entries(process.env).filter(([key])=>key.startsWith("VITE_")))}, mode);
  return {
  plugins: [react(), {
    name: 'roteiva-build-identity',
    generateBundle() {
      if (!config) throw new Error('Missing build identity');
      this.emitFile({type:'asset',fileName:'roteiva-build.json',source:JSON.stringify({
        environment:config.appEnv,mode,apiOrigin:config.apiBaseUrl,projectId:config.firebase?.projectId,
        sha:process.env.GITHUB_SHA || process.env.SOURCE_SHA || null,
      })});
    },
  }],
  base: "/",
  publicDir: "public",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
};
});
