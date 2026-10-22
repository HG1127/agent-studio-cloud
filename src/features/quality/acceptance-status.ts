import type { EvaluationRunView } from "@/contracts/evaluation";
import type { VersionSummary } from "@/contracts/version";

export type AcceptanceStatus = {
  priority: number;
  label: string;
  tone: "blue" | "red" | "amber" | "indigo" | "emerald" | "slate";
  detail: string;
  action: string;
  anchor: "evaluation" | "versions";
  summary: "running" | "passed" | "issues" | "waiting" | "other";
};

export function acceptanceStatus({
  casesCount,
  latest,
  versions,
}: {
  casesCount: number;
  latest: EvaluationRunView | null;
  versions: VersionSummary[];
}): AcceptanceStatus {
  const activeVersion = versions.find((version) => version.status === "candidate")
    ?? versions.find((version) => version.status === "production");

  if (latest?.status === "running") {
    return { priority: 0, label: "验收运行中", tone: "blue", detail: `版本 ${latest.version} · 已完成 ${latest.passedCount + latest.failedCount}/${latest.totalCount} 项`, action: "查看验收进度", anchor: "evaluation", summary: "running" };
  }
  if (!activeVersion) {
    return { priority: 2, label: "缺少可验收版本", tone: "amber", detail: `${casesCount} 个样例 · 先保存流程并发布待验收版本`, action: "准备版本", anchor: "versions", summary: "waiting" };
  }
  if (casesCount === 0) {
    return { priority: 3, label: "待准备样例", tone: "amber", detail: `${activeVersion.status === "candidate" ? "候选" : "当前"}版本 ${activeVersion.version} · 尚无验收样例`, action: "准备验收样例", anchor: "evaluation", summary: "waiting" };
  }
  if (latest?.version !== activeVersion.version) {
    const previous = latest ? `；上次验收的是版本 ${latest.version}` : "";
    return { priority: 4, label: activeVersion.status === "candidate" ? "候选待验收" : "当前版本待验收", tone: "indigo", detail: `版本 ${activeVersion.version} · ${casesCount} 个样例已就绪${previous}`, action: "验收当前版本", anchor: "evaluation", summary: "waiting" };
  }
  if (latest.failedCount > 0) {
    return { priority: 1, label: "需要修复", tone: "red", detail: `版本 ${latest.version} · ${latest.failedCount} 项未通过`, action: "查看失败证据", anchor: "evaluation", summary: "issues" };
  }
  if (latest.totalCount > 0 && latest.passedCount === latest.totalCount) {
    return { priority: 7, label: "最近已通过", tone: "emerald", detail: `版本 ${latest.version} · ${latest.passedCount}/${latest.totalCount} 项通过`, action: "查看验收证据", anchor: "evaluation", summary: "passed" };
  }
  return { priority: 6, label: "建议重新验收", tone: "slate", detail: `版本 ${latest.version} · ${casesCount} 个样例`, action: "重新运行验收", anchor: "evaluation", summary: "waiting" };
}
