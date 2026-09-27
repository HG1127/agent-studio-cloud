import { beforeEach, describe, expect, it, vi } from "vitest";
import { FatalError, RetryableError } from "workflow";
import { WorkflowNode } from "@/contracts/workflow";

const mocks = vi.hoisted(() => ({ select: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { select: mocks.select } }));

import { beginAgentCall } from "@/server/steps/agent-call-step";
import { beginHandoff } from "@/server/steps/handoff-step";

const runId = "00000000-0000-4000-8000-000000000001";
const workspaceId = "00000000-0000-4000-8000-000000000002";
const userId = "00000000-0000-4000-8000-000000000003";
const parentAgentId = "00000000-0000-4000-8000-000000000004";
const targetAgentId = "00000000-0000-4000-8000-000000000005";
const versionId = "00000000-0000-4000-8000-000000000006";

const cases = [
  {
    name: "协作",
    node: WorkflowNode.parse({
      id: "call", title: "调用研究助手", type: "agent_call", next: "done",
      agentCall: { targetAgentId, versionId },
    }),
    execute: beginAgentCall,
  },
  {
    name: "交接",
    node: WorkflowNode.parse({
      id: "handoff", title: "交给研究助手", type: "handoff", next: "done",
      toAgent: { id: targetAgentId, name: "研究助手", versionId },
      contract: {
        deliverables: ["研究结果"], mustNotInclude: ["密钥"],
        inputSchema: [{ name: "brief", type: "string" }],
        outputSchema: [{ name: "result", type: "any", required: false }],
        memoryPolicy: { mode: "none", shared: [], private: ["密钥"] },
      },
    }),
    execute: beginHandoff,
  },
] as const;

function selectResult(result: Promise<unknown>) {
  return { from: () => ({ where: () => ({ limit: () => result }) }) };
}

async function captureFailure(testCase: (typeof cases)[number]): Promise<unknown> {
  try {
    await testCase.execute({ runId, node: testCase.node, parentInput: {}, outputs: {} });
  } catch (error) {
    return error;
  }
  return null;
}

beforeEach(() => {
  mocks.select.mockReset();
  mocks.select.mockReturnValueOnce(selectResult(Promise.resolve([{
    workspaceId, createdBy: userId, agentId: parentAgentId,
  }])));
});

describe("协作调用链读取失败分类", () => {
  it.each(cases)("$name调用链数据库暂时失败时安全重试", async (testCase) => {
    mocks.select.mockReturnValueOnce(selectResult(Promise.reject(new Error("private-db-diagnostic"))));
    const error = await captureFailure(testCase);
    expect(RetryableError.is(error)).toBe(true);
    expect((error as Error).message).toBe("助手协作运行链暂时无法读取，请稍后重试");
    expect((error as Error).message).not.toContain("private-db-diagnostic");
    expect(mocks.select).toHaveBeenCalledTimes(2);
  });

  it.each(cases)("$name调用链结构缺失时永久失败", async (testCase) => {
    mocks.select.mockReturnValueOnce(selectResult(Promise.resolve([])));
    const error = await captureFailure(testCase);
    expect(FatalError.is(error)).toBe(true);
    expect(RetryableError.is(error)).toBe(false);
    expect((error as Error).message).toContain("无法确认助手协作调用链");
    expect(mocks.select).toHaveBeenCalledTimes(2);
  });
});
