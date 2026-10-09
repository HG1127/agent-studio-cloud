import { describe, expect, it } from "vitest";
import { WorkflowDraft, WorkflowNode } from "@/contracts/workflow";
import { AgentManifest } from "@/contracts/manifest";
import { resolveNodeInput } from "@/server/domain/runtime/input-mapping";
import { buildInlineOutputCatalog, readInlineOutput, selectInlineOutputReferences } from "@/server/domain/runtime/inline-output-references";
import { buildAgentCallInput } from "@/server/domain/runtime/agent-call-runtime";
import { buildHandoffInput } from "@/server/domain/runtime/handoff-runtime";
import { resolveKnowledgeQuery } from "@/server/domain/runtime/knowledge-query";
import { toolOperationKeyMaterial } from "@/server/domain/runtime/tool-operation";

const draft = WorkflowDraft.parse({ id: "frozen", startNodeId: "start", rootAgent: { id: "agent", name: "业务助手", role: "处理" }, memoryPolicy: { taskContext: true, longTerm: false }, nodes: {
  start: { id: "start", title: "开始", type: "trigger", next: "group" },
  group: { id: "group", title: "顺序处理", type: "subflow", subflow: { name: "处理", steps: [
    { id: "extract.part", title: "同名步骤", type: "ai" }, { id: "extract.last", title: "同名步骤", type: "ai" }, { id: "remember", title: "经验", type: "memory", memory: { mode: "read" } },
  ] } },
  batch: { id: "batch", title: "并行处理", type: "parallel", parallel: { strategy: "all", failurePolicy: "continue", branches: [
    { id: "research.part", label: "研究", steps: [{ id: "extract.last", title: "提取", type: "ai" }] },
    { id: "record", label: "记录", steps: [{ id: "note", title: "记录", type: "system" }] },
  ] } },
  forged: { id: "forged", title: "模型对象不是容器", type: "ai" },
  done: { id: "done", title: "结束", type: "end" },
} });
const catalog = buildInlineOutputCatalog(draft);
const target = AgentManifest.parse({ schemaVersion: "4.0", workflowFingerprint: "frozen", inputContract: { fields: [] }, resourceSelection: { model: { modelId: "mock", mock: true } }, designAudit: { status: "passed", issueCount: 0, criticalCount: 0 }, workflowSnapshot: draft });

const node = (source: string) => WorkflowNode.parse({
  id: "consume", title: "接收内部业务成果", type: "ai",
  inputMapping: { fields: [{ target: ["amount"], source: { kind: "output", nodeId: source, path: ["rows", "0", "amount"] } }] },
});

describe("已完成容器的内部步骤成果映射", () => {
  it("来源来自冻结图，完整标识不拆点，不按重复标题猜步骤", () => {
    expect(catalog["group.extract.last"]).toEqual({ kind: "subflow", ownerNodeId: "group", stepIndex: 1 });
    expect(catalog["batch.research.part.extract.last"]).toEqual({ kind: "parallel", ownerNodeId: "batch", branchId: "research.part" });
    expect(readInlineOutput("group.extract.last", { group: { status: "completed", steps: [{ title: "同名步骤", output: 99 }, { title: "同名步骤", output: 0 }] } }, catalog)).toBe(0);
    expect(catalog).not.toHaveProperty("forged.extract");
  });

  it("只传本节点选择的定位，防重键也纳入，当前容器定位全部排除", () => {
    const consumer = WorkflowNode.parse({ id: "consume", title: "业务操作", type: "tool", inputMapping: { fields: [
      { target: ["first"], source: { kind: "output", nodeId: "group.extract.part" } },
      { target: ["other"], source: { kind: "output", nodeId: "batch.research.part.extract.last" } },
    ] }, toolOperation: { scope: "create", key: { kind: "output", nodeId: "group.remember", path: ["id"] } } });
    expect(Object.keys(selectInlineOutputReferences(catalog, consumer))).toEqual(["group.extract.part", "batch.research.part.extract.last", "group.remember"]);
    expect(Object.keys(selectInlineOutputReferences(catalog, consumer, "group"))).toEqual(["batch.research.part.extract.last"]);
  });

  it("不扫描模型伪造的容器，也不从未声明来源推断路径", () => {
    const outputs = { forged: { status: "completed", steps: [{ output: { rows: [{ amount: 99 }] } }] } };
    expect(resolveNodeInput({ node: node("forged.extract"), input: {}, outputs, inlineReferences: selectInlineOutputReferences(catalog, node("forged.extract")) })).toMatchObject({ ok: false });
    expect(resolveNodeInput({ node: node("forged.extract"), input: {}, outputs })).toMatchObject({ ok: false });
  });

  it("本次平铺成果优先，明确缺失不能借用旧汇总", () => {
    const inlineReferences = { "group.extract": { kind: "subflow" as const, ownerNodeId: "group", stepIndex: 0 } };
    const group = { status: "completed", steps: [{ output: { rows: [{ amount: 99 }] } }] };
    expect(resolveNodeInput({ node: node("group.extract"), input: {}, outputs: { group, "group.extract": { rows: [{ amount: 0 }] } }, inlineReferences })).toMatchObject({ ok: true, input: { amount: 0 } });
    expect(resolveNodeInput({ node: node("group.extract"), input: {}, outputs: { group, "group.extract": undefined }, inlineReferences })).toMatchObject({ ok: false });
    const current = node("group.extract.part");
    expect(resolveNodeInput({ node: current, input: {}, outputs: { group }, inlineReferences: selectInlineOutputReferences(catalog, current, "group") })).toMatchObject({ ok: false });
  });

  it.each(["failed", "running", "queued"])("%s 顺序汇总不能提供成功业务成果", (status) => {
    expect(readInlineOutput("group.extract.part", { group: { status, steps: [{ output: "old" }] } }, catalog)).toBeUndefined();
  });

  it.each(["failed", "running"])("%s 并行汇总和失败分支不能提供业务成果", (status) => {
    const branch = { status: "completed", outputs: { "batch.research.part.extract.last": 99 } };
    expect(readInlineOutput("batch.research.part.extract.last", { batch: { status, branches: { "research.part": branch } } }, catalog)).toBeUndefined();
    expect(readInlineOutput("batch.research.part.extract.last", { batch: { status: "completed_with_issues", branches: { "research.part": { ...branch, status } } } }, catalog)).toBeUndefined();
  });

  it("不读继承的汇总、分支或成果，也不修改已冻结输入", () => {
    const outputs = Object.freeze({ group: Object.freeze({ status: "completed", steps: Object.freeze([{ output: Object.freeze({ rows: [{ amount: 0 }] }) }]) }) });
    expect(readInlineOutput("group.extract.part", Object.create(outputs), catalog)).toBeUndefined();
    expect(resolveNodeInput({ node: node("group.extract.part"), input: Object.freeze({}), outputs, inlineReferences: selectInlineOutputReferences(catalog, node("group.extract.part")) })).toMatchObject({ ok: true, input: { amount: 0 } });
    expect(readInlineOutput("batch.research.part.extract.last", { batch: { status: "completed", branches: Object.create({ "research.part": { status: "completed", outputs: { "batch.research.part.extract.last": 1 } } }) } }, catalog)).toBeUndefined();
  });

  it("不会把来源定位或内部成果平铺到保留的上下文", () => {
    const consumer = WorkflowNode.parse({ ...node("group.extract.part"), inputMapping: { ...node("group.extract.part").inputMapping, includeUpstreamOutputs: true } });
    const outputs = { group: { status: "completed", steps: [{ output: { rows: [{ amount: false }] } }] } };
    expect(resolveNodeInput({ node: consumer, input: {}, outputs, inlineReferences: selectInlineOutputReferences(catalog, consumer) })).toEqual({ ok: true, input: { amount: false }, outputs });
    expect(Object.keys(outputs)).toEqual(["group"]);
  });

  it("显式兜底与可选缺失规则不变，不读失败容器中的半成品", () => {
    const consumer = WorkflowNode.parse({ ...node("group.extract.part"), inputMapping: { fields: [
      { target: ["amount"], source: { kind: "output", nodeId: "group.extract.part", path: ["rows", "0", "amount"] }, fallback: 0 },
      { target: ["optional"], source: { kind: "output", nodeId: "group.extract.last" }, required: false },
    ] } });
    expect(resolveNodeInput({ node: consumer, input: {}, outputs: { group: { status: "failed", steps: [{ output: { rows: [{ amount: 99 }] } }] } }, inlineReferences: selectInlineOutputReferences(catalog, consumer) })).toEqual({ ok: true, input: { amount: 0 }, outputs: {} });
  });

  it("知识仍拒绝已识别凭据，映射不替换固定查询或扩大范围", () => {
    const lookup = WorkflowNode.parse({ id: "lookup", title: "查询", type: "knowledge", knowledge: { space: "资料", query: "不能回退" }, inputMapping: { fields: [{ target: ["query"], source: { kind: "output", nodeId: "group.extract.part", path: ["topic"] } }] } });
    const inlineReferences = selectInlineOutputReferences(catalog, lookup);
    expect(resolveKnowledgeQuery({ node: lookup, input: {}, outputs: { group: { status: "completed", steps: [{ output: { topic: "退货政策" } }] } }, inlineReferences })).toEqual({ ok: true, query: "退货政策" });
    expect(resolveKnowledgeQuery({ node: lookup, input: {}, outputs: { group: { status: "completed", steps: [{ output: { topic: "Bearer selected-secret" } }] } }, inlineReferences })).toMatchObject({ ok: false, error: expect.not.stringContaining("selected-secret") });
  });

  it("跨层业务防重标识保留前导零，与普通来源生成同一材料", () => {
    const args = { workspaceId: "work", toolId: "orders", action: "create", input: {}, outputs: { group: { status: "completed", steps: [{ output: { id: "001" } }] } } };
    const node = WorkflowNode.parse({ id: "record", title: "登记", type: "tool", toolOperation: { scope: "order", key: { kind: "output", nodeId: "group.extract.part", path: ["id"] } } });
    expect(toolOperationKeyMaterial({ ...args, node, inlineReferences: selectInlineOutputReferences(catalog, node) })).toEqual({ ok: true, material: JSON.stringify(["work", "orders", "create", "order", "001"]) });
  });

  it.each(["agent_call", "handoff"] as const)("%s 的来源定位不能绕过经验共享和脱敏", (type) => {
    const make = (mode: "none" | "team") => WorkflowNode.parse({ id: "call", title: "协作", type,
      agentCall: { targetAgentId: "target", versionId: "version", memoryAccess: { mode } },
      toAgent: { id: "target", versionId: "version" }, contract: { memoryPolicy: { mode } },
      inputMapping: { fields: [{ target: ["brief"], source: { kind: "output", nodeId: "group.remember", path: ["memories", "0", "content"] } }] },
    });
    const outputs = { group: { status: "completed", steps: [{ output: {} }, { output: {} }, { output: { mode: "read", memories: [{ content: "团队经验" }] } }] } };
    const run = (node: WorkflowNode) => (type === "agent_call" ? buildAgentCallInput : buildHandoffInput)({ node, targetManifest: target, input: {}, outputs, inlineReferences: selectInlineOutputReferences(catalog, node) });
    expect(run(make("none"))).toMatchObject({ ok: false });
    expect(run(make("team"))).toMatchObject({ ok: true, input: { brief: "团队经验" } });
  });

  it("无效容器配置不生成可信定位", () => {
    expect(buildInlineOutputCatalog({ nodes: { bad: WorkflowNode.parse({ id: "bad", title: "无配置", type: "subflow" }) } })).toEqual({});
  });
  it("从顺序子流程的冻结位置读取零金额，不复制汇总成果", () => {
    const outputs = { group: { status: "completed", steps: [{ title: "提取", output: { rows: [{ amount: 0 }] } }] } };
    expect(resolveNodeInput({ node: node("group.extract"), input: {}, outputs,
      inlineReferences: { "group.extract": { kind: "subflow", ownerNodeId: "group", stepIndex: 0 } },
    })).toEqual({ ok: true, input: { amount: 0 }, outputs: {} });
    expect(Object.keys(outputs)).toEqual(["group"]);
  });

  it.each(["completed", "completed_with_issues"])("从 %s 并行汇总中的成功分支读取成果", (status) => {
    const outputs = { batch: { status, branches: { research: { status: "completed", outputs: { "batch.research.extract": { rows: [{ amount: 19 }] } } } } } };
    expect(resolveNodeInput({ node: node("batch.research.extract"), input: {}, outputs,
      inlineReferences: { "batch.research.extract": { kind: "parallel", ownerNodeId: "batch", branchId: "research" } },
    })).toEqual({ ok: true, input: { amount: 19 }, outputs: {} });
  });
});
