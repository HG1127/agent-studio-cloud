import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  // mammoth 外部化：让运行时按 node 条件加载，避免打包时解析到浏览器构建；
  // PDF 解析改用 unpdf（serverless 版 pdfjs，无 DOMMatrix 依赖），可直接打包
  serverExternalPackages: ["mammoth"],
};

export default withWorkflow(nextConfig);
