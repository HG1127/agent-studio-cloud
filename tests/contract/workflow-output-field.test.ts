import { describe, expect, it } from "vitest";
import { WorkflowDraft, WorkflowOutputField } from "@/contracts/workflow";
import { AgentManifest } from "@/contracts/manifest";

const field = { path: "交付.金额", required: true, sourceNodeId: "extract" };
const snapshot = { id: "contract", rootAgent: { id: "agent", name: "助手", role: "处理" }, memoryPolicy: { taskContext: true, longTerm: false }, nodes: {} };
describe("最终交付来源字段契约", () => {
  it("旧字段不生成来源路径默认值，保持旧版本指纹形状", () => {
    expect(WorkflowOutputField.parse(field)).toEqual(field);
    expect(Object.hasOwn(WorkflowOutputField.parse(field), "sourcePath")).toBe(false);
    expect(WorkflowOutputField.parse({ ...field, sourcePath: [] })).toEqual({ ...field, sourcePath: [] });
  });
  it("明确字段路径必须同时选择业务步骤", () => {
    expect(WorkflowOutputField.safeParse({ path: "交付", sourcePath: ["amount"] }).success).toBe(false);
    expect(WorkflowOutputField.safeParse({ path: "交付", sourcePath: [] }).success).toBe(false);
  });
  it("来源路径最多三十二段，每段最多二百字，含点名称保持原义", () => {
    expect(WorkflowOutputField.safeParse({ ...field, sourcePath: Array(32).fill("x") }).success).toBe(true);
    expect(WorkflowOutputField.safeParse({ ...field, sourcePath: Array(33).fill("x") }).success).toBe(false);
    expect(WorkflowOutputField.safeParse({ ...field, sourcePath: ["x".repeat(201)] }).success).toBe(false);
    expect(WorkflowOutputField.parse({ ...field, sourcePath: ["a.b", "0"] }).sourcePath).toEqual(["a.b", "0"]);
  });
  it.each(["__proto__", "prototype", "constructor", ""])("来源路径拒绝保留或空字段 %s", (key) => {
    expect(WorkflowOutputField.safeParse({ ...field, sourcePath: [key] }).success).toBe(false);
  });
  it("草稿与冻结版本使用同一字段契约，序列化后仍保留选择", () => {
    const outputContract = { fields: [{ ...field, sourcePath: ["rows", "0", "amount"] }] };
    const draft = WorkflowDraft.parse({ ...snapshot, outputContract });
    const manifest = AgentManifest.parse({ schemaVersion: "4.0", workflowFingerprint: "selection", workflowSnapshot: draft, outputContract,
      inputContract: { fields: [] }, resourceSelection: { model: { modelId: "mock", mock: true } },
      designAudit: { status: "passed", issueCount: 0, criticalCount: 0 },
    });
    const restored = AgentManifest.parse(JSON.parse(JSON.stringify(manifest)));
    expect(restored.outputContract).toEqual(outputContract);
    expect(restored.workflowSnapshot.outputContract).toEqual(outputContract);
    expect(WorkflowDraft.safeParse({ ...snapshot, outputContract: { fields: Array(101).fill(field) } }).success).toBe(false);
  });
});
