import { describe, expect, it } from "vitest";
import { ToolOperationConfig, ToolOperationListInput, ToolOperationPayload, ToolOperationReceipt, ToolOperationResolveInput, ToolOperationSummary } from "./tool-operation";
import { WorkflowNode } from "./workflow";

const config = { scope: "order-create", key: { kind: "input", path: ["orderId"] } };
describe("业务操作防重共享契约", () => {
  it("列表默认限额，微秒游标必须成对且不允许选择其他工作区", () => {
    const id = "00000000-0000-4000-8000-000000000123";
    expect(ToolOperationListInput.parse({})).toEqual({ limit: 20 });
    expect(ToolOperationListInput.parse({ before: "2026-10-08T12:00:00.000123Z", beforeId: id, limit: "2" }).limit).toBe(2);
    for (const input of [{ beforeId: id }, { before: "2026-10-08T12:00:00Z" }, { limit: 51 }, { workspaceId: id }]) {
      expect(ToolOperationListInput.safeParse(input).success).toBe(false);
    }
  });
  it("列表摘要不携带业务回执、核对正文或请求指纹", () => {
    const id = "00000000-0000-4000-8000-000000000123", time = "2026-10-08T12:00:00Z";
    const summary = ToolOperationSummary.parse({ id, sourceRunId: id, nodeTitle: "登记", toolId: "orders", status: "blocked", error: null,
      retryDeadline: time, createdAt: time, updatedAt: time, resolutionCount: 1,
      receipt: { secret: "private" }, resolutions: [{ reason: "private" }], requestHash: "private",
    });
    expect(summary).not.toHaveProperty("receipt");
    expect(summary).not.toHaveProperty("resolutions");
    expect(summary).not.toHaveProperty("requestHash");
  });
  it("人工核对必须明确确认状态，不接受空原因或同意标记缺失", () => {
    const base = { operationId: "00000000-0000-4000-8000-000000000123", requestId: "00000000-0000-4000-8000-000000000124", reason: "业务系统已核对" };
    expect(ToolOperationResolveInput.safeParse({ ...base, kind: "retry" }).success).toBe(false);
    expect(ToolOperationResolveInput.safeParse({ ...base, kind: "retry", confirmedNotExecuted: true }).success).toBe(true);
    expect(ToolOperationResolveInput.safeParse({ ...base, reason: "", kind: "retry", confirmedNotExecuted: true }).success).toBe(false);
    expect(ToolOperationResolveInput.safeParse({ ...base, kind: "record-receipt", confirmedCompleted: true, receipt: { receiptId: "r1" } }).success).toBe(true);
  });
  it("真实工具显式启用，旧节点不默认防重", () => {
    expect(WorkflowNode.parse({ id: "write", title: "登记", type: "tool", toolOperation: config }).toolOperation).toEqual(config);
    expect(WorkflowNode.parse({ id: "write", title: "登记", type: "tool" })).not.toHaveProperty("toolOperation");
  });
  it.each(["ai", "system", "agent_call", "handoff"])("%s 不能虚标跨运行写入防重", (type) => {
    expect(WorkflowNode.safeParse({ id: "write", title: "登记", type, toolOperation: config }).success).toBe(false);
  });
  it("演示工具不能配置业务防重", () => {
    expect(WorkflowNode.safeParse({ id: "write", title: "登记", type: "tool", toolOperation: config, tool: {
      connector: "演示", action: "record", scope: "demo", registryToolId: "demo", protocol: "demo",
    } }).success).toBe(false);
  });
  it.each(["", "x y", "中", "a".repeat(101)])("范围 %s 不能为空或包含不安全字符", (scope) => {
    expect(ToolOperationConfig.safeParse({ ...config, scope }).success).toBe(false);
  });
  it("拒绝未知配置字段和保留来源路径", () => {
    expect(ToolOperationConfig.safeParse({ ...config, fallback: "guess" }).success).toBe(false);
    expect(ToolOperationConfig.safeParse({ ...config, key: { kind: "input", path: ["constructor"] } }).success).toBe(false);
  });
  it("请求和回执都是有界可保存 JSON，不允许危险字段", () => {
    expect(ToolOperationPayload.parse({ action: "record", input: { amount: 0, approved: false }, outputs: {} }).input).toEqual({ amount: 0, approved: false });
    expect(ToolOperationPayload.safeParse({ action: "record", input: { huge: "a".repeat(512 * 1024) }, outputs: {} }).success).toBe(false);
    expect(ToolOperationReceipt.safeParse(JSON.parse('{"constructor":"bad"}')).success).toBe(false);
    expect(ToolOperationReceipt.safeParse([]).success).toBe(false);
  });
});
