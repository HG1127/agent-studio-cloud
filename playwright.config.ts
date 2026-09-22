import { defineConfig } from "@playwright/test";

// 本机 3000 被旧 V5.7 系统占用，新系统 dev 一直跑 3210（控制方裁定，简报原文是 3000）
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3210/api/health",
    reuseExistingServer: true,
    env: { MODEL_MOCK: "1", PORT: "3210" },
    timeout: 120_000,
  },
  use: { baseURL: "http://localhost:3210" },
});
