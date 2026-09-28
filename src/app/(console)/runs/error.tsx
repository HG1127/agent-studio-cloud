"use client";

import { DetailRecoveryState } from "@/components/ui/DetailRecoveryState";

export default function RunsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <DetailRecoveryState
      kind="error"
      eyebrow="运行记录读取失败"
      title="暂时无法打开运行中心"
      description="可能是网络或运行服务暂时没有响应。已经保存的任务、结果和人工决定不会受到影响。"
      note="重新读取只会刷新当前列表，不会再次启动任务、提交人工决定或覆盖已有结果。"
      primaryHref="/"
      primaryLabel="返回工作台"
      secondaryHref="/activity"
      secondaryLabel="查看操作记录"
      onRetry={reset}
    />
  );
}
