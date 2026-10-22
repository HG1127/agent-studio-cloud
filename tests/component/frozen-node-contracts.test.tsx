import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InputMapping } from "@/contracts/input-mapping";
import { ModelOutputConfig } from "@/contracts/model-output";
import { WorkflowDraft, WorkflowNode } from "@/contracts/workflow";
import { buildInlineOutputCatalog } from "@/server/domain/runtime/inline-output-references";
import { FrozenNodeContracts } from "@/features/versions/FrozenNodeContracts";

const base = WorkflowNode.parse({ id: "private-target", title: "冻结接收步骤", type: "ai" });
const model = ModelOutputConfig.parse({ format: "json", schema: { type: "object" }, providerMode: "json-schema", maxRepairAttempts: 2, mockOutput: { 数量: 0, 通过: false, 补充: null, 备注: "" } });
const draft = WorkflowDraft.parse({
  id: "private-workflow", versionId: "private-version", rootAgent: { id: "private-agent", name: "冻结助手", role: "助手" }, memoryPolicy: { taskContext: true, longTerm: false },
  nodes: {
    "private-source": { id: "private-source", title: "核对原材料", type: "ai" },
    "private-group": { id: "private-group", title: "整理证据", type: "subflow", subflow: { name: "资料核对组", steps: [{ id: "private-first", title: "提取金额", type: "ai" }, { title: "复核金额", type: "ai" }] } },
    "private-parallel": { id: "private-parallel", title: "联合核对", type: "parallel", parallel: { strategy: "all", failurePolicy: "fail_fast", branches: [
      { id: "private-buy", label: "采购核对", steps: [{ id: "private-shared", title: "核对采购数量", type: "ai" }] },
      { id: "private-finance", label: "财务核对", steps: [{ id: "private-shared", title: "核对财务金额", type: "ai" }] },
    ] } },
    "private-target": base,
  },
});
function legacy(changes: Record<string, unknown>): WorkflowNode { return { ...base, ...changes } as unknown as WorkflowNode; }
function withSources(ids: string[]) {
  return WorkflowNode.parse({ ...base, inputMapping: { fields: ids.map((nodeId, index) => ({ target: ["接收", "字段" + index], source: { kind: "output", nodeId, path: ["原.字段", "数值"] } })) } });
}
afterEach(() => { vi.restoreAllMocks(); });

describe("冻结步骤字段约定只读核对", () => {
  it("未保存时不造约定，没有编辑、试算、保存或运行控件", () => {
    const network = vi.spyOn(globalThis, "fetch"), storage = vi.spyOn(Storage.prototype, "setItem");
    const { container } = render(<FrozenNodeContracts node={base} />);
    expect(screen.getByText("未保存模型结果字段约定，不补造规则或模拟样例。")).toBeVisible();
    expect(screen.getByText("未保存输入映射，不补造来源或接收字段。")).toBeVisible();
    expect(container.querySelector("input,select,textarea,button")).toBeNull();
    expect(container.textContent).not.toContain("private-target");
    expect(network).not.toHaveBeenCalled(); expect(storage).not.toHaveBeenCalled();
  });

  it("展示实际原规则、请求方式、两次修正和开发者模拟边界，原零否空值不被替换", () => {
    const node = { ...base, modelOutput: model }; const before = JSON.stringify(node);
    const { container } = render(<FrozenNodeContracts node={node} />);
    expect(screen.getByText("向模型服务提交字段规则")).toBeVisible();
    expect(screen.getByText("最多额外修正2次")).toBeVisible();
    const schema = screen.getByLabelText("原模型字段规则");
    expect(JSON.parse(schema.textContent!)).toEqual(model.schema);
    const sample = screen.getByLabelText("原模型模拟样例");
    expect(JSON.parse(sample.textContent!)).toEqual(model.mockOutput);
    fireEvent.click(screen.getByText("开发者测试区：原模拟样例"));
    expect(screen.getByText(/仅后端模拟模式采用此样例/)).toBeVisible();
    expect(screen.getByText(/不证明业务质量/)).toBeVisible();
    expect(JSON.stringify(node)).toBe(before);
    expect(container.querySelector("input,select,textarea,button")).toBeNull();
  });

  it("显式零次与普通对象请求原样展示，不把零当缺失", () => {
    render(<FrozenNodeContracts node={{ ...base, modelOutput: { ...model, providerMode: "json", maxRepairAttempts: 0 } }} />);
    expect(screen.getByText("按对象格式请求")).toBeVisible();
    expect(screen.getByText("不作额外格式修正")).toBeVisible();
    expect(screen.queryByText(/未保存额外修正次数/)).not.toBeInTheDocument();
  });

  it("未知模型键和省略的模式/次数保留，解析默认值不冒充原定义", () => {
    const raw = { format: "json", schema: { type: "object", properties: { 数量: { type: "number", enum: [0, 8] }, 通过: { type: "boolean", enum: [false, true] } } }, futureSetting: { nodeId: "private-unknown-id" } };
    const node = legacy({ modelOutput: raw }), before = JSON.stringify(node);
    const { container } = render(<FrozenNodeContracts node={node} />);
    expect(screen.getByText(/原约定含未知/)).toBeVisible();
    expect(screen.getByText("未保存请求方式，不以默认方式替代原定义")).toBeVisible();
    expect(screen.getByText("未保存额外修正次数，不补写默认次数")).toBeVisible();
    expect(JSON.parse(screen.getByLabelText("原模型字段规则").textContent!)).toEqual(raw.schema);
    expect(JSON.stringify(node)).toBe(before);
    expect(container.textContent).not.toContain("private-unknown-id");
  });

  it.each(["tool", "human"])("%s上的原模型配置只读提示不适用，仍保留原规则", (type) => {
    const node = legacy({ type, modelOutput: model }), before = JSON.stringify(node);
    render(<FrozenNodeContracts node={node} />);
    expect(screen.getByText(/原约定含未知、不适用/)).toBeVisible();
    expect(JSON.parse(screen.getByLabelText("原模型字段规则").textContent!)).toEqual(model.schema);
    expect(JSON.stringify(node)).toBe(before);
  });

  it("损坏模式/次数不回填默认，模拟样例与规则不一致也只读提示", () => {
    const node = legacy({ modelOutput: { format: "other-private-format", providerMode: "other-private-mode", maxRepairAttempts: 99, schema: { type: "object", required: ["数量"] }, mockOutput: { 通过: false } } });
    const { container } = render(<FrozenNodeContracts node={node} />);
    expect(screen.getByText("原格式无法识别，保留原定义")).toBeVisible();
    expect(screen.getByText("原请求方式无法识别，保留原定义")).toBeVisible();
    expect(screen.getByText("原修正上限无法识别，保留原定义")).toBeVisible();
    expect(container.textContent).not.toContain("other-private");
    expect(JSON.parse(screen.getByLabelText("原模型模拟样例").textContent!)).toEqual({ 通过: false });
  });

  it.each([0, false, null, ""])("固定来源保留原值 %j，同时保留原目标分段", (value) => {
    const mapping = InputMapping.parse({ fields: [{ target: ["接收.字段", "子项"], source: { kind: "literal", value }, required: false }] });
    const node = { ...base, inputMapping: mapping }, before = JSON.stringify(node);
    render(<FrozenNodeContracts node={node} />);
    expect(JSON.parse(screen.getByLabelText("固定值原值").textContent!)).toEqual(value);
    expect(JSON.parse(screen.getByLabelText("原映射目标层级").textContent!)).toEqual(["接收.字段", "子项"]);
    expect(screen.getByText("原设置允许缺失")).toBeVisible();
    expect(JSON.stringify(node)).toBe(before);
  });

  it("原输入完整来源与分段来源分开，缺失固定值的零否空值不合并", () => {
    const mapping = InputMapping.parse({ includeUpstreamOutputs: false, fields: [0, false, null, ""].map((fallback, i) => ({ target: ["字段" + i], source: { kind: "input", path: i ? ["第一.层", "第二层"] : [] }, fallback })) });
    render(<FrozenNodeContracts node={{ ...base, inputMapping: mapping }} workflow={draft} />);
    expect(screen.getByText(/原设置取整个来源/)).toBeVisible();
    expect(screen.getAllByText(/取2层来源字段/)).toHaveLength(3);
    const values = screen.getAllByLabelText("来源缺失时的原固定值原值").map((el) => JSON.parse(el.textContent!));
    expect(values).toEqual([0, false, null, ""]);
    expect(screen.getAllByLabelText("原映射来源层级").map((el) => JSON.parse(el.textContent!))).toEqual([[], ["第一.层", "第二层"], ["第一.层", "第二层"], ["第一.层", "第二层"]]);
  });

  it("源字段、必需与成果设置省略时不显示解析默认值", () => {
    const mapping = { fields: [{ target: ["原字段"], source: { kind: "input" } }] };
    expect(InputMapping.safeParse(mapping).success).toBe(true);
    render(<FrozenNodeContracts node={legacy({ inputMapping: mapping })} />);
    expect(screen.getByText(/未保存来源字段层级/)).toBeVisible();
    expect(screen.getByText("未保存是否必须提供，不补写默认值")).toBeVisible();
    expect(screen.getByText(/未保存全部上游成果携带设置/)).toBeVisible();
    expect(screen.queryByLabelText("原映射来源层级")).not.toBeInTheDocument();
  });

  it("按实际准备规则定位顶层/步骤组/并行分支，重复步骤名称不混淆，界面不泄露内部关联", () => {
    const ids = ["private-source", "private-group.private-first", "private-group.step_2", "private-parallel.private-buy.private-shared", "private-parallel.private-finance.private-shared"];
    const catalog = buildInlineOutputCatalog(draft);
    expect(Object.keys(catalog)).toEqual(ids.slice(1));
    const node = withSources(ids), before = JSON.stringify({ node, draft });
    const { container } = render(<FrozenNodeContracts node={node} workflow={draft} />);
    expect(screen.getByText(/来源：顶层步骤：核对原材料/)).toBeVisible();
    expect(screen.getByText(/来源：步骤组：资料核对组 · 提取金额/)).toBeVisible();
    expect(screen.getByText(/来源：步骤组：资料核对组 · 复核金额/)).toBeVisible();
    expect(screen.getByText(/来源：并行步骤：联合核对 · 分支：采购核对 · 核对采购数量/)).toBeVisible();
    expect(screen.getByText(/来源：并行步骤：联合核对 · 分支：财务核对 · 核对财务金额/)).toBeVisible();
    for (const id of [...ids, draft.id, draft.versionId!, draft.rootAgent.id]) expect(container.textContent).not.toContain(id);
    expect(JSON.stringify({ node, draft })).toBe(before);
  });

  it("未提供流程、来源不存在或只给组内短标识，都明确不可定位而不猜测", () => {
    const node = withSources(["private-absent", "private-first"]);
    const { container, rerender } = render(<FrozenNodeContracts node={node} />);
    expect(screen.getAllByText(/未能在提供的冻结流程中定位来源/)).toHaveLength(2);
    rerender(<FrozenNodeContracts node={node} workflow={draft} />);
    expect(screen.getAllByText(/未能在提供的冻结流程中定位来源/)).toHaveLength(2);
    expect(container.textContent).not.toContain("private-absent");
    expect(container.textContent).not.toContain("private-first");
  });

  it("来源关联冲突时不任选一个，失效组配置不构造来源", () => {
    const duplicate = { ...draft, nodes: { ...draft.nodes, "private-group.private-first": WorkflowNode.parse({ id: "private-group.private-first", title: "冲突关联", type: "ai" }) } };
    const { rerender } = render(<FrozenNodeContracts node={withSources(["private-group.private-first"])} workflow={duplicate} />);
    expect(screen.getByText(/无法唯一定位来源/)).toBeVisible();
    const broken = { ...draft, nodes: { ...draft.nodes, "private-group": { ...draft.nodes["private-group"], subflow: { ...draft.nodes["private-group"].subflow!, steps: [{ id: "same", title: "第一项", type: "ai" }, { id: "same", title: "第二项", type: "ai" }] } } } };
    expect(buildInlineOutputCatalog(broken)).not.toHaveProperty("private-group.same");
    rerender(<FrozenNodeContracts node={withSources(["private-group.same"])} workflow={broken} />);
    expect(screen.getByText(/未能在提供的冻结流程中定位来源/)).toBeVisible();
  });

  it("组内未知模型字段和缺失默认项直接保留原定义，读不到的来源仍给明确提示", () => {
    const original = { format: "json", schema: { type: "object", properties: { 同意: { type: "boolean", enum: [false, true] } } }, mockOutput: { 同意: false }, futureSetting: "private-future" };
    const node = WorkflowNode.parse({ id: "private-inner-owner", title: "原步骤组", type: "subflow", subflow: { name: "保存的组", steps: [{ id: "private-inner", title: "保存的处理", type: "ai", modelOutput: original, inputMapping: { fields: [{ target: ["数据"], source: { kind: "output", nodeId: "private-missing-inner", path: [] } }] } }] } });
    const before = JSON.stringify(node);
    const { container } = render(<FrozenNodeContracts node={node} workflow={draft} />);
    fireEvent.click(screen.getByText(/保存的组 · 1项已保存步骤/));
    expect(screen.getByText(/原约定含未知/)).toBeVisible();
    expect(screen.getByText("未保存请求方式，不以默认方式替代原定义")).toBeVisible();
    expect(screen.getByText("未保存额外修正次数，不补写默认次数")).toBeVisible();
    expect(JSON.parse(screen.getByLabelText("原模型字段规则").textContent!)).toEqual(original.schema);
    expect(JSON.stringify(node)).toBe(before);
    for (const id of ["private-inner-owner", "private-inner", "private-missing-inner", "private-future"]) expect(container.textContent).not.toContain(id);
  });

  it("并行组直接核对各分支原规则，保留相同短步骤标识且不漏分支标识", () => {
    const node = WorkflowNode.parse({
      ...draft.nodes["private-parallel"],
      parallel: {
        ...draft.nodes["private-parallel"].parallel!,
        branches: draft.nodes["private-parallel"].parallel!.branches.map((branch, i) => ({
          ...branch,
          steps: [{
            ...branch.steps[0],
            modelOutput: { format: "json", schema: { type: "object", properties: { 原值: { enum: i ? [false] : [0] } } }, mockOutput: { 原值: i ? false : 0 } },
          }],
        })),
      },
    });
    const before = JSON.stringify(node);
    const { container } = render(<FrozenNodeContracts node={node} />);
    expect(screen.getAllByLabelText("原模型模拟样例").map((el) => JSON.parse(el.textContent!))).toEqual([{ 原值: 0 }, { 原值: false }]);
    expect(screen.getAllByText("未保存请求方式，不以默认方式替代原定义")).toHaveLength(2);
    expect(container.textContent).not.toContain("private-buy"); expect(container.textContent).not.toContain("private-finance");
    expect(JSON.stringify(node)).toBe(before);
  });

  it("未知或损坏映射与不适用节点只读保留，不抛错或伪造来源", () => {
    const raw = { includeUpstreamOutputs: true, future: { nodeId: "private-mapping-future" }, fields: [{ target: ["安全字段"], source: { kind: "unknown", nodeId: "private-hidden-source" } }] };
    const node = legacy({ type: "knowledge", inputMapping: raw }), before = JSON.stringify(node);
    const { container, rerender } = render(<FrozenNodeContracts node={node} />);
    expect(screen.getByText(/原输入映射含未知、不适用/)).toBeVisible();
    expect(screen.getByText(/第1项映射无法识别/)).toBeVisible();
    expect(container.textContent).not.toContain("private-");
    expect(JSON.stringify(node)).toBe(before);
    rerender(<FrozenNodeContracts node={legacy({ inputMapping: { fields: {} } })} />);
    expect(screen.getByText(/原定义未保存映射条目/)).toBeVisible();
    rerender(<FrozenNodeContracts node={legacy({ type: "subflow", subflow: { name: "损坏组", steps: {} } })} />);
    expect(screen.getByText(/原组结构不完整/)).toBeVisible();
  });

  it.each(["getter", "cycle", "nonfinite", "toJSON"])("%s不安全内容不读取/执行，原定义保留", (kind) => {
    const execute = vi.fn(() => "private-unsafe");
    const unsafe: Record<string, unknown> = {};
    if (kind === "getter") Object.defineProperty(unsafe, "schema", { enumerable: true, get: execute });
    if (kind === "cycle") unsafe.self = unsafe;
    if (kind === "nonfinite") unsafe.value = Infinity;
    if (kind === "toJSON") unsafe.toJSON = execute;
    const node = legacy({ modelOutput: unsafe });
    const { container } = render(<FrozenNodeContracts node={node} />);
    expect(screen.getByText(/步骤包含无法安全读取的内容/)).toBeVisible();
    expect(execute).not.toHaveBeenCalled(); expect(node.modelOutput).toBe(unsafe);
    expect(container.textContent).not.toContain("private-");
  });

  it("源快照不安全时不执行访问器，不补造可定位来源", () => {
    const execute = vi.fn(() => draft.nodes);
    const unsafe = { ...draft }; Object.defineProperty(unsafe, "nodes", { enumerable: true, get: execute });
    render(<FrozenNodeContracts node={withSources(["private-source"])} workflow={unsafe} />);
    expect(screen.getByText("提供的流程含无法安全核对的内容，保持只读，来源不作定位。")).toBeVisible();
    expect(screen.getByText(/未能在提供的冻结流程中定位来源/)).toBeVisible();
    expect(execute).not.toHaveBeenCalled();
  });

  it("原模拟样例和固定值展示隐藏敏感文本/已知标识，原值仍不改变", () => {
    const node = WorkflowNode.parse({ ...base, modelOutput: { ...model, mockOutput: { 数量: 0, apiKey: "sk-private-sensitive-example-2026", 联系: "a@example.com", 关联: "private-target" } }, inputMapping: { fields: [{ target: ["固定数据"], source: { kind: "literal", value: { 数量: 0, 通过: false, 密码: "private-password-value" } } }] } });
    const before = JSON.stringify(node); const { container } = render(<FrozenNodeContracts node={node} />);
    const sample = JSON.parse(screen.getByLabelText("原模型模拟样例").textContent!);
    expect(sample.数量).toBe(0); expect(sample.apiKey).toBe("[已隐藏敏感信息]"); expect(sample.联系).toBe("[已隐藏敏感信息]");
    const fixed = JSON.parse(screen.getByLabelText("固定值原值").textContent!); expect(fixed.通过).toBe(false);
    expect(container.textContent).not.toContain("private-password-value"); expect(container.textContent).not.toContain("private-target");
    expect(JSON.stringify(node)).toBe(before);
  });
});
