"use client";

import { DetailRecoveryState } from "@/components/ui/DetailRecoveryState";

export default function AgentDetailError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <DetailRecoveryState
    kind="error"
    eyebrow="助手工作台读取失败"
    title="暂时无法读取助手工作台"
    description="网络或服务没有返回完整数据。已经保存的流程、版本和验收记录不会因此被改动。"
    note="“重新读取”只会刷新页面数据，不会发布版本、运行助手或覆盖尚未提交的服务端记录。"
    primaryHref="/agents"
    primaryLabel="返回助手列表"
    secondaryHref="/activity"
    secondaryLabel="查看操作记录"
    onRetry={reset}
  />;
}
