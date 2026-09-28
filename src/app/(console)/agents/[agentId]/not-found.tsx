import { DetailRecoveryState } from "@/components/ui/DetailRecoveryState";

export default function AgentNotFound() {
  return <DetailRecoveryState
    kind="missing"
    eyebrow="助手不可用"
    title="没有找到这个助手"
    description="它可能已被归档、移到其他工作区，或当前链接已经失效。为保护工作区数据，系统不会判断它是否存在于其他空间。"
    note="如果这是同事发来的链接，请先确认你们位于同一工作区；系统不会自动创建替代助手。"
    primaryHref="/agents"
    primaryLabel="返回助手列表"
    secondaryHref="/agents/new"
    secondaryLabel="创建新助手"
  />;
}
