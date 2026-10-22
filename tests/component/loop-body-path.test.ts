import { describe, expect, it } from "vitest";
import { MAX_WORKFLOW_NODES, WorkflowNode, type WorkflowDraft } from "@/contracts/workflow";
import { loopBodyPath } from "@/features/workflow-canvas/loop-body-path";

const LOOP = "private_loop";
const FIRST = "private_first";
const SECOND = "private_second";
const EXIT = "private_exit";
function step(id: string, title: string, next: string | null = LOOP, overrides: Partial<WorkflowNode> = {}) {
  return WorkflowNode.parse({ id, title, type: "ai", next, ...overrides });
}
function graph(overrides: WorkflowDraft["nodes"] = {}): WorkflowDraft["nodes"] {
  return {
    [LOOP]: step(LOOP, "逐项核对资料", null, { type: "loop", loop: { collectionPath: "input.items", itemKey: "item", maxIterations: 10, bodyNext: FIRST, exitNext: EXIT } }),
    [FIRST]: step(FIRST, "读取本项资料", SECOND),
    [SECOND]: step(SECOND, "整理本项内容"),
    [EXIT]: step(EXIT, "循环后的汇总", null, { type: "end" }),
    ...overrides,
  };
}
function messageWithoutIds(nodes = graph()) {
  const result = loopBodyPath(LOOP, nodes);
  for (const id of [LOOP, FIRST, SECOND, EXIT, "private_missing", "private_wrong_id"]) expect(result.stop.message).not.toContain(id);
  return result;
}

describe("循环内定义的直接路径投影（作者规格，未执行）", () => {
  it("按保存的起点和直接后续顺序展开，回到循环只说明定义指回，不制造执行结果", () => {
    const nodes = graph(); const original = structuredClone(nodes);
    const result = messageWithoutIds(nodes);
    expect(result.steps).toEqual([{ nodeId: FIRST, title: "读取本项资料" }, { nodeId: SECOND, title: "整理本项内容" }]);
    expect(result.stop.kind).toBe("returned-loop");
    expect(result.stop.message).toContain("由实际运行决定");
    expect(result.stop.message).not.toMatch(/已执行|验收通过|全部完成/);
    expect(nodes).toEqual(original);
  });

  it("记录接到循环后的去向即停止，不将循环外步骤列为内部处理或视为列表已完成", () => {
    const result = messageWithoutIds(graph({ [SECOND]: step(SECOND, "整理本项内容", EXIT) }));
    expect(result.steps.map((entry) => entry.nodeId)).toEqual([FIRST, SECOND]);
    expect(result.stop.kind).toBe("exit-reached"); expect(result.stop.message).toContain("不据此判断");
  });

  it("非当前循环的回环不重复列出；起点直接回到自身单独提示", () => {
    expect(messageWithoutIds(graph({ [SECOND]: step(SECOND, "整理本项内容", FIRST) })).stop.kind).toBe("repeated");
    const nodes = graph(); nodes[LOOP] = { ...nodes[LOOP], loop: { ...nodes[LOOP].loop!, bodyNext: LOOP } };
    const self = messageWithoutIds(nodes);
    expect(self.steps).toEqual([]); expect(self.stop.kind).toBe("self-reference"); expect(self.stop.message).toContain("起点直接指回");
  });

  it.each(["condition", "loop", "human", "wait", "parallel", "subflow", "end", "trigger"] as const)("遇到%s控制步骤只列可核对名称并明确停下，不猜分支或继续", (type) => {
    const stopping = step(FIRST, "需单独核对的步骤", SECOND, { type });
    const result = messageWithoutIds(graph({ [FIRST]: stopping }));
    expect(result.steps.map((entry) => entry.nodeId)).toEqual([FIRST]);
    expect(["branch", "control"]).toContain(result.stop.kind);
    expect(result.stop.message).toMatch(/停止|不能|核对/);
    expect(result.steps.some((entry) => entry.nodeId === SECOND)).toBe(false);
  });

  it.each([
    { controlPlane: { kind: "safety", hiddenByDefault: true } },
    { ui: { visibility: "control" } },
    { type: "rule", rule: { kind: "quality" } },
    { quality: { requiredOutputTitles: [], minOutputCount: 1, checkToolReceipts: false, checkHumanBoundary: false } },
  ] satisfies Partial<WorkflowNode>[])("平台控制及结果检查不能按普通后续连接解释", (attributes) => {
    const result = messageWithoutIds(graph({ [FIRST]: step(FIRST, "核对系统控制", SECOND, attributes) }));
    expect(result.steps).toHaveLength(1); expect(result.stop.kind).toBe("control");
  });

  it("显式异常或未通过路径不猜选主路径；普通业务判断的明确主连接仍可展示", () => {
    const failedRoute = messageWithoutIds(graph({ [FIRST]: step(FIRST, "核对本项", SECOND, { onErrorNext: EXIT }) }));
    expect(failedRoute.stop.kind).toBe("branch"); expect(failedRoute.steps).toHaveLength(1);
    const business = messageWithoutIds(graph({ [FIRST]: step(FIRST, "按业务规则核对", SECOND, { type: "rule", rule: { kind: "business_rule" } }) }));
    expect(business.steps).toHaveLength(2); expect(business.stop.kind).toBe("returned-loop");
  });

  it("缺失步骤或不同key-id明确停止，不以其他记录或继承属性填补引用", () => {
    const missing = messageWithoutIds(graph({ [FIRST]: step(FIRST, "读取本项资料", "private_missing") }));
    expect(missing.stop.kind).toBe("missing"); expect(missing.steps).toHaveLength(1);
    const mismatch = messageWithoutIds(graph({ [SECOND]: step("private_wrong_id", "其他步骤") }));
    expect(mismatch.stop.kind).toBe("identity-mismatch"); expect(mismatch.steps.map((entry) => entry.nodeId)).toEqual([FIRST]);
    const inherited = messageWithoutIds(graph({ [FIRST]: step(FIRST, "读取本项资料", "toString") }));
    expect(inherited.stop.kind).toBe("missing"); expect(inherited.stop.message).not.toContain("toString");
  });

  it("明确无后续与未知后续分别说明，不声称本项或列表完成", () => {
    const noNext = messageWithoutIds(graph({ [SECOND]: step(SECOND, "整理本项内容", null) }));
    expect(noNext.stop.kind).toBe("no-next"); expect(noNext.stop.message).toContain("尚未连接回当前循环");
    const nodes = graph(); nodes[SECOND] = { ...nodes[SECOND], next: undefined } as unknown as WorkflowNode;
    const unknown = messageWithoutIds(nodes);
    expect(unknown.stop.kind).toBe("unknown-next"); expect(unknown.stop.message).toContain("暂时无法核对");
  });

  it("空源、源身份错误、非循环和未配置源都不是无内部步骤结论", () => {
    expect(loopBodyPath(LOOP, {}).stop.kind).toBe("source-missing");
    expect(messageWithoutIds(graph({ [LOOP]: step("private_wrong_id", "错误记录") })).stop.kind).toBe("source-mismatch");
    expect(messageWithoutIds(graph({ [LOOP]: step(LOOP, "普通步骤") })).stop.kind).toBe("not-loop");
    expect(messageWithoutIds(graph({ [LOOP]: step(LOOP, "逐项处理", null, { type: "loop" }) })).stop.kind).toBe("unconfigured");
  });

  it.each(["body-not-set", "exit-not-set", "exit-missing", "exit-mismatch", "invalid-boundary"] as const)("无法核对循环边界%s时不展开或回显未知引用", (kind) => {
    const nodes = graph();
    if (kind === "body-not-set") nodes[LOOP] = { ...nodes[LOOP], loop: { ...nodes[LOOP].loop!, bodyNext: null } };
    if (kind === "exit-not-set") nodes[LOOP] = { ...nodes[LOOP], loop: { ...nodes[LOOP].loop!, exitNext: null } };
    if (kind === "exit-missing") delete nodes[EXIT];
    if (kind === "exit-mismatch") nodes[EXIT] = step("private_wrong_id", "其他去向");
    if (kind === "invalid-boundary") nodes[LOOP] = { ...nodes[LOOP], loop: { ...nodes[LOOP].loop!, bodyNext: EXIT } };
    const result = messageWithoutIds(nodes);
    expect(result.stop.kind).toBe(kind); expect(result.steps).toEqual([]);
  });

  it("缺失、英文标记、同ID标题及标题中的内部标识使用中文兜底；常见敏感文字脱敏", () => {
    const nodes = graph({ [FIRST]: step(FIRST, FIRST, SECOND), [SECOND]: step(SECOND, "读取 private_second 资料") });
    expect(messageWithoutIds(nodes).steps.map((entry) => entry.title)).toEqual(["处理步骤 1（名称待核对）", "处理步骤 2（名称待核对）"]);
    for (const title of ["", "  ", "internal-label"]) expect(loopBodyPath(LOOP, graph({ [FIRST]: step(FIRST, title, SECOND) })).steps[0].title).toBe("处理步骤 1（名称待核对）");
    const safe = messageWithoutIds(graph({ [FIRST]: step(FIRST, "核对 buyer@example.test 的资料", SECOND) }));
    expect(safe.steps[0].title).toBe("核对 [已隐藏敏感信息] 的资料");
  });

  it("未知处理类型和超出共享上限都有明确停止原因，不无限展开", () => {
    const nodes = graph(); nodes[FIRST] = { ...nodes[FIRST], type: "unrecognized" } as unknown as WorkflowNode;
    expect(messageWithoutIds(nodes).stop.kind).toBe("unsupported");
    const many: WorkflowDraft["nodes"] = graph();
    for (let index = 0; index <= MAX_WORKFLOW_NODES; index += 1) many["chain_" + index] = step("chain_" + index, "处理本项资料", "chain_" + (index + 1));
    many[LOOP] = { ...many[LOOP], loop: { ...many[LOOP].loop!, bodyNext: "chain_0" } };
    const limited = loopBodyPath(LOOP, many);
    expect(limited.steps).toHaveLength(MAX_WORKFLOW_NODES); expect(limited.stop.kind).toBe("limit");
  });
});
