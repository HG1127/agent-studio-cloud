import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkflowDraft } from "@/contracts/workflow";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {} }));
const startRunCoreMock = vi.hoisted(() => vi.fn());
vi.mock("@/server/services/start-run-core", () => ({ startRunCore: startRunCoreMock }));

import { createEvaluationCaseAction } from "@/server/actions/evaluations";
import { createScheduleAction } from "@/server/actions/create-schedule";
import { saveWorkflowAction } from "@/server/actions/save-workflow";
import { startRunAction } from "@/server/actions/start-run";

const AGENT_ID = "00000000-0000-4000-8000-000000000001";

describe("写入动作校验提示", () => {
  afterEach(() => startRunCoreMock.mockReset());

  it("运行输入过大时返回具体限制", async () => {
    const result = await startRunAction({ agentId: AGENT_ID, input: { content: "x".repeat(101 * 1024) } });
    expect(result).toEqual({ ok: false, error: "运行输入不能超过 100 KB" });
  });

  it("手动运行请求标识映射为服务端幂等键", async () => {
    const requestId = "00000000-0000-4000-8000-000000000099";
    startRunCoreMock.mockResolvedValue({ ok: true, runId: "00000000-0000-4000-8000-000000000088" });

    await startRunAction({ agentId: AGENT_ID, input: { question: "测试" }, requestId });

    expect(startRunCoreMock).toHaveBeenCalledWith({
      agentId: AGENT_ID,
      input: { question: "测试" },
      sourceType: "manual",
      sourceKey: `manual:${requestId}`,
    });
  });

  it("定时运行输入沿用同一大小限制", async () => {
    const result = await createScheduleAction({
      agentId: AGENT_ID,
      spec: { kind: "interval", minutes: 5 },
      input: { content: "x".repeat(101 * 1024) },
    });
    expect(result).toEqual({ ok: false, error: "运行输入不能超过 100 KB" });
  });

  it("超长定时间隔在写库前返回明确错误", async () => {
    const result = await createScheduleAction({
      agentId: AGENT_ID,
      spec: { kind: "interval", minutes: Number.MAX_SAFE_INTEGER },
      input: {},
    });
    expect(result).toEqual({ ok: false, error: "间隔不能超过一年" });
  });

  it("验收样例整体过大时返回具体限制", async () => {
    const result = await createEvaluationCaseAction({
      agentId: AGENT_ID,
      name: "大样例",
      input: {},
      expectations: Array.from({ length: 20 }, (_, index) => ({
        path: `field_${index}`,
        operator: "equals",
        value: "x".repeat(7_000),
      })),
    });
    expect(result).toEqual({ ok: false, error: "单条验收样例不能超过 128KB" });
  });

  it("流程草稿过大时返回具体限制", async () => {
    const draft = WorkflowDraft.parse({
      id: "large-draft",
      startNodeId: "start",
      rootAgent: { id: AGENT_ID, name: "大流程", role: "业务助手" },
      nodes: {
        start: { id: "start", title: "开始", type: "trigger", next: "done" },
        done: { id: "done", title: "完成", type: "end", next: null },
      },
      variables: [],
      memoryPolicy: { taskContext: true, longTerm: false },
      ui: { positions: {} },
    });
    draft.intentSource = { content: "x".repeat(1024 * 1024) };

    const result = await saveWorkflowAction(AGENT_ID, draft);
    expect(result).toEqual({ ok: false, error: "流程草稿不能超过 1MB" });
  });
});
