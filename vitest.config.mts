import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    fileParallelism: false,
    projects: [
      {
        test: {
          name: "node",
          environment: "node",
          include: ["src/**/*.test.{ts,tsx}", "tests/contract/**/*.test.{ts,tsx}"],
        },
      },
      {
        test: {
          name: "component",
          environment: "jsdom",
          include: ["tests/component/**/*.test.{ts,tsx}"],
          setupFiles: ["tests/setup.ts"],
        },
      },
    ],
  },
});
