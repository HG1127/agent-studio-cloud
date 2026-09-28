import { defineConfig } from "@playwright/test";

// 本机 3000 被旧 V5.7 系统占用；独立端口可避免复用其他任务的开发服务。
const port = process.env.PLAYWRIGHT_PORT || "3210";
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 180_000,
  // 首次进入数据聚合页需要完成 Next 开发编译和真实数据库查询，不能沿用 5 秒断言默认值。
  expect: { timeout: 60_000 },
  webServer: {
    command: "pnpm dev",
    // 启动就绪只检查静态资源；数据库健康状态由页面和专门接口测试验证，避免偶发探针超时阻断所有浏览器用例。
    url: `${baseURL}/favicon.ico`,
    // CI 里必须由 Playwright 自己起 dev（否则会复用不存在的 server）；本地才允许复用
    reuseExistingServer: !process.env.CI,
    env: {
      MODEL_MOCK: "1",
      LLM_COMPILE: "0",
      PORT: port,
      NEXT_DIST_DIR: process.env.PLAYWRIGHT_DIST_DIR || ".next-playwright",
      NODE_OPTIONS: process.env.NODE_OPTIONS || "--max-old-space-size=1024",
    },
    timeout: 120_000,
  },
  use: { baseURL },
});
