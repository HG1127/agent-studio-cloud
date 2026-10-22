"use client";

import { DetailRecoveryState } from "@/components/ui/DetailRecoveryState";

export default function ToolOperationsError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <DetailRecoveryState kind="error" eyebrow="业务操作" title="核对工作台暂时无法打开" description="当前页面状态无法确认，请先重新读取记录。"
    note="若此前已经提交过核对，请先查看最新历史再处理。重新读取不会重发核对请求或恢复旧任务。"
    primaryHref="/tool-operations" primaryLabel="返回核对列表" secondaryHref="/runs" secondaryLabel="查看运行记录" onRetry={retry} />;
}
