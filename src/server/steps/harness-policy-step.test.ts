import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowNode } from "@/contracts/workflow";

const mocks = vi.hoisted(() => ({ appendTrace: vi.fn(), persistStep: vi.fn() }));
vi.mock("@/server/steps/trace-step", () => ({ appendTrace: mocks.appendTrace }));
vi.mock("@/server/steps/run-state", () => ({ persistStep: mocks.persistStep }));

import { enforceHarnessPolicy } from "./harness-policy-step";

const node = WorkflowNode.parse({ id: "send", title: "发送通知", type: "tool", tool: {
  connector: "通知系统", action: "send", scope: "message.write", risk: "high", registryToolId: "notice.send", protocol: "http-json",
} });

const originalPolicy = process.env.HARNESS_POLICY_JSON;
beforeEach(() => { vi.clearAllMocks(); delete process.env.HARNESS_POLICY_JSON; });
afterEach(() => { if (originalPolicy === undefined) delete process.env.HARNESS_POLICY_JSON; else process.env.HARNESS_POLICY_JSON = originalPolicy; });

describe("Harness 执行前策略检查", () => {
  it("默认允许并记录裁决，不修改步骤状态", async () => {
    await enforceHarnessPolicy({ runId: "run-1", node });
    expect(mocks.appendTrace).toHaveBeenCalledWith(expect.objectContaining({ kind: "harness.policy", data: expect.objectContaining({ decision: "allow" }) }));
    expect(mocks.persistStep).not.toHaveBeenCalled();
  });

  it("拒绝和无效配置都在外部调用前失败并留痕", async () => {
    process.env.HARNESS_POLICY_JSON = JSON.stringify({ version: 1, rules: [{ id: "no-write", effect: "deny", when: { scope: "message.write" } }] });
    await expect(enforceHarnessPolicy({ runId: "run-1", node })).rejects.toMatchObject({ name: "FatalError" });
    expect(mocks.persistStep).toHaveBeenCalledWith(expect.objectContaining({ status: "failed", nodeId: "send" }));
    expect(mocks.appendTrace).toHaveBeenCalledWith(expect.objectContaining({ kind: "harness.policy", data: expect.objectContaining({ decision: "deny", ruleId: "no-write" }) }));
    vi.clearAllMocks();
    process.env.HARNESS_POLICY_JSON = "{";
    await expect(enforceHarnessPolicy({ runId: "run-1", node })).rejects.toMatchObject({ name: "FatalError" });
    expect(mocks.persistStep).toHaveBeenCalled();
  });
});
