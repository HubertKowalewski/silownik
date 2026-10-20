import { defineConfig } from "vite";
import path from "path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";

// Tryb dev:   npm run dev  -> http://localhost:5173, zapytania /api i /admin przekierowane do Django (:8000)
// Tryb build: npm run build -> pliki trafiają do frontend/dist, skąd serwuje je Django pod /static/dist/
export default defineConfig(({ command }) => ({
  base: command === "build" ? "/static/dist/" : "/",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8000",
      "/admin": "http://127.0.0.1:8000",
      "/static/admin": "http://127.0.0.1:8000",
    },
  },
  build: {
    outDir: path.resolve(__dirname, "dist"),
    emptyOutDir: true,
    manifest: true,
    chunkSizeWarningLimit: 1500,
  },
  assetsInclude: ["**/*.svg", "**/*.csv"],
}));
