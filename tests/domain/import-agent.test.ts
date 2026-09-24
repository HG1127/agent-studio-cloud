import { describe, expect, it } from "vitest";
import { AgentManifest } from "@/contracts/manifest";
import { WorkflowDraft } from "@/contracts/workflow";
import { importedCollaborationKeys, normalizeAgentImport, rebindImportedWorkflow } from "@/server/domain/import-agent";

const workflow = WorkflowDraft.parse({
  id: "workflow-import",
  versionId: "old-version",
  rootAgent: { id: "root-agent", name: "原名称", role: "业务助手" },
  memoryPolicy: { taskContext: true, longTerm: false },
  nodes: {
    start: { id: "start", title: "开始", type: "trigger", next: "done" },
    done: { id: "done", title: "结束", type: "end", next: null },
  },
});

describe("助手导入格式归一化", () => {
  it("保留助手定义中的名称、说明、意图和草稿", () => {
    const result = normalizeAgentImport({
      format: "agent-studio-cloud",
      formatVersion: 1,
      exportedAt: "2026-09-24T00:00:00.000Z",
      agent: { name: "客户助手", description: "处理客户问题", intentText: "处理客户问题并生成可核对的答复" },
      workflow,
    });
    expect(result).toMatchObject({ name: "客户助手", description: "处理客户问题", intentText: "处理客户问题并生成可核对的答复" });
    expect(result?.workflow.id).toBe("workflow-import");
  });

  it("把冻结版本转换为脱离原版本状态的可编辑草稿", () => {
    const manifest = AgentManifest.parse({
      schemaVersion: "4.0",
      workflowSnapshot: workflow,
      workflowFingerprint: "fingerprint",
      inputContract: { fields: [] },
      outputContract: { fields: [] },
      resourceSelection: { model: { modelId: "mock", mock: true, connectionId: null } },
      designAudit: { status: "passed", issueCount: 0, criticalCount: 0 },
      knowledgeSnapshot: [],
    });
    const result = normalizeAgentImport({
      format: "agent-studio-cloud-version",
      formatVersion: 1,
      exportedAt: "2026-09-24T00:00:00.000Z",
      agent: { name: "合同助手" },
      version: { number: 7, status: "retired", createdAt: "2026-09-23T00:00:00.000Z" },
      manifest,
    });
    expect(result).toMatchObject({
      name: "合同助手",
      description: "从冻结版本 7 导入的可编辑副本",
      workflow: { versionId: null, rootAgent: { name: "合同助手" } },
    });
  });

  it("拒绝未知文件格式", () => {
    expect(normalizeAgentImport({ format: "unknown", formatVersion: 1 })).toBeNull();
  });

  it("导入副本重绑定根助手并清理当前工作区不存在的协作引用", () => {
    const withCollaboration = WorkflowDraft.parse({
      ...workflow,
      nodes: {
        start: { id: "start", title: "开始", type: "trigger", next: "call" },
        call: { id: "call", title: "协作", type: "agent_call", next: "handoff", agentCall: { targetAgentId: "target-a", versionId: "version-a", workflowId: "version-a" } },
        handoff: { id: "handoff", title: "交接", type: "handoff", next: "done", toAgent: { id: "target-b", versionId: "version-b" }, contract: { deliverables: ["结果"], mustNotInclude: ["密钥"], inputSchema: [], outputSchema: [] } },
        done: { id: "done", title: "结束", type: "end" },
      },
    });
    expect(importedCollaborationKeys(withCollaboration)).toEqual(["target-a:version-a", "target-b:version-b"]);

    const rebound = rebindImportedWorkflow({
      workflow: withCollaboration,
      agentId: "new-agent",
      agentName: "导入副本",
      validCollaborationKeys: new Set(["target-a:version-a"]),
    });
    expect(rebound).toMatchObject({ versionId: null, rootAgent: { id: "new-agent", name: "导入副本" } });
    expect(rebound.nodes.call.agentCall).toMatchObject({ targetAgentId: "target-a", versionId: "version-a" });
    expect(rebound.nodes.handoff.toAgent).toEqual({ id: "", versionId: "" });
    expect(rebound.nodes.handoff.contract).toBeUndefined();
  });
});
