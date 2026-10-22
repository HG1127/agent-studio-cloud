"use client";

import { DetailRecoveryState } from "@/components/ui/DetailRecoveryState";

export default function SettingsError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <DetailRecoveryState kind="error" eyebrow="管理设置读取失败" title="暂时无法打开管理设置"
    description="模型连接暂时无法读取。已经保存的连接配置不会因为页面失败而被删除。"
    note="重新读取只会刷新连接列表，不会保存、删除或测试模型连接。"
    primaryHref="/" primaryLabel="返回工作台" secondaryHref="/activity" secondaryLabel="查看操作记录" onRetry={retry} />;
}
