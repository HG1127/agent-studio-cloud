"use client";

import { DetailRecoveryState } from "@/components/ui/DetailRecoveryState";

export default function FrozenVersionError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <DetailRecoveryState kind="error" eyebrow="冻结版本读取失败" title="暂时无法读取这个版本"
    description="网络或服务没有返回完整数据，不能判断这个版本已删除。"
    note="重新读取只刷新版本资料，不修改草稿、不恢复版本，也不会启动任务。"
    primaryHref="/releases" primaryLabel="返回发布中心" secondaryHref="/agents" secondaryLabel="返回助手列表" onRetry={retry} />;
}
