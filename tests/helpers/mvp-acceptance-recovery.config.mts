import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "../../src") } },
  test: {
    name: "mvp-recovery-helper",
    environment: "node",
    include: ["tests/helpers/mvp-acceptance-recovery-tools.test.ts"],
    testTimeout: 10_000,
  },
});
