import { describe, expect, it, vi } from "vitest";
import { AgentManifest } from "@/contracts/manifest";
import { MAX_WORKFLOW_BYTES } from "@/contracts/workflow";
import { frozenResourceBindingsView } from "@/features/versions/frozen-resource-bindings";
import { frozenResourceManifest, RESOURCE_CONNECTION, RESOURCE_MODEL, RESOURCE_SOURCE_A, RESOURCE_SOURCE_B, RESOURCE_TOOL } from "../fixtures/frozen-resource-bindings";

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected fixture object");
  return value as Record<string, unknown>;
}
function raw() { return record(frozenResourceManifest()); }
function nodes(snapshot: Record<string, unknown>) { return record(record(snapshot.workflowSnapshot).nodes); }
function node(snapshot: Record<string, unknown>, id: string) { return record(nodes(snapshot)[id]); }
function inline(snapshot: Record<string, unknown>) {
  return record((record(node(snapshot, "group_step").subflow).steps as unknown[])[0]);
}
function branches(snapshot: Record<string, unknown>) {
  return record(node(snapshot, "parallel_step").parallel).branches as Array<Record<string, unknown>>;
}
function view(snapshot: unknown) { return frozenResourceBindingsView(snapshot, { originalSnapshotComplete: true }); }
function detail(snapshot: unknown, name: string) {
  const row = view(snapshot).steps.find((item) => item.name === name);
  if (!row) throw new Error("Expected fixture row");
  return row;
}
function freeze(value: unknown) {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
}

describe("冻结资源声明只读解释", () => {
  it("仅在完整原快照中按标识对应资料，顶层与内嵌引用都指向真实所属步骤", () => {
    const snapshot = raw();
    expect(AgentManifest.safeParse(snapshot).success).toBe(true);
    const result = view(snapshot);
    expect(result.state).toBe("available");
    expect(result.steps).toHaveLength(8);
    expect(detail(snapshot, "查询办理资料").bindings[0].details).toContain("引用第 1 项：对应资料声明第 1 项；历史资料名称未保存。");
    expect(detail(snapshot, "组内查询").ownerNodeId).toBe("group_step");
    expect(detail(snapshot, "组内工具").ownerNodeId).toBe("parallel_step");
    expect(detail(snapshot, "组内答复").bindings[0].kind).toBe("模型");
  });

  it("未证明完整性时，即使契约可解析也不把局部对象当成完整资源范围", () => {
    const result = frozenResourceBindingsView(raw(), { originalSnapshotComplete: false });
    expect(result.state).toBe("unknown");
    expect(result.knowledge).toBeNull();
    expect(result.unknownFieldCount).toBeNull();
    expect(result.steps).toEqual([]);
    expect(result.notice).toContain("完整原快照");
  });

  it("区分原字段缺失与显式空列表、false 和 null，不把契约默认值记为历史选择", () => {
    const snapshot = raw();
    delete snapshot.knowledgeSnapshot;
    const missing = view(snapshot);
    expect(missing.knowledge?.description).toContain("不能当作历史明确选择了 0 项");
    expect(missing.model?.mock).toContain("原字段未保存");
    expect(missing.model?.connection).toContain("原字段未保存");
    expect(detail(snapshot, "查询办理资料").bindings[0].details.join(" ")).toContain("版本未保存资料声明列表");
    snapshot.knowledgeSnapshot = [];
    const model = record(record(snapshot.resourceSelection).model);
    model.mock = false;
    model.connectionId = null;
    record(node(snapshot, "knowledge_step").knowledge).sourceIds = [];
    const explicit = view(snapshot);
    expect(explicit.model?.mock).toBe("原字段记录：未启用模拟模式。");
    expect(explicit.model?.connection).toBe("连接原字段明确未指定已保存连接。");
    expect(explicit.knowledge?.description).toContain("明确保存了 0 项");
    expect(detail(snapshot, "查询办理资料").bindings[0].details).toContain("原步骤明确保存了 0 项资料引用。");
    expect(detail(snapshot, "查询办理资料").bindings[0].details).toContain("原字段记录：不要求选择资料。");
  });

  it("模拟标记与连接引用各按原字段显示，不推断连接配置或实际模型调用", () => {
    const snapshot = raw();
    const model = record(record(snapshot.resourceSelection).model);
    model.mock = true;
    model.connectionId = RESOURCE_CONNECTION;
    expect(view(snapshot).model?.mock).toBe("原字段记录：启用模拟模式。");
    expect(view(snapshot).model?.connection).toContain("历史连接名称和配置未保存");
    model.modelId = "";
    expect(view(snapshot).model?.selection).toContain("所选模型未知");
    expect(detail(snapshot, "整理答复").bindings[0].details.join(" ")).toContain("标识为空");
  });

  it("资料匹配不依靠名称、大小写归一或旧字段中的现时目录", () => {
    const snapshot = raw();
    snapshot.knowledgeSnapshot = [RESOURCE_SOURCE_B];
    snapshot.knowledgeNames = { [RESOURCE_SOURCE_A]: "现时文件名" };
    expect(detail(snapshot, "查询办理资料").bindings[0].details.join(" ")).toContain("未找到该版本中的资料声明");
    expect(JSON.stringify(view(snapshot))).not.toContain("现时文件名");
    const mixedCase = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    snapshot.knowledgeSnapshot = [mixedCase.toUpperCase()];
    record(node(snapshot, "knowledge_step").knowledge).sourceIds = [mixedCase];
    expect(detail(snapshot, "查询办理资料").bindings[0].details.join(" ")).toContain("未找到该版本中的资料声明");
  });

  it("保留重复声明和重复引用，不能选择第一项或悄悄去重", () => {
    const snapshot = raw();
    snapshot.knowledgeSnapshot = [RESOURCE_SOURCE_A, RESOURCE_SOURCE_A];
    record(node(snapshot, "knowledge_step").knowledge).sourceIds = [RESOURCE_SOURCE_A, RESOURCE_SOURCE_A];
    const result = view(snapshot);
    expect(result.knowledge?.items).toHaveLength(2);
    expect(result.knowledge?.items.every((item) => item.repeated === 2)).toBe(true);
    const details = detail(snapshot, "查询办理资料").bindings[0].details;
    expect(details.filter((item) => item.includes("无法唯一对应"))).toHaveLength(2);
    expect(details.filter((item) => item.includes("此项引用在原步骤中重复"))).toHaveLength(2);
    expect(JSON.stringify(snapshot)).toContain(RESOURCE_SOURCE_A);
  });

  it("未保存步骤资料引用列表时保持未知，不能补为 0 项", () => {
    const snapshot = raw();
    const knowledge = record(node(snapshot, "knowledge_step").knowledge);
    delete knowledge.sourceIds;
    delete knowledge.selectionRequired;
    expect(detail(snapshot, "查询办理资料").bindings[0].details).toContain("原步骤未保存资料引用列表，绑定范围未知。");
    expect(detail(snapshot, "查询办理资料").bindings[0].details).toContain("原步骤未保存是否要求选择资料。");
  });

  it("工具引用缺失、显式 null、空值、已保存值和默认来源分别可辨", () => {
    const snapshot = raw();
    const tool = record(node(snapshot, "tool_step").tool);
    delete tool.registryToolId;
    let details = detail(snapshot, "查询办理进度").bindings[0].details;
    expect(details.join(" ")).toContain("工具引用原字段未保存");
    expect(details.join(" ")).toContain("契约默认最多重试 3 次");
    expect(details.join(" ")).toContain("契约默认对象结构");
    expect(details.join(" ")).toContain("未标为待补齐");
    tool.registryToolId = null;
    expect(detail(snapshot, "查询办理进度").bindings[0].details.join(" ")).toContain("明确未指定目录工具");
    tool.registryToolId = "";
    expect(detail(snapshot, "查询办理进度").bindings[0].details.join(" ")).toContain("原字段为空");
    tool.registryToolId = RESOURCE_TOOL;
    delete tool.unresolved;
    details = detail(snapshot, "查询办理进度").bindings[0].details;
    expect(details.join(" ")).toContain("无法对应历史工具名称和定义");
    expect(details).toContain("原声明未保存待补齐标记。");
  });

  it("旧版工具快照或额外名称字段只记额外字段，不构造当前契约没有的历史目录", () => {
    const snapshot = raw();
    snapshot.toolSnapshots = [{ id: RESOURCE_TOOL, title: "旧版工具名称", apiKey: "sk-legacy-private-1234567890" }];
    record(snapshot.resourceSelection).items = [{ kind: "tool", title: "额外名称", id: RESOURCE_TOOL }];
    const result = view(snapshot);
    expect(result.unknownFieldCount).toBe(2);
    expect(result.tools).toContain("契约未保存工具目录快照");
    expect(JSON.stringify(result)).not.toMatch(/旧版工具名称|额外名称|sk-legacy/);
  });

  it("不对父层已保存字段、未知字段、零值、false 或缺省字段作任何写回", () => {
    const snapshot = raw();
    snapshot.extra = { zero: 0, flag: false, nested: { token: "secret-preserve-original" } };
    record(record(snapshot.resourceSelection).model).future = { enabled: false };
    record(node(snapshot, "tool_step").tool).future = 0;
    record(inline(snapshot).knowledge).future = false;
    inline(snapshot).future = "inline-extra";
    record(node(snapshot, "group_step").subflow).future = 0;
    record(node(snapshot, "parallel_step").parallel).future = false;
    branches(snapshot)[0].future = 0;
    const before = JSON.stringify(snapshot);
    freeze(snapshot);
    const result = view(snapshot);
    expect(result.state).toBe("available");
    expect(result.unknownFieldCount).toBe(8);
    expect(JSON.stringify(snapshot)).toBe(before);
    expect(record(record(snapshot.resourceSelection).model)).not.toHaveProperty("mock");
    expect(record(record(snapshot.resourceSelection).model)).not.toHaveProperty("connectionId");
    expect(JSON.stringify(result)).not.toContain("secret-preserve-original");
  });

  it("内嵌步骤缺失、数字或重复标识时不采用运行层生成标识定位", () => {
    const snapshot = raw();
    const first = inline(snapshot);
    delete first.id;
    expect(detail(snapshot, "组内查询").ownerNodeId).toBeNull();
    expect(detail(snapshot, "组内查询").warnings.join(" ")).toContain("不使用运行层生成");
    first.id = 5;
    expect(detail(snapshot, "组内查询").ownerNodeId).toBeNull();
    first.id = "duplicate";
    const group = record(node(snapshot, "group_step").subflow);
    (group.steps as unknown[]).push({ ...first, title: "重复标识的步骤" });
    expect(detail(snapshot, "组内查询").ownerNodeId).toBeNull();
    expect(detail(snapshot, "重复标识的步骤").ownerNodeId).toBeNull();
    expect(detail(snapshot, "组内查询").warnings.join(" ")).toContain("标识重复");
  });

  it("内嵌名称未保存时显示缺失，不套用运行层的默认名称或类型", () => {
    const snapshot = raw();
    delete inline(snapshot).title;
    delete inline(snapshot).type;
    const result = view(snapshot);
    const missing = result.steps.find((row) => row.name === "未保存可显示的步骤名称");
    expect(missing?.ownerNodeId).toBeNull();
    expect(missing?.warnings.join(" ")).toContain("未补齐缺失字段");
    expect(JSON.stringify(result)).not.toContain("子步骤 1");
    expect(JSON.stringify(snapshot)).not.toContain("step_1");
  });

  it("并行工作标识重复与拼接冲突均不提供受影响内嵌定位", () => {
    const snapshot = raw();
    const branch = branches(snapshot);
    branch[1].id = branch[0].id;
    expect(detail(snapshot, "组内工具").ownerNodeId).toBeNull();
    expect(detail(snapshot, "组内答复").ownerNodeId).toBeNull();
    branch[0].id = "a.b";
    branch[1].id = "a";
    record((branch[0].steps as unknown[])[0]).id = "c";
    record((branch[1].steps as unknown[])[0]).id = "b.c";
    expect(detail(snapshot, "组内工具").warnings.join(" ")).toContain("组合冲突");
    expect(detail(snapshot, "组内工具").ownerNodeId).toBeNull();
    expect(detail(snapshot, "组内答复").ownerNodeId).toBeNull();
  });

  it("名称重复不造成合并或按名称定位，仍按唯一保存标识返回真实所属步骤", () => {
    const snapshot = raw();
    node(snapshot, "ai_step").title = node(snapshot, "tool_step").title;
    const result = view(snapshot);
    const repeated = result.steps.filter((row) => row.name === "查询办理进度");
    expect(repeated).toHaveLength(2);
    expect(repeated.map((row) => row.ownerNodeId)).toEqual(["tool_step", "ai_step"]);
    expect(repeated.every((row) => row.warnings.join(" ").includes("名称重复"))).toBe(true);
  });

  it("内嵌 contract 里的额外工具字段不被当作外层工具绑定", () => {
    const snapshot = raw();
    inline(snapshot).contract = { tool: { registryToolId: RESOURCE_TOOL } };
    const row = detail(snapshot, "组内查询");
    expect(row.bindings.map((binding) => binding.kind)).toEqual(["资料"]);
    expect(view(snapshot).unknownFieldCount).toBe(1);
    expect(record(inline(snapshot).contract)).toHaveProperty("tool");
  });

  it("不支持的嵌套类型、非法内嵌工具或父类型不一致时不宣称有效执行归属", () => {
    const snapshot = raw();
    inline(snapshot).type = "subflow";
    expect(detail(snapshot, "组内查询").ownerNodeId).toBeNull();
    expect(detail(snapshot, "组内查询").warnings.join(" ")).toContain("未继续展开嵌套");
    node(snapshot, "group_step").type = "system";
    expect(detail(snapshot, "组内查询").warnings.join(" ")).toContain("所属步骤类型不一致");
    const tool = record((branches(snapshot)[0].steps as unknown[])[0]);
    record(tool.tool).scope = 2;
    expect(detail(snapshot, "组内工具").ownerNodeId).toBeNull();
    expect(detail(snapshot, "组内工具").bindings[0].details.join(" ")).toContain("不能按当前契约解释");
  });

  it("步骤类型需要的声明缺失时不从资源列表补造", () => {
    const snapshot = raw();
    delete node(snapshot, "knowledge_step").knowledge;
    delete node(snapshot, "tool_step").tool;
    expect(detail(snapshot, "查询办理资料").bindings[0].details).toEqual(["原步骤未保存资料声明。"]);
    expect(detail(snapshot, "查询办理进度").bindings[0].details).toEqual(["原步骤未保存工具声明。"]);
  });

  it("只读视图中不携带资源标识或敏感内容，名称里的标识和凭据也先被隐藏", () => {
    const snapshot = raw();
    record(record(snapshot.resourceSelection).model).connectionId = RESOURCE_CONNECTION;
    node(snapshot, "knowledge_step").title = "办理 " + RESOURCE_SOURCE_A + " 密钥：abcdefghi-private";
    record(node(snapshot, "knowledge_step").knowledge).space = "归档 " + RESOURCE_MODEL + " " + RESOURCE_TOOL;
    snapshot.extraCredential = { token: "unlabeled-private-credential" };
    node(snapshot, "ai_step").title = "答复 unlabeled-private-credential";
    const result = view(snapshot);
    const serialized = JSON.stringify(result);
    for (const secret of [RESOURCE_SOURCE_A, RESOURCE_CONNECTION, RESOURCE_MODEL, RESOURCE_TOOL, "abcdefghi-private", "connector-private", "action-private", "unlabeled-private-credential"]) {
      expect(serialized).not.toContain(secret);
    }
    expect(result.steps[0].name).toContain("已隐藏");
    expect(result.steps[0].ownerNodeId).toBe("knowledge_step");
  });

  it("无效完整契约、访问器、循环及超限原字段均保持未知，并且不调用访问器", () => {
    const invalid = raw();
    node(invalid, "ai_step").id = "mismatch";
    expect(view(invalid).state).toBe("unknown");
    const getter = vi.fn(() => "private");
    const accessor = raw();
    Object.defineProperty(accessor, "unsafe", { enumerable: true, get: getter });
    expect(view(accessor).state).toBe("unknown");
    expect(getter).not.toHaveBeenCalled();
    const circular = raw();
    circular.extra = circular;
    expect(view(circular).state).toBe("unknown");
    const oversized = raw();
    record(oversized.workflowSnapshot).extra = "中".repeat(Math.ceil(MAX_WORKFLOW_BYTES / 3));
    expect(view(oversized).state).toBe("unknown");
    const manifestOversized = raw();
    manifestOversized.extra = "x".repeat(2 * MAX_WORKFLOW_BYTES);
    expect(view(manifestOversized).state).toBe("unknown");
  });
});
