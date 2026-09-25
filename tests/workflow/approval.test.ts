import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { resumeHook, start } from "workflow/api";
import { AgentManifest } from "@/contracts/manifest";
import { agentRunWorkflow } from "@/server/workflows/agent-run";
import { approvals, runs, traceEvents } from "@/db/schema";
import { db } from "@/lib/db";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { waitForPendingApprovalHook } from "./approval-helpers";

// 最小 manifest：start → human（确认）→ done；拒绝经 not_approved → quality_review → done
const AGENT_ID = "00000000-0000-4000-8000-0000000000c1";
const VERSION_ID = "00000000-0000-4000-8000-0000000000c2";

const manifest = AgentManifest.parse({
  schemaVersion: "4.0",
  workflowFingerprint: "c".repeat(64),
  inputContract: { fields: [] },
  resourceSelection: { model: { modelId: "mock", mock: true } },
  designAudit: { status: "passed", issueCount: 0, criticalCount: 0 },
  workflowSnapshot: {
    id: "draft-approval-test",
    startNodeId: "start",
    rootAgent: { id: "agt_approval_test", name: "审批演示助手", role: "通用业务助手" },
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
      not_approved: {
        id: "not_approved",
        title: "未获确认，保留当前结果并停止高影响动作",
        type: "system",
        next: "quality_review",
        requirementIds: [],
      },
      quality_review: {
        id: "quality_review",
        title: "交付前核对结果与系统回执",
        type: "rule",
        next: "done",
        quality: { requiredOutputTitles: [], minOutputCount: 1, checkToolReceipts: false, checkHumanBoundary: true },
        requirementIds: [],
      },
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

describe("人工审批暂停与恢复", () => {
  it("发起确认时保存上游回复草稿快照", async () => {
    const withDraft = AgentManifest.parse({
      ...manifest,
      workflowSnapshot: {
        ...manifest.workflowSnapshot,
        nodes: {
          ...manifest.workflowSnapshot.nodes,
          start: { ...manifest.workflowSnapshot.nodes.start, next: "draft" },
          draft: { id: "draft", title: "生成回复草稿", type: "ai", next: "confirm", requirementIds: [] },
        },
      },
    });
    const runId = await insertRun();
    const handle = await start(agentRunWorkflow, [runId, withDraft, {}]);
    const token = await waitForPendingApprovalHook(handle, runId);
    const [pending] = await db.select().from(approvals).where(eq(approvals.runId, runId)).limit(1);
    expect(pending?.payload).toMatchObject({
      review: { sourceNodeId: "draft", sourceTitle: "生成回复草稿", content: expect.stringContaining("[模拟输出]") },
    });
    const [waiting] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
    expect(waiting?.context).toMatchObject({ outputs: { draft: expect.stringContaining("[模拟输出]") } });
    await resumeHook(token, { decision: "approved" });
    expect(await handle.returnValue).toEqual({ status: "completed" });
  }, 240_000);

  it("批准：run 挂起在 waiting_approval 且 approvals 有 pending 行，恢复后 completed", async () => {
    const runId = await insertRun();
    const handle = await start(agentRunWorkflow, [runId, manifest, {}]);
    const token = await waitForPendingApprovalHook(handle, runId);

    const [runWhileWaiting] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
    expect(runWhileWaiting?.status).toBe("waiting_approval");
    const [pendingRow] = await db
      .select()
      .from(approvals)
      .where(and(eq(approvals.runId, runId), eq(approvals.nodeId, "confirm")))
      .limit(1);
    expect(pendingRow?.status).toBe("pending");
    expect(pendingRow?.nodeTitle).toBe("负责人确认处理方案");

    await resumeHook(token, { decision: "approved", note: "同意执行" });
    expect(await handle.returnValue).toEqual({ status: "completed" });

    const [runAfter] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
    expect(runAfter?.status).toBe("completed");
    const [decidedRow] = await db
      .select()
      .from(approvals)
      .where(and(eq(approvals.runId, runId), eq(approvals.nodeId, "confirm")))
      .limit(1);
    expect(decidedRow?.status).toBe("approved");
    expect(decidedRow?.note).toBe("同意执行");
    expect(decidedRow?.decidedAt).not.toBeNull();
    expect(runAfter?.result).toMatchObject({
      confirm: { approvalId: pendingRow?.id, decision: "approved", note: "同意执行" },
    });
  }, 240_000);

  it("拒绝：经 not_approved 走质量门禁后 completed，approval 行为 rejected", async () => {
    const runId = await insertRun();
    const handle = await start(agentRunWorkflow, [runId, manifest, {}]);
    const token = await waitForPendingApprovalHook(handle, runId);

    await resumeHook(token, { decision: "rejected", note: "方案需要修改" });
    expect(await handle.returnValue).toEqual({ status: "completed" });

    const [runAfter] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
    expect(runAfter?.status).toBe("completed");
    const [decidedRow] = await db
      .select()
      .from(approvals)
      .where(and(eq(approvals.runId, runId), eq(approvals.nodeId, "confirm")))
      .limit(1);
    expect(decidedRow?.status).toBe("rejected");
    // 批准路径直接 human→done，质量门禁 trace 只会出现在拒绝路径，证明经过了 not_approved
    const traces = await db.select().from(traceEvents).where(eq(traceEvents.runId, runId));
    const kinds = traces.map((t) => t.kind);
    expect(kinds).toContain("approval.requested");
    expect(kinds).toContain("approval.decided");
    expect(kinds).toContain("quality.passed");
  }, 240_000);

  it("拒绝直达：not_approved.next=done 时拒绝后直接完成且不经过质量门禁", async () => {
    // T12 Minor ① rider：拒绝分支直接收尾的最小 manifest——not_approved 不再绕道质量门禁
    const directDoneManifest = AgentManifest.parse({
      ...manifest,
      workflowSnapshot: {
        ...manifest.workflowSnapshot,
        nodes: {
          ...manifest.workflowSnapshot.nodes,
          not_approved: { ...manifest.workflowSnapshot.nodes.not_approved, next: "done" },
        },
      },
    });
    const runId = await insertRun();
    const handle = await start(agentRunWorkflow, [runId, directDoneManifest, {}]);
    const token = await waitForPendingApprovalHook(handle, runId);

    await resumeHook(token, { decision: "rejected", note: "方案需要修改" });
    expect(await handle.returnValue).toEqual({ status: "completed" });

    const [runAfter] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
    expect(runAfter?.status).toBe("completed");
    const [decidedRow] = await db
      .select()
      .from(approvals)
      .where(and(eq(approvals.runId, runId), eq(approvals.nodeId, "confirm")))
      .limit(1);
    expect(decidedRow?.status).toBe("rejected");
    // 质量门禁节点未被访问，不应出现其轨迹
    const traces = await db.select().from(traceEvents).where(eq(traceEvents.runId, runId));
    const kinds = traces.map((t) => t.kind);
    expect(kinds).toContain("approval.decided");
    expect(kinds).not.toContain("quality.passed");
  }, 240_000);

  it("拒绝收尾：交付物按设计缺失时质量门禁仍放行到 completed", async () => {
    // 拒绝后 send 步骤不执行，requiredOutputTitles 里的交付物无法形成——门禁应按未获确认语义放行
    const rejectManifest = AgentManifest.parse({
      ...manifest,
      outputContract: {
        fields: [{ path: "reply", label: "回复邮件", required: true, sourceNodeId: "send" }],
      },
      workflowSnapshot: {
        ...manifest.workflowSnapshot,
        nodes: {
          ...manifest.workflowSnapshot.nodes,
          confirm: { ...manifest.workflowSnapshot.nodes.confirm, next: "send" },
          send: {
            id: "send",
            title: "生成发送内容",
            type: "ai",
            next: "done",
            modelClass: "balanced",
            requirementIds: [],
          },
        },
      },
    });
    const runId = await insertRun();
    const handle = await start(agentRunWorkflow, [runId, rejectManifest, {}]);
    const token = await waitForPendingApprovalHook(handle, runId);

    await resumeHook(token, { decision: "rejected" });
    expect(await handle.returnValue).toEqual({ status: "completed" });

    const [runAfter] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
    expect(runAfter?.status).toBe("completed");
    expect(runAfter?.result).toEqual({
      处理状态: "未获确认",
      说明: "负责人未批准，本次运行已安全停止，后续交付没有执行",
    });
    const traces = await db.select().from(traceEvents).where(eq(traceEvents.runId, runId));
    const passed = traces.find((t) => t.kind === "quality.passed");
    expect(passed?.title).toContain("未获确认");
  }, 240_000);

  it("循环中的同一确认节点每一轮都创建独立确认", async () => {
    const loopManifest = AgentManifest.parse({
      ...manifest,
      workflowFingerprint: "f".repeat(64),
      workflowSnapshot: {
        ...manifest.workflowSnapshot,
        id: "draft-approval-loop-test",
        nodes: {
          start: { id: "start", title: "收到任务", type: "trigger", next: "each_item" },
          each_item: {
            id: "each_item",
            title: "逐项确认",
            type: "loop",
            next: null,
            loop: { collectionPath: "input.items", itemKey: "item", maxIterations: 10, bodyNext: "confirm", exitNext: "done" },
          },
          confirm: { ...manifest.workflowSnapshot.nodes.confirm, next: "each_item" },
          not_approved: { ...manifest.workflowSnapshot.nodes.not_approved, next: "done" },
          done: { id: "done", title: "流程结束", type: "end", next: null },
        },
      },
    });
    const runId = await insertRun();
    const handle = await start(agentRunWorkflow, [runId, loopManifest, { items: ["第一项", "第二项"] }]);
    const firstToken = await waitForPendingApprovalHook(handle, runId);
    await resumeHook(firstToken, { decision: "approved" });
    const secondToken = await waitForPendingApprovalHook(handle, runId, "confirm", firstToken);
    expect(secondToken).not.toBe(firstToken);
    await resumeHook(secondToken, { decision: "approved" });
    await expect(handle.returnValue).resolves.toEqual({ status: "completed" });

    const rows = await db.select().from(approvals).where(and(eq(approvals.runId, runId), eq(approvals.nodeId, "confirm")));
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.status === "approved")).toBe(true);
  }, 240_000);
});
