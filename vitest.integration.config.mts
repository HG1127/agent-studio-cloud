import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    environment: "node",
    fileParallelism: false,
    include: ["tests/integration/**/*.test.{ts,tsx}"],
    setupFiles: ["tests/workflow/env.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
