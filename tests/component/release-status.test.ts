import { describe, expect, it } from "vitest";
import type { EvaluationRunView } from "@/contracts/evaluation";
import type { VersionSummary } from "@/contracts/version";
import { releaseStatus } from "@/features/quality/release-status";

const production: VersionSummary = { id: "00000000-0000-4000-8000-000000000001", version: 2, status: "production", createdAt: "2026-09-01T00:00:00.000Z" };
const candidate: VersionSummary = { id: "00000000-0000-4000-8000-000000000002", version: 3, status: "candidate", createdAt: "2026-09-02T00:00:00.000Z" };
const evaluation: EvaluationRunView = {
  id: "00000000-0000-4000-8000-000000000003", version: 3, status: "completed",
  totalCount: 3, passedCount: 2, failedCount: 1,
  startedAt: "2026-09-03T00:00:00.000Z", finishedAt: "2026-09-03T00:01:00.000Z", results: [],
};

describe("发布中心状态", () => {
  it("区分当前候选验收中和验收失败", () => {
    const running = releaseStatus({ versions: [candidate, production], latest: { ...evaluation, status: "running", finishedAt: null } });
    expect(running.status).toBe("候选验收中");
    expect(running.anchor).toBe("evaluation");
    const failed = releaseStatus({ versions: [candidate, production], latest: evaluation });
    expect(failed.status).toBe("候选验收未通过");
    expect(failed.summary).toContain("尚未上线");
  });

  it("旧版验收不能冒充当前候选已验收", () => {
    const status = releaseStatus({ versions: [candidate, production], latest: { ...evaluation, version: 2, failedCount: 0, passedCount: 3 } });
    expect(status.status).toBe("候选待验收");
    expect(status.summary).toContain("尚无对应的完整验收结果");
  });

  it("候选验收已全通过但版本未切换时提示核对，不虚报上线", () => {
    const status = releaseStatus({ versions: [candidate, production], latest: { ...evaluation, failedCount: 0, passedCount: 3 } });
    expect(status.status).toBe("发布状态待核对");
    expect(status.anchor).toBe("versions");
  });

  it("正式版本只陈述当前身份，不把创建时间写成发布时间", () => {
    const status = releaseStatus({ versions: [production], latest: evaluation });
    expect(status.status).toBe("正式版本在用");
    expect(status.summary).toBe("版本 2 是当前正式版本");
  });

  it("只有历史版本时明确缺少正式版本", () => {
    const status = releaseStatus({ versions: [{ ...production, status: "retired" }], latest: null });
    expect(status.status).toBe("没有正式版本");
    expect(status.anchor).toBe("versions");
  });
});
