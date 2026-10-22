import { DetailRecoveryState } from "@/components/ui/DetailRecoveryState";

export default function RunNotFound() {
  return <DetailRecoveryState
    kind="missing"
    eyebrow="运行记录不可用"
    title="没有找到这条运行记录"
    description="它可能已被归档、属于其他工作区，或当前链接已经失效。已有结果不会因为链接失效而被重新执行。"
    note="如果你是从通知进入，请返回运行记录重新筛选；系统不会自动重跑任务。"
    primaryHref="/runs"
    primaryLabel="返回运行记录"
    secondaryHref="/"
    secondaryLabel="返回工作台"
  />;
}
