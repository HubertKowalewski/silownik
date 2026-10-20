import { defineConfig } from "vitest/config";
import path from "path";

// Testy jednostkowe logiki działającej w przeglądarce (obliczenia, kolejka offline, model treningu).
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  test: { environment: "jsdom", include: ["src/**/*.test.ts"] },
});
