import { describe, expect, it } from "vitest";
import { buildMvpTemplate } from "@/server/domain/mvp-template";
import { compileModelWorkflowPlan } from "@/server/domain/compile";
import { WorkflowDraft } from "@/contracts/workflow";
import { toolRegistrationCompatibilityIssue } from "@/server/tools/tool-binding";
import { parseToolRegistry } from "@/server/tools/tool-registry";
import { mvpTemplateInput, mvpTemplateRegistry } from "../fixtures/mvp-template";
describe("模板和已绑定编译器保持完整远端名称", () => {
  it.each(["_helper", "a".repeat(101), "a".repeat(128)])("模板读写快照保留名称 %s", (action) => {
    const registry = mvpTemplateRegistry.map((tool) => ({ ...tool, action }));
    const built = buildMvpTemplate(mvpTemplateInput, registry);
    expect(built.ok).toBe(true); if (!built.ok) throw new Error(built.error);
    expect(built.draft.nodes.read.tool?.action).toBe(action);
    expect(built.draft.nodes.execute.tool?.action).toBe(action);
    expect(built.draft.nodes.execute.toolOperation?.scope).toBe(registry[1].id);
    const registration = parseToolRegistry(JSON.stringify([{ ...registry[1], endpoint: "http://127.0.0.1:9000/mcp" }]))[0];
    expect(toolRegistrationCompatibilityIssue(built.draft.nodes.execute.tool!, registration)).toBeNull();
    expect(toolRegistrationCompatibilityIssue({ ...built.draft.nodes.execute.tool!, action: action.slice(1) }, registration)).not.toBeNull();
  });
  it.each(["_helper", "a".repeat(101), "a".repeat(128)])("已绑定编译器不截断远端名称 %s", (action) => {
    const built = compileModelWorkflowPlan({ intent: { trigger: { value: "收到任务" }, outputs: ["结果"], orderedSteps: [{ id: "read", title: "读取记录", type: "tool", registryToolId: "registered-read" }, { id: "plan", title: "整理结果", type: "ai" }] }, caps: [{ id: "registered-read", registryToolId: "registered-read", source: "connected-registry", action, label: "登记取数", scope: "business.read", protocol: "mcp-streamable-http", operationKind: "read", risk: "low", inputSchema: { type: "object" }, outputSchema: { type: "object" } }] });
    expect(built).not.toBeNull(); if (!built) throw new Error("编译结果无效");
    const workflow = WorkflowDraft.parse(built.workflow);
    expect(workflow.nodes.read.tool?.action).toBe(action);
    expect(workflow.nodes.read.tool?.registryToolId).toBe("registered-read");
  });
});
