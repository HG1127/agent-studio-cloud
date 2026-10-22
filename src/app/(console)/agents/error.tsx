"use client";

import { DetailRecoveryState } from "@/components/ui/DetailRecoveryState";

export default function AgentsError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <DetailRecoveryState kind="error" eyebrow="助手列表读取失败" title="暂时无法打开我的助手"
    description="在用或已停用的助手暂时无法读取。已经保存的助手和流程不会因此被改动。"
    note="重新读取只会刷新列表，不会创建、停用或恢复助手。"
    primaryHref="/" primaryLabel="返回工作台" secondaryHref="/agents/new" secondaryLabel="创建新助手" onRetry={retry} />;
}
