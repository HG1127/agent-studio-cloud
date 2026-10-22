import { DetailRecoveryState } from "@/components/ui/DetailRecoveryState";

export default function FrozenVersionNotFound() {
  return <DetailRecoveryState kind="missing" eyebrow="冻结版本不可用" title="没有找到这个版本"
    description="链接可能已失效，或版本不属于这个助手与当前工作区；不会自动选择其他版本。"
    note="已有冻结内容不会因链接不可用而被重新发布或恢复。请从可见版本历史重新进入。"
    primaryHref="/agents" primaryLabel="返回助手列表" secondaryHref="/releases" secondaryLabel="返回发布中心" />;
}
