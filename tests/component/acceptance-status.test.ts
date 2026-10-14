import { describe, expect, it } from "vitest";
import type { EvaluationRunView } from "@/contracts/evaluation";
import type { VersionSummary } from "@/contracts/version";
import { acceptanceStatus } from "@/features/quality/acceptance-status";

const production: VersionSummary = { id: "00000000-0000-4000-8000-000000000001", version: 2, status: "production", createdAt: "2026-09-01T00:00:00.000Z" };
const candidate: VersionSummary = { id: "00000000-0000-4000-8000-000000000002", version: 3, status: "candidate", createdAt: "2026-09-02T00:00:00.000Z" };
const failedOldRun: EvaluationRunView = {
  id: "00000000-0000-4000-8000-000000000003", version: 2, status: "completed",
  totalCount: 3, passedCount: 2, failedCount: 1,
  startedAt: "2026-09-03T00:00:00.000Z", finishedAt: "2026-09-03T00:01:00.000Z", results: [],
};

describe("验收中心状态", () => {
  it("新候选版本优先于旧版的失败结论，旧记录仍可辨认", () => {
    const status = acceptanceStatus({ casesCount: 3, latest: failedOldRun, versions: [candidate, production] });
    expect(status.label).toBe("候选待验收");
    expect(status.summary).toBe("waiting");
    expect(status.detail).toContain("上次验收的是版本 2");
    expect(status.anchor).toBe("evaluation");
  });

  it("只把当前版本未通过归为需要修复", () => {
    const status = acceptanceStatus({ casesCount: 3, latest: failedOldRun, versions: [production] });
    expect(status.label).toBe("需要修复");
    expect(status.summary).toBe("issues");
  });

  it("没有当前可验收版本时不把历史版本当作可运行", () => {
    const status = acceptanceStatus({ casesCount: 3, latest: failedOldRun, versions: [{ ...production, status: "retired" }] });
    expect(status.label).toBe("缺少可验收版本");
    expect(status.anchor).toBe("versions");
  });

  it("没有启用样例时不把旧版通过视作当前可发布", () => {
    const status = acceptanceStatus({ casesCount: 0, latest: { ...failedOldRun, failedCount: 0, passedCount: 3 }, versions: [production] });
    expect(status.label).toBe("待准备样例");
    expect(status.summary).toBe("waiting");
  });

  it("运行中的验收优先展示进度，完成且当前版本全通过才记为通过", () => {
    const running = acceptanceStatus({ casesCount: 3, latest: { ...failedOldRun, status: "running", finishedAt: null }, versions: [candidate, production] });
    expect(running.label).toBe("验收运行中");
    expect(running.summary).toBe("running");
    const passed = acceptanceStatus({ casesCount: 3, latest: { ...failedOldRun, version: 3, failedCount: 0, passedCount: 3 }, versions: [candidate, production] });
    expect(passed.label).toBe("最近已通过");
    expect(passed.summary).toBe("passed");
  });
});
