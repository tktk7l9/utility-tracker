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
      // include を明示し、テストに触れられていない純粋ロジックも 0% として可視化する（盲点を出す）。
      // supabase.ts はネットワーク層のため計測対象外（lifeplan-me の InteractiveMap 除外と同方針）。
      include: ["src/lib/**/*.ts"],
      exclude: ["**/*.test.{ts,tsx}", "src/lib/supabase.ts", "src/test-setup.ts"],
      reporter: ["text", "html"],
      // 集計・CSV 正規化の正本ロジックは statements/functions/lines を 100% 維持（回帰でCIを落とす）。
      thresholds: {
        "src/lib/**": { statements: 100, functions: 100, lines: 100, branches: 100 },
      },
    },
  },
});
