import { defineConfig } from "@playwright/test";

// 本机 3000 被旧 V5.7 系统占用，新系统 dev 一直跑 3210（控制方裁定，简报原文是 3000）
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 180_000,
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3210/api/health",
    // CI 里必须由 Playwright 自己起 dev（否则会复用不存在的 server）；本地才允许复用
    reuseExistingServer: !process.env.CI,
    env: {
      MODEL_MOCK: "1",
      LLM_COMPILE: "0",
      PORT: "3210",
      NEXT_DIST_DIR: ".next-playwright",
      NODE_OPTIONS: process.env.NODE_OPTIONS || "--max-old-space-size=1024",
    },
    timeout: 120_000,
  },
  use: { baseURL: "http://localhost:3210" },
});
