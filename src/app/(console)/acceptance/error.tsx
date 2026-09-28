"use client";

import { DetailRecoveryState } from "@/components/ui/DetailRecoveryState";

export default function AcceptanceError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <DetailRecoveryState kind="error" eyebrow="验收证据读取失败" title="暂时无法打开验收中心"
    description="样例或最近验收记录暂时无法读取。已经完成的验收证据仍会保留。"
    note="重新读取只会刷新当前状态，不会再次运行验收、修改样例或发布版本。"
    primaryHref="/agents" primaryLabel="返回助手列表" secondaryHref="/releases" secondaryLabel="查看发布中心" onRetry={reset} />;
}
