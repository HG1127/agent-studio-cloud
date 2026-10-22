import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "../../src") } },
  test: { name: "owned-workflow-case-bridge", environment: "node", pool: "forks", maxWorkers: 1,
    include: ["tests/workflow/owned-case-bridge-entry.ts"], fileParallelism: false,
    testTimeout: 240_000, hookTimeout: 240_000 },
});
