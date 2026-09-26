import { describe, expect, it } from "vitest";
import { AgentManifest } from "@/contracts/manifest";
import { WorkflowDraft, WorkflowNode } from "@/contracts/workflow";
import {
  agentImportSizeIssue,
  importedCollaborationKeys,
  importedWorkflowIssue,
  MAX_AGENT_IMPORT_BYTES,
  normalizeAgentImport,
  rebindImportedWorkflow,
} from "@/server/domain/import-agent";

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
  it("服务端拒绝超大或无法序列化的导入内容", () => {
    expect(agentImportSizeIssue({ text: "x".repeat(MAX_AGENT_IMPORT_BYTES) })).toBe("导入文件不能超过 2MB");
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(agentImportSizeIssue(circular)).toBe("导入内容不是有效的 JSON");
    expect(normalizeAgentImport(circular)).toBeNull();
  });

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
      workflowSnapshot: {
        ...workflow,
        nodes: {
          start: { id: "start", title: "开始", type: "trigger", next: "deliver" },
          deliver: { id: "deliver", title: "生成交付", type: "ai", next: "done" },
          done: { id: "done", title: "结束", type: "end", next: null },
        },
        variables: [
          { name: "stale_input", label: "旧输入", type: "string", scope: "run", required: true },
          { name: "internal_note", label: "内部记录", type: "string", scope: "step", required: false },
        ],
        outputContract: { fields: [{ path: "stale", label: "旧交付", required: true, sourceNodeId: "deliver" }] },
      },
      workflowFingerprint: "fingerprint",
      inputContract: { fields: [
        { name: "request", label: "业务需求", required: true, type: "string" },
        { name: "priority", label: "优先级", required: false, type: "number" },
      ] },
      outputContract: { fields: [{ path: "delivery", label: "最终方案", required: true, sourceNodeId: "deliver" }] },
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
      workflow: {
        versionId: null,
        rootAgent: { name: "合同助手" },
        variables: [
          { name: "internal_note", label: "内部记录", type: "string", scope: "step", required: false },
          { name: "request", label: "业务需求", type: "string", scope: "run", required: true },
          { name: "priority", label: "优先级", type: "number", scope: "run", required: false },
        ],
        outputContract: { fields: [{ path: "delivery", label: "最终方案", required: true, sourceNodeId: "deliver" }] },
      },
    });
    expect(result?.workflow.variables.some((variable) => variable.name === "stale_input")).toBe(false);
    expect(importedWorkflowIssue(result!.workflow)).toBeNull();
  });

  it("拒绝未知文件格式", () => {
    expect(normalizeAgentImport({ format: "unknown", formatVersion: 1 })).toBeNull();
  });

  it("拒绝断链或包含不安全步骤标识的流程", () => {
    expect(importedWorkflowIssue(WorkflowDraft.parse({
      ...workflow,
      nodes: {
        start: { id: "start", title: "开始", type: "trigger", next: "missing" },
        done: { id: "done", title: "结束", type: "end", next: null },
      },
    }))).toBe("步骤“开始”的正常路径指向了不存在的步骤");

    const historicalUnsafe = WorkflowDraft.parse(workflow);
    historicalUnsafe.startNodeId = "unsafe.node";
    Object.defineProperty(historicalUnsafe.nodes, "unsafe.node", {
      configurable: true,
      enumerable: true,
      value: WorkflowNode.parse({ id: "unsafe.node", title: "开始", type: "trigger", next: "done" }),
    });
    expect(importedWorkflowIssue(historicalUnsafe)).toBe("步骤“开始”的标识包含不安全字符");
  });

  it("导入前拒绝运行器无法执行的内嵌步骤", () => {
    const unsupportedInline = WorkflowDraft.parse({
      ...workflow,
      nodes: {
        start: { id: "start", title: "开始", type: "trigger", next: "group" },
        group: {
          id: "group",
          title: "一组步骤",
          type: "subflow",
          next: "done",
          subflow: {
            name: "人工处理",
            steps: [{ id: "approve", title: "人工确认", type: "human", approval: { role: "负责人", reason: "核对" } }],
          },
        },
        done: { id: "done", title: "结束", type: "end", next: null },
      },
    });

    expect(importedWorkflowIssue(unsupportedInline)).toContain("暂不支持步骤类型「human」");
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
      validKnowledgeSourceIds: new Set(),
      isToolBindingValid: () => true,
    });
    expect(rebound).toMatchObject({ versionId: null, rootAgent: { id: "new-agent", name: "导入副本" } });
    expect(rebound.nodes.call.agentCall).toMatchObject({ targetAgentId: "target-a", versionId: "version-a" });
    expect(rebound.nodes.handoff.toAgent).toEqual({ id: "", versionId: "" });
    expect(rebound.nodes.handoff.contract).toBeUndefined();
  });

  it("递归校验并清理一组步骤和并行工作中的协作引用", () => {
    const withNestedCollaboration = WorkflowDraft.parse({
      ...workflow,
      nodes: {
        start: { id: "start", title: "开始", type: "trigger", next: "group" },
        group: {
          id: "group",
          title: "一组步骤",
          type: "subflow",
          next: "parallel",
          subflow: {
            name: "协作处理",
            steps: [{ id: "nested-call", title: "协作", type: "agent_call", agentCall: { targetAgentId: "target-a", versionId: "version-a" } }],
          },
        },
        parallel: {
          id: "parallel",
          title: "并行处理",
          type: "parallel",
          next: "done",
          parallel: {
            strategy: "all",
            failurePolicy: "fail_fast",
            branches: [{
              id: "branch",
              label: "交接处理",
              steps: [{
                id: "nested-handoff",
                title: "交接",
                type: "handoff",
                toAgent: { id: "target-b", versionId: "version-b" },
                contract: { deliverables: ["结果"], mustNotInclude: ["密钥"], inputSchema: [], outputSchema: [] },
              }],
            }],
          },
        },
        done: { id: "done", title: "结束", type: "end" },
      },
    });

    expect(importedCollaborationKeys(withNestedCollaboration)).toEqual([
      "target-a:version-a",
      "target-b:version-b",
    ]);

    const rebound = rebindImportedWorkflow({
      workflow: withNestedCollaboration,
      agentId: "new-agent",
      agentName: "导入副本",
      validCollaborationKeys: new Set(["target-a:version-a"]),
      validKnowledgeSourceIds: new Set(),
      isToolBindingValid: () => true,
    });
    const subflowSteps = rebound.nodes.group.subflow?.steps as Array<Record<string, unknown>>;
    const parallelSteps = rebound.nodes.parallel.parallel?.branches[0].steps as Array<Record<string, unknown>>;
    expect(subflowSteps[0].agentCall).toMatchObject({ targetAgentId: "target-a", versionId: "version-a" });
    expect(parallelSteps[0].toAgent).toEqual({ id: "", versionId: "" });
    expect(parallelSteps[0].contract).toBeUndefined();
  });

  it("只保留当前工作区可用的资料绑定并要求确认被清理的范围", () => {
    const available = "00000000-0000-4000-8000-000000000031";
    const missing = "00000000-0000-4000-8000-000000000032";
    const withKnowledge = WorkflowDraft.parse({
      ...workflow,
      nodes: {
        start: { id: "start", title: "开始", type: "trigger", next: "knowledge" },
        knowledge: {
          id: "knowledge",
          title: "查资料",
          type: "knowledge",
          next: "done",
          knowledge: { space: "资料库", sourceIds: [available, missing] },
        },
        done: { id: "done", title: "结束", type: "end" },
      },
    });

    const rebound = rebindImportedWorkflow({
      workflow: withKnowledge,
      agentId: "new-agent",
      agentName: "导入副本",
      validCollaborationKeys: new Set(),
      validKnowledgeSourceIds: new Set([available]),
      isToolBindingValid: () => true,
    });

    expect(rebound.nodes.knowledge.knowledge).toMatchObject({
      sourceIds: [available],
      selectionRequired: true,
    });
  });

  it("清理当前环境不可用的顶层和内嵌业务工具绑定", () => {
    const externalTool = {
      connector: "客户系统",
      action: "update_customer",
      scope: "customer.write",
      risk: "medium" as const,
      registryToolId: "crm.update",
      protocol: "http-json",
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
    };
    const withTools = WorkflowDraft.parse({
      ...workflow,
      nodes: {
        start: { id: "start", title: "开始", type: "trigger", next: "tool" },
        tool: { id: "tool", title: "更新客户", type: "tool", tool: externalTool, next: "group" },
        group: {
          id: "group",
          title: "一组步骤",
          type: "subflow",
          subflow: { name: "工具处理", steps: [{ id: "nested", title: "再次更新", type: "tool", tool: externalTool }] },
          next: "done",
        },
        done: { id: "done", title: "结束", type: "end" },
      },
    });

    const rebound = rebindImportedWorkflow({
      workflow: withTools,
      agentId: "new-agent",
      agentName: "导入副本",
      validCollaborationKeys: new Set(),
      validKnowledgeSourceIds: new Set(),
      isToolBindingValid: () => false,
    });
    const nested = rebound.nodes.group.subflow?.steps[0] as Record<string, unknown>;
    expect(rebound.nodes.tool.tool).toMatchObject({ registryToolId: null, protocol: "unbound", unresolved: true });
    expect(nested.tool).toMatchObject({ registryToolId: null, protocol: "unbound", unresolved: true });
  });
});
