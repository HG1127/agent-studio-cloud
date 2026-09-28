import { defineConfig } from "@playwright/test";

// 本机 3000 被旧系统占用；测试端口可覆盖，避免误复用其他工作区的服务。
const port = process.env.PLAYWRIGHT_PORT || "3210";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 180_000,
  webServer: {
    command: "pnpm dev",
    url: `http://localhost:${port}/api/health`,
    reuseExistingServer: process.env.PLAYWRIGHT_REUSE_SERVER === "1" && !process.env.CI,
    env: {
      MODEL_MOCK: "1",
      LLM_COMPILE: "0",
      PORT: port,
      NEXT_DIST_DIR: ".next-playwright",
      NODE_OPTIONS: process.env.NODE_OPTIONS || "--max-old-space-size=1024",
    },
    timeout: 120_000,
  },
  use: { baseURL: `http://localhost:${port}` },
});
