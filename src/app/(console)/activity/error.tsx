"use client";

import { DetailRecoveryState } from "@/components/ui/DetailRecoveryState";

export default function ActivityError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <DetailRecoveryState kind="error" eyebrow="操作记录读取失败" title="暂时无法打开操作记录"
    description="这次读取没有返回完整记录，不代表之前的操作没有保存。"
    note="重新读取只会再次查询记录，不会重复提交任何操作。"
    primaryHref="/" primaryLabel="返回工作台" secondaryHref="/settings" secondaryLabel="查看管理设置" onRetry={retry} />;
}
