import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";
import { SECURITY_HEADERS } from "./src/lib/security-headers";

const nextConfig: NextConfig = {
  // Playwright 可在同一仓库已有开发服务时使用独立产物目录，避免 Next 单实例锁互相阻塞。
  distDir: process.env.NEXT_DIST_DIR?.trim() || ".next",
  // mammoth 外部化：让运行时按 node 条件加载，避免打包时解析到浏览器构建；
  // PDF 解析改用 unpdf（serverless 版 pdfjs，无 DOMMatrix 依赖），可直接打包
  serverExternalPackages: ["mammoth"],
  experimental: {
    // 助手导入的有效流程最多 1MB；为导出包装与 Server Action 编码预留空间，同时不越过平台请求上限。
    serverActions: { bodySizeLimit: "3mb" },
  },
  async headers() {
    return [{ source: "/(.*)", headers: [...SECURITY_HEADERS] }];
  },
};

export default withWorkflow(nextConfig);
