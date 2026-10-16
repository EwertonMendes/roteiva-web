import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// GitHub Pages hosts project websites below /<repository>/.
export default defineConfig({
  root: "pages",
  base: "/roteiva-web/",
  publicDir: "../public",
  plugins: [react()],
  build: {
    outDir: "../dist-pages",
    emptyOutDir: true,
  },
});
