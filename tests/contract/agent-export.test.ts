import { describe, expect, it } from "vitest";
import { AgentExportFile, AgentImportFile } from "@/contracts/agent";
import { AgentManifest } from "@/contracts/manifest";

describe("助手导出文件契约", () => {
  it("接受带完整流程草稿的当前格式", () => {
    const parsed = AgentExportFile.parse({
      format: "agent-studio-cloud",
      formatVersion: 1,
      exportedAt: "2026-09-24T00:00:00.000Z",
      agent: { name: "客户助手", description: null, intentText: "处理客户问题并生成结果" },
      workflow: {
        id: "draft-export",
        rootAgent: { id: "agent", name: "客户助手", role: "客服" },
        memoryPolicy: { taskContext: true, longTerm: false },
        nodes: {
          start: { id: "start", title: "开始", type: "trigger", next: "done" },
          done: { id: "done", title: "结束", type: "end", next: null },
        },
      },
    });
    expect(parsed.workflow.startNodeId).toBe("start");
  });

  it("拒绝未知格式版本", () => {
    expect(AgentExportFile.safeParse({ format: "agent-studio-cloud", formatVersion: 2 }).success).toBe(false);
  });

  it("导入契约同时接受冻结版本文件", () => {
    const workflow = AgentExportFile.parse({
      format: "agent-studio-cloud",
      formatVersion: 1,
      exportedAt: "2026-09-24T00:00:00.000Z",
      agent: { name: "客户助手", description: null, intentText: "处理客户问题并生成结果" },
      workflow: {
        id: "draft-export",
        rootAgent: { id: "agent", name: "客户助手", role: "客服" },
        memoryPolicy: { taskContext: true, longTerm: false },
        nodes: {
          start: { id: "start", title: "开始", type: "trigger", next: "done" },
          done: { id: "done", title: "结束", type: "end", next: null },
        },
      },
    }).workflow;
    const manifest = AgentManifest.parse({
      schemaVersion: "4.0", workflowSnapshot: workflow, workflowFingerprint: "fingerprint",
      inputContract: { fields: [] }, outputContract: { fields: [] },
      resourceSelection: { model: { modelId: "mock", mock: true, connectionId: null } },
      designAudit: { status: "passed", issueCount: 0, criticalCount: 0 }, knowledgeSnapshot: [],
    });
    expect(AgentImportFile.safeParse({
      format: "agent-studio-cloud-version", formatVersion: 1, exportedAt: "2026-09-24T00:00:00.000Z",
      agent: { name: "客户助手" }, version: { number: 2, status: "retired", createdAt: "2026-09-23T00:00:00.000Z" }, manifest,
    }).success).toBe(true);
  });
});
