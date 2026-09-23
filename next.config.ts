import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  // pdf-parse 的 exports 带 browser 条件（web 构建顶层引用 DOMMatrix）；
  // 被 Turbopack 打进服务端 chunk 后模块求值即抛 DOMMatrix is not defined，
  // 生产步骤端点全 500——外部化让运行时按 node 条件加载（本地 dev 与 vitest 不受影响，故此前未暴露）
  serverExternalPackages: ["pdf-parse", "mammoth"],
};

export default withWorkflow(nextConfig);
