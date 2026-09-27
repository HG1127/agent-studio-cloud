import { describe, expect, it } from "vitest";
import { WorkflowDraft } from "@/contracts/workflow";
import { AgentManifest } from "@/contracts/manifest";
import { importRequestMatches, normalizeAgentImport } from "@/server/domain/import-agent";

const id = "00000000-0000-4000-8000-0000000000d1";
const workflow = WorkflowDraft.parse({
  id: "workflow-import-retry",
  rootAgent: { id, name: "导入助手", role: "业务助手" },
  nodes: {
    start: { id: "start", title: "开始", type: "trigger", next: "done" },
    done: { id: "done", title: "结束", type: "end", next: null },
  },
  memoryPolicy: { taskContext: true, longTerm: false },
});
const imported = {
  name: "导入助手",
  description: "导入描述",
  intentText: "导入意图",
  workflow,
};

describe("导入请求幂等判断", () => {
  it("没有导入指纹时只复用内容相同的历史流程", () => {
    const existing = { id, ...imported, draft: workflow, importFingerprint: null };
    expect(importRequestMatches(existing, imported, "fingerprint")).toBe(true);
    const changed = {
      ...imported,
      workflow: WorkflowDraft.parse({ ...workflow, memoryPolicy: { taskContext: true, longTerm: true } }),
    };
    expect(importRequestMatches(existing, changed, "fingerprint")).toBe(false);
  });

  it("已保存导入指纹时严格按原请求内容识别", () => {
    const existing = { id, ...imported, draft: workflow, importFingerprint: "original" };
    expect(importRequestMatches(existing, imported, "original")).toBe(true);
    expect(importRequestMatches(existing, imported, "changed")).toBe(false);
    expect(importRequestMatches({ ...existing, name: "其他助手" }, imported, "original")).toBe(false);
  });
});

describe("冻结版本导入", () => {
  it("旧导出文件顶层名称与清单不同也使用发布时冻结名称", () => {
    const manifest = AgentManifest.parse({
      schemaVersion: "4.0", workflowFingerprint: "frozen-name", workflowSnapshot: workflow,
      inputContract: { fields: [] }, outputContract: { fields: [] },
      resourceSelection: { model: { modelId: "mock", mock: true, connectionId: null } },
      designAudit: { status: "passed", issueCount: 0, criticalCount: 0 }, knowledgeSnapshot: [],
    });
    const result = normalizeAgentImport({
      format: "agent-studio-cloud-version", formatVersion: 1, exportedAt: "2026-09-28T00:00:00.000Z",
      agent: { name: "后来修改的名称" },
      version: { number: 1, status: "retired", createdAt: "2026-09-27T00:00:00.000Z" },
      manifest,
    });

    expect(result?.name).toBe("导入助手");
    expect(result?.workflow.rootAgent.name).toBe("导入助手");
  });
});
