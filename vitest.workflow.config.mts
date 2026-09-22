import { defineConfig } from "vitest/config";
import path from "node:path";
import { workflow } from "@workflow/vitest";

// @workflow/vitest 集成测试独立配置：进程内 Local World 跑真实 workflow 编译产物
export default defineConfig({
  plugins: [workflow()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    name: "workflow",
    environment: "node",
    include: ["tests/workflow/**/*.test.ts", "tests/integration/**/*.test.ts"],
    setupFiles: ["tests/workflow/env.ts"],
    // 本地队列可见性上限 5 秒：恢复钩子后队列最多等 5 秒重新投递，避免默认 30 秒等待造成测试抖动
    env: { WORKFLOW_LOCAL_QUEUE_MAX_VISIBILITY: "5" },
    fileParallelism: false,
    testTimeout: 240_000,
  },
});
