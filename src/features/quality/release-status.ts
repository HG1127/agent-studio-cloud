import type { EvaluationRunView } from "@/contracts/evaluation";
import type { VersionSummary } from "@/contracts/version";

export type ReleaseStatus = {
  priority: number;
  status: string;
  statusTone: string;
  summary: string;
  action: string;
  anchor: "evaluation" | "versions";
};

export function releaseStatus({
  versions,
  latest,
}: {
  versions: VersionSummary[];
  latest: EvaluationRunView | null;
}): ReleaseStatus {
  const candidate = versions.find((version) => version.status === "candidate");
  const live = versions.find((version) => version.status === "production");

  if (candidate) {
    if (latest?.version === candidate.version && latest.status === "running") {
      return { priority: 0, status: "候选验收中", statusTone: "bg-blue-50 text-blue-700 ring-blue-600/10", summary: `候选版本 ${candidate.version} · 已完成 ${latest.passedCount + latest.failedCount}/${latest.totalCount} 项`, action: "查看验收进度", anchor: "evaluation" };
    }
    if (latest?.version === candidate.version && latest.failedCount > 0) {
      return { priority: 1, status: "候选验收未通过", statusTone: "bg-red-50 text-red-700 ring-red-600/10", summary: `候选版本 ${candidate.version} · ${latest.failedCount} 项未通过，尚未上线`, action: "查看失败证据", anchor: "evaluation" };
    }
    if (latest?.version === candidate.version && latest.totalCount > 0 && latest.passedCount === latest.totalCount) {
      return { priority: 2, status: "发布状态待核对", statusTone: "bg-amber-50 text-amber-700 ring-amber-600/10", summary: `候选版本 ${candidate.version} 的验收记录全部通过，但版本仍标记为候选；请核对正式版本状态`, action: "核对版本状态", anchor: "versions" };
    }
    return { priority: 3, status: "候选待验收", statusTone: "bg-indigo-50 text-indigo-700 ring-indigo-600/10", summary: `候选版本 ${candidate.version} 尚无对应的完整验收结果`, action: "完成候选验收", anchor: "evaluation" };
  }
  if (versions.length === 0) {
    return { priority: 4, status: "尚未发布", statusTone: "bg-amber-50 text-amber-700 ring-amber-600/10", summary: "保存流程后发布首个待验收版本", action: "准备首个版本", anchor: "versions" };
  }
  if (!live) {
    return { priority: 5, status: "没有正式版本", statusTone: "bg-red-50 text-red-700 ring-red-600/10", summary: "当前没有正式运行版本，请检查历史状态", action: "检查版本历史", anchor: "versions" };
  }
  return { priority: 6, status: "正式版本在用", statusTone: "bg-emerald-50 text-emerald-700 ring-emerald-600/10", summary: `版本 ${live.version} 是当前正式版本`, action: "管理版本", anchor: "versions" };
}
