import { describe, expect, it } from "vitest";
import { WorkflowNode } from "@/contracts/workflow";
import { resolveStepToolOperation } from "./tool-operation";

describe("MCP 写步骤自动持久防重配置", () => {
  const node = WorkflowNode.parse({ id: "write", title: "写入", type: "tool", tool: {
    connector: "订单", registryToolId: "orders", protocol: "mcp-streamable-http", operationKind: "action", action: "create", scope: "write",
  } });
  const metadata = { runId: "run-1", stepId: "step-1", attempt: 1, startedAt: new Date(1000) };
  it("首次和重试复用同一持久标识与原外部键，但旧重试不能新建待执行记录", () => {
    const first = resolveStepToolOperation({ node, ...metadata });
    const retried = resolveStepToolOperation({ node, ...metadata, attempt: 2 });
    expect(first).toEqual({ ok: true, config: { scope: "studio.mcp-step.v1", key: { kind: "literal", value: '["run-1","step-1"]' } },
      stepInvocation: { idempotencyKey: "run-1:write:step-1", mayCreate: true, startedAt: metadata.startedAt } });
    expect(retried).toEqual({ ...first, stepInvocation: { idempotencyKey: "run-1:write:step-1", mayCreate: false, startedAt: metadata.startedAt } });
    expect(node.toolOperation).toBeUndefined();
  });
  it("显式业务防重配置原样保留，不替换跨运行键或外部防重方式", () => {
    const explicit = WorkflowNode.parse({ ...node, toolOperation: { scope: "orders", key: { kind: "input", path: ["orderId"] } } });
    expect(resolveStepToolOperation({ node: explicit, ...metadata })).toEqual({ ok: true, config: explicit.toolOperation });
  });
  it.each([{ protocol: "http-json", operationKind: "action" }, { protocol: "mcp-streamable-http", operationKind: "read" },
    { protocol: "demo" }, { protocol: "mcp-streamable-http" }] as const)("非MCP写步骤保持原调用路径 %#", (tool) => {
    expect(resolveStepToolOperation({ node: { ...node, tool: { ...node.tool!, operationKind: undefined, ...tool } }, ...metadata })).toEqual({ ok: true });
  });
  it("不同运行和循环新调用隔离，不使用尝试次数组成业务键，长节点名不截断", () => {
    const first = resolveStepToolOperation({ node, ...metadata });
    for (const change of [{ runId: "run-2" }, { stepId: "step-2" }]) {
      const other = resolveStepToolOperation({ node, ...metadata, ...change });
      expect(other.ok && other.config).not.toEqual(first.ok && first.config);
    }
    expect(resolveStepToolOperation({ node: { ...node, id: "n".repeat(200) }, ...metadata }).ok).toBe(true);
  });
  it.each([{ runId: "" }, { stepId: " " }, { stepId: "x".repeat(257) }, { attempt: 0 }, { attempt: 1.5 },
    { attempt: NaN }, { startedAt: new Date(NaN) }])("执行定位无效时失败关闭，不退回无账本写入 %#", (change) => {
    expect(resolveStepToolOperation({ node, ...metadata, ...change })).toEqual({ ok: false, error: "工具步骤的执行标识无效，已阻止重复写入" });
  });
});
