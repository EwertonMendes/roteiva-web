import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Frontend estático para Firebase Hosting. O modo demo existe apenas localmente para QA.
// Não existe mais deploy no GitHub Pages.
export default defineConfig({
  plugins: [react()],
  base: "/",
  publicDir: "public",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
