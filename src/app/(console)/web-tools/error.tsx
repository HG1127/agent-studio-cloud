"use client";

import { DetailRecoveryState } from "@/components/ui/DetailRecoveryState";

export default function WebToolsError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <DetailRecoveryState kind="error" eyebrow="版本读取失败" title="暂时无法核对网页工具来源"
    description="正式版本的字段暂时无法读取；已经发布的助手不受影响。"
    note="重新读取只会检查版本数据，不会创建网页入口或更改访问权限。"
    primaryHref="/releases" primaryLabel="返回发布中心" secondaryHref="/agents" secondaryLabel="查看助手" onRetry={retry} />;
}
