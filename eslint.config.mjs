import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Workflow 编译器产物由 SDK 生成，不参与手写源码规范检查。
    ".workflow-vitest/**",
    "src/app/.well-known/workflow/**",
    // Playwright 使用独立 Next 产物目录，跑过 E2E 后仍应能直接执行全量 lint。
    ".next-playwright/**",
  ]),
]);

export default eslintConfig;
