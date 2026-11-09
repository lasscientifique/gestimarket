import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import pkg from "./package.json";
import { legacyCssFallbacks } from "./scripts/css-fallbacks.mjs";

const host = process.env.TAURI_DEV_HOST;

/**
 * Moteurs web visés : anciens Android (moteur web Chrome 70 et plus : Android 7 mis à jour, boîtiers TV,
 * BlueStacks), iPhone et iPad depuis iOS 13. Les écritures récentes sont traduites à la fabrication ;
 * `public/compat.js` complète les fonctions manquantes. `scripts/check-compat.mjs` vérifie le résultat.
 */
export const BROWSER_TARGETS = ["chrome70", "safari13", "firefox78", "edge79"];

/** Couleurs « mélangées », max(), min() et dvh : une valeur simple est placée devant, pour les anciens moteurs. */
function cssFallbacks(): Plugin {
  return {
    name: "gestimarket-css-fallbacks",
    enforce: "pre",
    transform(code, id) {
      if (!/\.css($|\?)/.test(id) || id.includes("node_modules")) return null;
      return { code: legacyCssFallbacks(code), map: null };
    },
  };
}

// https://v2.tauri.app/start/frontend/vite/
export default defineConfig({
  plugins: [react(), cssFallbacks()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: {
    target: BROWSER_TARGETS,
    cssTarget: BROWSER_TARGETS,
    chunkSizeWarningLimit: 1800,
  },
});
