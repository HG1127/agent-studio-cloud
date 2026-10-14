"use client";

import { DetailRecoveryState } from "@/components/ui/DetailRecoveryState";

export default function HarnessError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <DetailRecoveryState kind="error" eyebrow="运行诊断读取失败" title="暂时无法打开运行控制台" description="最近的运行或轨迹暂时没有读到；已经保存的任务与处理决定不会受到影响。" note="重新读取只查询现有证据，不会运行任务、改变策略或提交人工决定。" primaryHref="/runs" primaryLabel="返回运行记录" secondaryHref="/activity" secondaryLabel="查看操作记录" onRetry={retry} />;
}
