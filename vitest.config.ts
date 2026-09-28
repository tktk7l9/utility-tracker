import { defineConfig } from "vitest/config";
import path from "node:path";
import viteReact from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [viteReact()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: ["./src/test-setup.ts"],
    coverage: {
      provider: "v8",
      // List include explicitly so pure logic untouched by tests still shows up as 0% (exposes blind spots).
      // supabase.ts (network layer) and pdfText.ts (browser-only PDF.js call layer) are excluded
      // (same policy as excluding InteractiveMap in lifeplan-me; pdfBill.ts, the bill text parser itself, is measured).
      include: ["src/lib/**/*.ts"],
      exclude: ["**/*.test.{ts,tsx}", "src/lib/supabase.ts", "src/lib/pdfText.ts", "src/test-setup.ts"],
      reporter: ["text", "html"],
      // The core aggregation and CSV normalization logic keeps statements/functions/lines at 100% (regressions fail CI).
      thresholds: {
        "src/lib/**": { statements: 100, functions: 100, lines: 100, branches: 100 },
      },
    },
  },
});
