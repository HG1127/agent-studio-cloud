import { describe, expect, it, vi } from "vitest";
import { AgentManifest } from "@/contracts/manifest";
import { WorkflowNode } from "@/contracts/workflow";
import { inspectCollaborationVersionGraph } from "@/server/domain/runtime/collaboration-dependencies";
import { collaborationToolRegistrationIssue } from "@/server/tools/collaboration-tool-binding";
import type { ToolRegistration } from "@/server/tools/tool-registry";

type Dependency = Parameters<typeof inspectCollaborationVersionGraph>[0]["versions"][number];
const registration = (protocol: "http-json" | "mcp-streamable-http" = "mcp-streamable-http"): ToolRegistration => ({
  id: "records.lookup", name: "业务查询", description: "", endpoint: "https://fixture.example/tools", method: "POST",
  headers: { Authorization: "Bearer fixture-registry-private-123456" }, action: "lookup", scope: "records.read", risk: "low",
  protocol, ...(protocol === "mcp-streamable-http" ? { operationKind: "read" as const } : {}),
  inputSchema: { type: "object" }, outputSchema: { type: "object", properties: { amount: { type: "number" } } },
});
const tool = (protocol: "http-json" | "mcp-streamable-http" = "mcp-streamable-http") => {
  const row = registration(protocol);
  return WorkflowNode.parse({ id: "lookup", type: "tool", title: "查询记录", tool: {
    connector: row.name, registryToolId: row.id, protocol, action: row.action, scope: row.scope, risk: row.risk,
    inputSchema: row.inputSchema, outputSchema: row.outputSchema,
    ...(protocol === "mcp-streamable-http" ? { operationKind: "read" } : {}),
  } });
};
function manifest(work: WorkflowNode = WorkflowNode.parse({ id: "work", type: "ai", title: "整理", next: "done" })): AgentManifest {
  return AgentManifest.parse({
    schemaVersion: "4.0", workflowFingerprint: "a".repeat(64), inputContract: { fields: [] }, outputContract: { fields: [] }, knowledgeSnapshot: [],
    resourceSelection: { model: { modelId: "mock", mock: true, connectionId: null } }, designAudit: { status: "passed", issueCount: 0, criticalCount: 0 },
    workflowSnapshot: { id: "workflow", startNodeId: "start", rootAgent: { id: "agent", name: "协作助手", role: "查询" },
      memoryPolicy: { taskContext: true, longTerm: false }, nodes: {
        start: { id: "start", title: "开始", type: "trigger", next: work.id }, [work.id]: { ...work, next: "done" },
        done: { id: "done", title: "结束", type: "end", next: null },
      },
    },
  });
}
const dependency = (data = manifest(tool())): Dependency => ({ versionId: "version-a", agentId: "agent-a", agentName: "查询助手", status: "retired", agentArchivedAt: null, manifest: data });

describe("协作图冻结工具的本地预检", () => {
  it.each((["http-json", "mcp-streamable-http"] as const).flatMap((protocol) => ["direct", "parallel", "subflow"].map((location) => ({ protocol, location }))))("$protocol / $location 复用实际绑定规则，不要求历史冻结版本仍在线", ({ protocol, location }) => {
    const step = tool(protocol);
    const work = location === "direct" ? step : WorkflowNode.parse(location === "subflow"
      ? { id: "work", title: "分组", type: "subflow", subflow: { name: "业务查询", steps: [step] } }
      : { id: "work", title: "并行", type: "parallel", parallel: { strategy: "all", failurePolicy: "fail_fast", branches: [
        { id: "left", label: "业务查询", steps: [step] }, { id: "right", label: "整理", steps: [{ id: "organize", title: "整理", type: "ai" }] },
      ] } });
    const versions = [dependency(manifest(work))], before = JSON.stringify(versions);
    const lookup = vi.fn(() => registration(protocol));
    expect(collaborationToolRegistrationIssue(versions, ["version-a"], lookup)).toBeNull();
    expect(lookup).toHaveBeenCalledWith("records.lookup");
    expect(collaborationToolRegistrationIssue(versions, ["version-a"], () => null)).toContain("未在服务端配置");
    expect(JSON.stringify(versions)).toBe(before);
  });

  it.each([
    { id: "other-tool" }, { protocol: "http-json" as const }, { operationKind: "action" as const }, { action: "delete" },
    { scope: "records.admin" }, { risk: "high" as const }, { inputSchema: { type: "object", required: ["query"] } },
    { outputSchema: { type: "object", properties: { amount: { type: "string" } } } },
  ])("协作版本不能绕过登记元数据和输入/回执漂移 %#", (change) => {
    expect(collaborationToolRegistrationIssue([dependency()], ["version-a"], () => ({ ...registration(), ...change }))).not.toBeNull();
  });

  it.each(["missing", "archived", "malformed", "duplicate"])("所需冻结版本 %s 时关闭预检且不查工具", (mode) => {
    const row = dependency();
    const versions = mode === "missing" ? [] : mode === "duplicate" ? [row, { ...row, agentId: "another-agent" }]
      : [{ ...row, ...(mode === "archived" ? { agentArchivedAt: new Date() } : { manifest: {} }) }];
    const lookup = vi.fn(() => registration());
    expect(collaborationToolRegistrationIssue(versions, ["version-a"], lookup)).not.toBeNull();
    expect(lookup).not.toHaveBeenCalled();
  });

  it("空协作图不读取历史坏版本或工具配置", () => {
    const lookup = vi.fn(() => registration());
    expect(collaborationToolRegistrationIssue([{ ...dependency(), manifest: {} }], [], lookup)).toBeNull();
    expect(lookup).not.toHaveBeenCalled();
  });

  it("未引用的坏版本及同助手其他冻结版本不阻断本条协作链", () => {
    const row = dependency(), unused = { ...row, versionId: "unused", manifest: {} };
    expect(collaborationToolRegistrationIssue([unused, row], ["version-a"], () => registration())).toBeNull();
  });

  it("共享协作版本只检查一次，不因同一版本多次被引用重复读取配置", () => {
    const lookup = vi.fn(() => registration());
    expect(collaborationToolRegistrationIssue([dependency()], ["version-a", "version-a"], lookup)).toBeNull();
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it("使用真实传递协作图选出的版本，检查深层助手而不是只查直接助手", () => {
    const child = dependency(manifest(WorkflowNode.parse({ id: "call", type: "agent_call", title: "深层协作", agentCall: { targetAgentId: "agent-b", versionId: "version-b" } })));
    const deep = { ...dependency(), agentId: "agent-b", versionId: "version-b", agentName: "深层查询助手" };
    const versions = [child, deep];
    const graph = inspectCollaborationVersionGraph({ rootAgentId: "root-agent", directKeys: ["agent-a:version-a"], versions });
    expect(graph.issue).toBeNull();
    expect(graph.versionIds).toEqual(["version-a", "version-b"]);
    expect(collaborationToolRegistrationIssue(versions, graph.versionIds, () => null)).toContain("深层查询助手");
    expect(collaborationToolRegistrationIssue(versions, graph.versionIds, () => registration())).toBeNull();
  });

  it("协作工具的跨运行操作防重仍要求登记支持及保留期", () => {
    const work = WorkflowNode.parse({ ...tool(), toolOperation: { scope: "lookup", key: { kind: "literal", value: "fixture-operation" } } });
    const versions = [dependency(manifest(work))];
    expect(collaborationToolRegistrationIssue(versions, ["version-a"], () => registration())).toContain("跨运行操作防重");
    expect(collaborationToolRegistrationIssue(versions, ["version-a"], () => ({ ...registration(), businessIdempotency: true, businessIdempotencyRetentionMs: 60_000 }))).toBeNull();
  });

  it("协作错误不回显助手/步骤标题中的凭据或个人信息，也不回显服务端凭据", () => {
    const row = { ...dependency(manifest({ ...tool(), title: "finance@example.com" })), agentName: "Bearer fixture-name-private-123456" };
    const issue = collaborationToolRegistrationIssue([row], ["version-a"], () => ({ ...registration(), scope: "changed" }));
    expect(issue).toContain("已隐藏敏感信息");
    expect(issue).not.toMatch(/finance@example|fixture-name-private|fixture-registry-private|fixture.example/);
  });

  it("演示工具继续使用原规则，不要求生产工具登记或伪造真实连接", () => {
    const work = WorkflowNode.parse({ ...tool(), tool: { ...tool().tool!, protocol: "demo" } });
    const lookup = vi.fn(() => registration());
    expect(collaborationToolRegistrationIssue([dependency(manifest(work))], ["version-a"], lookup)).toBeNull();
    expect(lookup).not.toHaveBeenCalled();
  });
});
