import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import pkg from "./package.json";

const host = process.env.TAURI_DEV_HOST;

// Console Eden Dev : WebView2 (Windows) et WebView d'Android à jour.
// https://v2.tauri.app/start/frontend/vite/
export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  clearScreen: false,
  server: {
    port: 1430,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1431 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: {
    target: ["chrome87", "edge88", "safari14"],
    chunkSizeWarningLimit: 1200,
  },
});
