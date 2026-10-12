"use client";

import { DetailRecoveryState } from "@/components/ui/DetailRecoveryState";

export default function ReleasesError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <DetailRecoveryState kind="error" eyebrow="版本状态读取失败" title="暂时无法打开发布中心"
    description="候选或正式版本状态暂时无法读取。已经发布的版本不会因为页面失败而改变。"
    note="重新读取只会刷新版本概览，不会发布、回退或恢复任何版本。"
    primaryHref="/agents" primaryLabel="返回助手列表" secondaryHref="/acceptance" secondaryLabel="查看验收中心" onRetry={retry} />;
}
