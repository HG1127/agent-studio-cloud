"use client";

import { DetailRecoveryState } from "@/components/ui/DetailRecoveryState";

export default function MemoryError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <DetailRecoveryState
    kind="error"
    eyebrow="成长中心读取失败"
    title="暂时无法读取经验与改进反馈"
    description="可能是网络或数据服务暂时没有响应。已有经验和反馈不会因为刷新页面而被删除。"
    note="重新读取只会刷新当前页面，不会停用经验或把反馈加入验收。"
    primaryHref="/"
    primaryLabel="返回工作台"
    secondaryHref="/runs"
    secondaryLabel="查看运行记录"
    onRetry={retry}
  />;
}
