"use client";

import { DetailRecoveryState } from "@/components/ui/DetailRecoveryState";

export default function RunDetailError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <DetailRecoveryState
    kind="error"
    eyebrow="运行证据读取失败"
    title="暂时无法读取运行详情"
    description="系统没有取得完整的运行输入、步骤和结果。请先重新读取；为避免重复执行，不会自动重跑任务。"
    note="“重新读取”只会重新获取这条记录，不会再次启动任务，也不会改变已经保存的人工决定。"
    primaryHref="/runs"
    primaryLabel="返回运行记录"
    secondaryHref="/activity"
    secondaryLabel="查看操作记录"
    onRetry={retry}
  />;
}
