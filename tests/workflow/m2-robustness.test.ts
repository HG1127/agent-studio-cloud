import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { resumeHook, start } from "workflow/api";
import { AgentManifest } from "@/contracts/manifest";
import { agentRunWorkflow } from "@/server/workflows/agent-run";
import { failRun, markRunRunning } from "@/server/steps/run-state";
import { failRunProbeWorkflow } from "./failrun-probe.workflow";
import { runs, traceEvents } from "@/db/schema";
import { db } from "@/lib/db";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { waitForPendingApprovalHook } from "./approval-helpers";

const AGENT_ID = "00000000-0000-4000-8000-0000000000e3";
const VERSION_ID = "00000000-0000-4000-8000-0000000000e4";

// 最小 manifest：start → human（确认）→ done；拒绝经 not_approved → done
const manifest = AgentManifest.parse({
  schemaVersion: "4.0",
  workflowFingerprint: "e".repeat(64),
  inputContract: { fields: [] },
  resourceSelection: { model: { modelId: "mock", mock: true } },
  designAudit: { status: "passed", issueCount: 0, criticalCount: 0 },
  workflowSnapshot: {
    id: "draft-m2-robustness",
    startNodeId: "start",
    rootAgent: { id: "agt_m2_robustness", name: "健壮性测试助手", role: "通用业务助手" },
    memoryPolicy: { taskContext: true, longTerm: false },
    nodes: {
      start: { id: "start", title: "收到任务", type: "trigger", next: "confirm", requirementIds: [] },
      confirm: {
        id: "confirm",
        title: "负责人确认处理方案",
        type: "human",
        next: "done",
        rejectNext: "not_approved",
        approval: { role: "业务负责人", reason: "确认处理方案后流程才会继续" },
        requirementIds: [],
      },
      not_approved: { id: "not_approved", title: "未获确认，保留当前结果并停止高影响动作", type: "system", next: "done", requirementIds: [] },
      done: { id: "done", title: "流程结束", type: "end", next: null, requirementIds: [] },
    },
  },
});

async function insertRun(): Promise<string> {
  const [row] = await db
    .insert(runs)
    .values({ workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID, agentId: AGENT_ID, versionId: VERSION_ID, status: "queued", input: {} })
    .returning({ id: runs.id });
  return row.id;
}

describe("运行状态与审批健壮性", () => {
  it("failRun 对已终态 run 是 no-op：不改状态、不刷 finishedAt、不产生失败轨迹", async () => {
    const runId = await insertRun();
    const handle = await start(agentRunWorkflow, [runId, manifest, {}]);
    const token = await waitForPendingApprovalHook(handle, runId);
    await resumeHook(token, { decision: "approved" });
    expect(await handle.returnValue).toEqual({ status: "completed" });

    const [before] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
    await failRun(runId, "人为触发"); // step 直调已实证可行
    const [after] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
    expect(after?.status).toBe("completed");
    expect(after?.error).toBeNull();
    expect(after?.finishedAt?.getTime()).toBe(before?.finishedAt?.getTime());
    const failedTraces = await db
      .select()
      .from(traceEvents)
      .where(and(eq(traceEvents.runId, runId), eq(traceEvents.kind, "run.failed")));
    expect(failedTraces).toHaveLength(0);
  }, 240_000);

  it("审批恢复后 status 回 running 且拒绝路径有 run.resumed 与 run.rejected_stop 轨迹", async () => {
    // status 短暂为 running 不可靠（恢复后很快 completed），用持久轨迹作证据
    const runId = await insertRun();
    const handle = await start(agentRunWorkflow, [runId, manifest, {}]);
    const token = await waitForPendingApprovalHook(handle, runId);
    await resumeHook(token, { decision: "rejected", note: "方案需要修改" });
    expect(await handle.returnValue).toEqual({ status: "completed" });

    const [after] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
    expect(after?.status).toBe("completed");
    const kinds = (await db.select().from(traceEvents).where(eq(traceEvents.runId, runId))).map((t) => t.kind);
    expect(kinds).toContain("run.resumed");
    expect(kinds).toContain("run.rejected_stop");
    const rejectedStop = (await db.select().from(traceEvents).where(eq(traceEvents.runId, runId)))
      .find((t) => t.kind === "run.rejected_stop");
    expect(rejectedStop?.title).toContain("负责人确认处理方案");
    expect(rejectedStop?.title).toContain("未获确认");
  }, 240_000);

  it("failRun 对等待确认的 run 可写失败终态", async () => {
    const runId = await insertRun();
    await db.update(runs).set({ status: "waiting_approval", updatedAt: new Date() }).where(eq(runs.id, runId));
    const handle = await start(failRunProbeWorkflow, [runId, "确认恢复失败，已停止"]);
    expect(await handle.returnValue).toBeUndefined();

    const [after] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
    expect(after?.status).toBe("failed");
    expect(after?.error).toContain("确认恢复失败");
    const failedTraces = await db
      .select()
      .from(traceEvents)
      .where(and(eq(traceEvents.runId, runId), eq(traceEvents.kind, "run.failed")));
    expect(failedTraces).toHaveLength(1);
  }, 240_000);

  it("markRunRunning 对已终态 run 是 no-op", async () => {
    const runId = await insertRun();
    const handle = await start(agentRunWorkflow, [runId, manifest, {}]);
    const token = await waitForPendingApprovalHook(handle, runId);
    await resumeHook(token, { decision: "approved" });
    expect(await handle.returnValue).toEqual({ status: "completed" });

    const resumedBefore = await db
      .select({ seq: traceEvents.seq })
      .from(traceEvents)
      .where(and(eq(traceEvents.runId, runId), eq(traceEvents.kind, "run.resumed")));
    await markRunRunning(runId); // 守卫早退在 appendTrace 之前，直调安全（同 failRun 终态用例的直调先例）
    const [after] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
    expect(after?.status).toBe("completed");
    const resumedAfter = await db
      .select({ seq: traceEvents.seq })
      .from(traceEvents)
      .where(and(eq(traceEvents.runId, runId), eq(traceEvents.kind, "run.resumed")));
    expect(resumedAfter).toHaveLength(resumedBefore.length);
  }, 240_000);
});
