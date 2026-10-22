"use client";

import { DetailRecoveryState } from "@/components/ui/DetailRecoveryState";

export default function ConnectionsError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <DetailRecoveryState kind="error" eyebrow="连接页面读取失败" title="暂时无法打开外部工具连接"
    description="本页暂时无法显示。已登记的工具、已发布的助手和现有任务没有被修改。"
    note="重新读取会重新检查页面数据，不会执行工具、重发业务请求或更改授权。"
    primaryHref="/knowledge" primaryLabel="返回资料与应用" secondaryHref="/agents" secondaryLabel="查看助手流程" onRetry={retry} />;
}
