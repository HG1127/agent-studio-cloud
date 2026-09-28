"use client";

import { DetailRecoveryState } from "@/components/ui/DetailRecoveryState";

export default function KnowledgeError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <DetailRecoveryState
    kind="error"
    eyebrow="业务资料读取失败"
    title="暂时无法打开资料与应用"
    description="资料列表或检索结果暂时无法读取。已上传的资料不会因为刷新页面而丢失。"
    note="重新读取只会刷新当前页面，不会重新上传、解析或归档资料。"
    primaryHref="/"
    primaryLabel="返回工作台"
    secondaryHref="/settings"
    secondaryLabel="查看模型连接"
    onRetry={reset}
  />;
}
