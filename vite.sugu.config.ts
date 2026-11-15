import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { BROWSER_TARGETS } from "./vite.config";

/**
 * Site Sugu Eden (place de marché d'Eden Dev) : page web statique, fabriquée à part de GestiMarket avec les
 * mêmes outils. Adresses relatives (« ./ ») et pages derrière « # » : le site marche à n'importe quelle adresse
 * (GitHub Pages, nom de domaine de Sugu Eden), sans réglage du serveur web.
 *
 *   npm run sugu:dev     → http://localhost:1430
 *   npm run sugu:build   → dist-sugu/
 */
export default defineConfig({
  root: "sugu",
  base: "./",
  plugins: [react()],
  publicDir: "public",
  server: { port: 1430, strictPort: true },
  build: {
    outDir: "../dist-sugu",
    emptyOutDir: true,
    target: BROWSER_TARGETS,
    cssTarget: BROWSER_TARGETS,
  },
});
