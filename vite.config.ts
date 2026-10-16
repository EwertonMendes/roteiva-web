import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// A mesma aplicação é gerada para a raiz do Firebase e para /roteiva-web/ no Pages.
// O comando build:pages sobrescreve --base e --outDir, sem duplicar frontends.
export default defineConfig({
  plugins: [react()],
  base: "/",
  publicDir: "public",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
