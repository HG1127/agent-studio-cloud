import { useRef, useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkflowDraft } from "@/contracts/workflow";
import { QualityGateRulesEditor } from "@/features/workflow-canvas/QualityGateRulesEditor";
import {
  acceptQualityGateRulesRequest, beginQualityGateRulesEdit,
  type QualityGateRulesMemory, type QualityGateRulesMemoryVersion, type QualityGateRulesRequest,
} from "@/features/workflow-canvas/quality-gate-rules-editing";
import { qualityGateRulesDraft, removableQualityGateRulesDraft } from "../fixtures/quality-gate-rules";

const reviewId = "review-private";
afterEach(() => { vi.restoreAllMocks(); });
function open() { fireEvent.click(screen.getByRole("button", { name: /编辑质量规则|填写质量规则/ })); }
function minimum(value: string) { fireEvent.change(screen.getByLabelText("最低有效结果数量"), { target: { value } }); }
function ask() { fireEvent.click(screen.getByRole("button", { name: "应用质量规则到画布" })); }
function confirm() { fireEvent.click(screen.getByRole("button", { name: "确认应用质量规则" })); }

describe("质量规则叶子明确确认及父层接收", () => {
  it("按实际来源标题编辑四项，确认前不申请，明确接收后才清填写", async () => {
    const user = userEvent.setup(); const draft = qualityGateRulesDraft();
    let accepted: ReturnType<typeof acceptQualityGateRulesRequest> | null = null;
    const apply = vi.fn((request: QualityGateRulesRequest) => { accepted = acceptQualityGateRulesRequest(draft, 4, reviewId, true, request); return accepted.ok; });
    const network = vi.spyOn(globalThis, "fetch"); const storage = vi.spyOn(Storage.prototype, "setItem");
    const before = JSON.stringify(draft);
    const { container } = render(<QualityGateRulesEditor canvasDraft={draft} nodeId={reviewId} revision={4} sourcesComplete onApply={apply} />);
    expect(screen.getByText(/当前画布有效设置/)).toBeInTheDocument();
    expect(screen.getByText(/不能据此判断原保存字段/)).toBeInTheDocument();
    expect(screen.queryByText("原始字段已保存")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "编辑质量规则" }));
    await user.click(screen.getByLabelText("必须形成结果：参考资料"));
    minimum("2");
    await user.click(screen.getByLabelText("核对已执行工具的回执"));
    await user.click(screen.getByLabelText("核对已执行人工步骤的决定"));
    expect(apply).not.toHaveBeenCalled(); ask();
    expect(apply).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "确认应用这组质量规则？" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "确认应用质量规则" }));
    expect(apply).toHaveBeenCalledOnce();
    expect(accepted).toMatchObject({ ok: true, node: { quality: { requiredOutputTitles: ["生成方案", "参考资料"], minOutputCount: 2, checkToolReceipts: false, checkHumanBoundary: false }, retry: { maxAttempts: 2, backoffMs: 500 } } });
    expect(screen.queryByLabelText("最低有效结果数量")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("仍需通过画布保存并发布");
    expect(container.textContent).not.toMatch(/writer-private|reference-private|review-private|nested-private/);
    expect(network).not.toHaveBeenCalled(); expect(storage).not.toHaveBeenCalled();
    expect(JSON.stringify(draft)).toBe(before);
  });

  it.each(["false", "void", "throw"])("父层%s保留填写，不显示成功或自动保存", (mode) => {
    const apply = vi.fn(() => { if (mode === "throw") throw new Error("拒绝"); return mode === "void" ? undefined : false; });
    render(<QualityGateRulesEditor canvasDraft={qualityGateRulesDraft()} nodeId={reviewId} revision={4} sourcesComplete onApply={apply as unknown as (request: QualityGateRulesRequest) => boolean} />);
    open(); minimum("0"); ask(); confirm();
    expect(apply).toHaveBeenCalledOnce();
    expect(screen.getByLabelText("最低有效结果数量")).toHaveValue("0");
    expect(screen.getByRole("alert")).toHaveTextContent(/没有明确接受|发生异常/);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("父层按未渲染到叶子的最新完整草稿拒绝旧申请", () => {
    const draft = qualityGateRulesDraft();
    const latest = { ...draft, originalRoot: { ...draft.originalRoot, zero: 6 } };
    const apply = vi.fn((request: QualityGateRulesRequest) => acceptQualityGateRulesRequest(latest, 4, reviewId, true, request).ok);
    render(<QualityGateRulesEditor canvasDraft={draft} nodeId={reviewId} revision={4} sourcesComplete onApply={apply} />);
    open(); minimum("0"); ask(); confirm();
    expect(screen.getByRole("alert")).toHaveTextContent("没有明确接受");
    expect(screen.getByLabelText("最低有效结果数量")).toHaveValue("0");
    expect(latest.nodes[reviewId].quality.minOutputCount).toBe(1);
  });

  it("确认中完整草稿变化使旧确认失效并保留填写", () => {
    const draft = qualityGateRulesDraft(); const apply = vi.fn(() => true);
    const { rerender } = render(<QualityGateRulesEditor canvasDraft={draft} nodeId={reviewId} revision={4} sourcesComplete onApply={apply} />);
    open(); minimum("0"); ask();
    rerender(<QualityGateRulesEditor canvasDraft={{ ...draft, originalRoot: { ...draft.originalRoot, zero: 8 } }} nodeId={reviewId} revision={5} sourcesComplete onApply={apply} />);
    confirm(); expect(apply).not.toHaveBeenCalled();
    expect(screen.getByLabelText("最低有效结果数量")).toHaveValue("0");
    expect(screen.getByRole("button", { name: "应用质量规则到画布" })).toBeDisabled();
  });

  it("外部A→B→A与批次最终同JSON均不能复用旧修订", () => {
    const draft = qualityGateRulesDraft(); const apply = vi.fn(() => true);
    const { rerender } = render(<QualityGateRulesEditor canvasDraft={draft} nodeId={reviewId} revision={4} sourcesComplete onApply={apply} />);
    open(); minimum("0"); ask();
    rerender(<QualityGateRulesEditor canvasDraft={{ ...draft, originalRoot: { ...draft.originalRoot, zero: 7 } }} nodeId={reviewId} revision={5} sourcesComplete onApply={apply} />);
    rerender(<QualityGateRulesEditor canvasDraft={structuredClone(draft)} nodeId={reviewId} revision={6} sourcesComplete onApply={apply} />);
    confirm(); expect(apply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "取消质量填写" }));
    open(); minimum("0"); ask();
    rerender(<QualityGateRulesEditor canvasDraft={structuredClone(draft)} nodeId={reviewId} revision={8} sourcesComplete onApply={apply} />);
    confirm(); expect(apply).not.toHaveBeenCalled();
    expect(screen.getByLabelText("最低有效结果数量")).toHaveValue("0");
  });

  it("局部填写A→B→A也使原确认失效", () => {
    const apply = vi.fn(() => true);
    render(<QualityGateRulesEditor canvasDraft={qualityGateRulesDraft()} nodeId={reviewId} revision={4} sourcesComplete onApply={apply} />);
    open(); minimum("0"); ask(); minimum("1"); minimum("0"); confirm();
    expect(apply).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("本页填写已经变化");
    expect(screen.getByLabelText("最低有效结果数量")).toHaveValue("0");
  });

  it.each(["selection", "receipt", "incomplete"] as const)("确认期间%s变化均保留原填写，不写给其他归属", (kind) => {
    const draft = qualityGateRulesDraft(); const apply = vi.fn(() => true);
    const { rerender } = render(<QualityGateRulesEditor canvasDraft={draft} nodeId={reviewId} revision={4} sourcesComplete onApply={apply} />);
    open(); minimum("0"); ask();
    const current = kind === "receipt" ? { ...draft, nodes: { ...draft.nodes, [reviewId]: { ...draft.nodes[reviewId], rule: { kind: "tool_receipt" } } } } : draft;
    rerender(<QualityGateRulesEditor canvasDraft={current} nodeId={kind === "selection" ? "writer-private" : reviewId} revision={kind === "receipt" ? 5 : 4} sourcesComplete={kind !== "incomplete"} onApply={apply} />);
    confirm(); expect(apply).not.toHaveBeenCalled();
    expect(screen.getByLabelText("最低有效结果数量")).toHaveValue("0");
    expect(screen.getByRole("button", { name: "应用质量规则到画布" })).toBeDisabled();
  });

  it("不合法数量和过高指定数量均不裁剪，取消不写稿", () => {
    const apply = vi.fn(() => true); const draft = qualityGateRulesDraft();
    render(<QualityGateRulesEditor canvasDraft={draft} nodeId={reviewId} revision={4} sourcesComplete onApply={apply} />);
    open(); minimum("201"); ask();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByLabelText("最低有效结果数量")).toHaveValue("201");
    minimum("2"); ask();
    expect(screen.getByRole("alert")).toHaveTextContent("去重后的指定来源数量");
    expect(screen.getByLabelText("最低有效结果数量")).toHaveValue("2");
    fireEvent.click(screen.getByRole("button", { name: "取消质量填写" }));
    expect(apply).not.toHaveBeenCalled();
    expect(draft.nodes[reviewId].quality.minOutputCount).toBe(1);
  });

  it("没有质量对象时局部默认只供明确填写，取消不新增规则", () => {
    const base = qualityGateRulesDraft(); const { quality: omitted, ...node } = base.nodes[reviewId];
    expect(omitted.minOutputCount).toBe(1);
    const draft = { ...base, nodes: { ...base.nodes, [reviewId]: node } }; const apply = vi.fn(() => true);
    render(<QualityGateRulesEditor canvasDraft={draft} nodeId={reviewId} revision={4} sourcesComplete onApply={apply} />);
    expect(screen.getByText(/当前画布没有质量规则/)).toBeInTheDocument();
    open(); expect(screen.getByLabelText("最低有效结果数量")).toHaveValue("1");
    expect(screen.getByLabelText("核对已执行工具的回执")).not.toBeChecked();
    expect(apply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "取消质量填写" }));
    expect(Object.hasOwn(draft.nodes[reviewId], "quality")).toBe(false);
  });

  it("无效引用原样保留，明确移除后可另选来源；不显示内部标识", () => {
    const base = qualityGateRulesDraft();
    const draft = { ...base, nodes: { ...base.nodes, [reviewId]: { ...base.nodes[reviewId], quality: { ...base.nodes[reviewId].quality, requiredOutputTitles: ["writer-private"] } } } };
    const apply = vi.fn((request: QualityGateRulesRequest) => acceptQualityGateRulesRequest(draft, 4, reviewId, true, request).ok);
    const { container } = render(<QualityGateRulesEditor canvasDraft={draft} nodeId={reviewId} revision={4} sourcesComplete onApply={apply} />);
    open(); ask(); expect(apply).not.toHaveBeenCalled(); expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(container.textContent).not.toContain("writer-private");
    fireEvent.click(screen.getByRole("button", { name: "移除不能采用的第 1 项原引用" }));
    fireEvent.click(screen.getByLabelText("必须形成结果：参考资料"));
    ask(); confirm(); expect(apply).toHaveBeenCalledOnce();
    const request = apply.mock.calls[0][0];
    if (request.action !== "apply") throw new Error("Expected rule edit");
    expect(request.input.requiredOutputTitles).toEqual(["参考资料"]);
    expect(draft.nodes[reviewId].quality.requiredOutputTitles).toEqual(["writer-private"]);
  });

  it.each(["duplicate", "hidden", "unsupported"] as const)("不能将%s原来源列为可选或提供伪定位", (kind) => {
    const base = qualityGateRulesDraft();
    const draft = kind === "duplicate" ? { ...base, nodes: { ...base.nodes, duplicate: { ...base.nodes["writer-private"], id: "duplicate" } } }
      : kind === "hidden" ? { ...base, nodes: { ...base.nodes, "writer-private": { ...base.nodes["writer-private"], ui: { visibility: "control" } } } }
      : { ...base, nodes: { ...base.nodes, "writer-private": { ...base.nodes["writer-private"], type: "human" } } };
    render(<QualityGateRulesEditor canvasDraft={draft} nodeId={reviewId} revision={4} sourcesComplete onApply={() => false} />);
    open();
    expect(screen.queryByLabelText("必须形成结果：生成方案")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /定位/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "移除不能采用的第 1 项原引用" })).toBeInTheDocument();
    expect(screen.queryByLabelText("必须形成结果：组内整理")).not.toBeInTheDocument();
  });

  it("解析补默认的详情只标当前有效设置，源不读全或修订未知不开放编辑", () => {
    const base = qualityGateRulesDraft();
    const current = WorkflowDraft.parse({ ...base, nodes: { ...base.nodes, [reviewId]: { ...base.nodes[reviewId], quality: {} } } });
    const { rerender } = render(<QualityGateRulesEditor canvasDraft={current} nodeId={reviewId} revision={4} sourcesComplete onApply={() => false} />);
    expect(screen.getByText("1 项")).toBeInTheDocument();
    expect(screen.getByText(/详情读取可能已补入默认值/)).toBeInTheDocument();
    rerender(<QualityGateRulesEditor canvasDraft={current} nodeId={reviewId} revision={4} sourcesComplete={false} onApply={() => false} />);
    expect(screen.queryByRole("button", { name: "编辑质量规则" })).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("没有完整读取");
    rerender(<QualityGateRulesEditor canvasDraft={current} nodeId={reviewId} revision={Number.NaN} sourcesComplete onApply={() => false} />);
    expect(screen.queryByRole("button", { name: "编辑质量规则" })).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("修订不可核对");
  });
});

function MemoryHarness({ draft, apply, accept = false }: { draft: unknown; apply: (request: QualityGateRulesRequest) => void; accept?: boolean }) {
  const [entry, setEntry] = useState<QualityGateRulesMemory["entry"]>();
  const [visible, setVisible] = useState(true);
  const revisionCounter = useRef(0);
  const memory: QualityGateRulesMemory = {
    epoch: 7, entry,
    change: (value) => {
      revisionCounter.current += 1;
      const revision = revisionCounter.current;
      setEntry((previous) => ({ value, epoch: previous?.epoch ?? 7, revision, generation: 1, dirty: true }));
    },
    discard: (expected) => setEntry((previous) => {
      const current: QualityGateRulesMemoryVersion | undefined = previous ? { epoch: previous.epoch, revision: previous.revision, generation: previous.generation } : undefined;
      return JSON.stringify(expected) === JSON.stringify(current) ? undefined : previous;
    }),
  };
  return <><button type="button" onClick={() => setVisible((value) => !value)}>{visible ? "暂时收起编辑器" : "返回编辑器"}</button><p data-testid="retained-minimum">{entry?.value.input.minOutputCountText ?? "没有填写"}</p>
    {visible ? <QualityGateRulesEditor canvasDraft={draft} nodeId={reviewId} revision={4} sourcesComplete memory={memory} onApply={(request) => {
      apply(request);
      const current = entry ? { epoch: 7, revision: entry.revision, generation: entry.generation } : undefined;
      return accept && acceptQualityGateRulesRequest(draft, 4, reviewId, true, request, current).ok;
    }} /> : null}</>;
}

describe("质量规则memory叶子适配", () => {
  it("父memory在卸载后恢复填写，拒绝仍保留；取消只清对应填写", () => {
    const apply = vi.fn(); const draft = qualityGateRulesDraft();
    render(<MemoryHarness draft={draft} apply={apply} />);
    open(); minimum("0");
    fireEvent.click(screen.getByRole("button", { name: "暂时收起编辑器" }));
    expect(screen.getByTestId("retained-minimum")).toHaveTextContent("0");
    fireEvent.click(screen.getByRole("button", { name: "返回编辑器" }));
    expect(screen.getByLabelText("最低有效结果数量")).toHaveValue("0");
    ask(); confirm(); expect(apply).toHaveBeenCalledOnce();
    expect(screen.getByLabelText("最低有效结果数量")).toHaveValue("0");
    expect(apply.mock.calls[0][0].memory).toMatchObject({ epoch: 7, generation: 1 });
    fireEvent.click(screen.getByRole("button", { name: "取消质量填写" }));
    expect(screen.getByTestId("retained-minimum")).toHaveTextContent("没有填写");
    expect(draft.nodes[reviewId].quality.minOutputCount).toBe(1);
  });

  it("明确父接收后按原填写版本清memory", () => {
    const apply = vi.fn();
    render(<MemoryHarness draft={qualityGateRulesDraft()} apply={apply} accept />);
    open(); minimum("0"); ask(); confirm();
    expect(apply).toHaveBeenCalledOnce();
    expect(screen.getByTestId("retained-minimum")).toHaveTextContent("没有填写");
    expect(screen.getByRole("status")).toHaveTextContent("明确接收质量规则");
  });

  it("父memory中同值回退但填写修订变化使原确认失效", () => {
    const draft = qualityGateRulesDraft(); const apply = vi.fn(() => true);
    const started = beginQualityGateRulesEdit(draft, reviewId, 4, true);
    if (!started.ok) throw new Error(started.error);
    const value = { ...started.edit, input: { ...started.edit.input, minOutputCountText: "0" } };
    const memory: QualityGateRulesMemory = { epoch: 7, entry: { value, epoch: 7, revision: 2, generation: 1, dirty: true }, change: vi.fn(), discard: vi.fn() };
    const { rerender } = render(<QualityGateRulesEditor canvasDraft={draft} nodeId={reviewId} revision={4} sourcesComplete memory={memory} onApply={apply} />);
    ask();
    rerender(<QualityGateRulesEditor canvasDraft={draft} nodeId={reviewId} revision={4} sourcesComplete memory={{ ...memory, entry: { ...memory.entry!, revision: 4 } }} onApply={apply} />);
    confirm(); expect(apply).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("填写版本已经变化");
    expect(screen.getByLabelText("最低有效结果数量")).toHaveValue("0");
    expect(memory.discard).not.toHaveBeenCalled();
  });
});

describe("显式移除质量规则", () => {
  function askRemoval() { fireEvent.click(screen.getByRole("button", { name: "移除质量规则并改走业务判断" })); }
  function confirmRemoval() { fireEvent.click(screen.getByRole("button", { name: "确认移除并改走业务判断" })); }

  it("单独确认并说明改走已有模型业务判断，不改规则类别或自动执行", () => {
    const draft = removableQualityGateRulesDraft();
    const apply = vi.fn((request: QualityGateRulesRequest) => acceptQualityGateRulesRequest(draft, 4, reviewId, true, request).ok);
    const network = vi.spyOn(globalThis, "fetch"); const storage = vi.spyOn(Storage.prototype, "setItem");
    render(<QualityGateRulesEditor canvasDraft={draft} nodeId={reviewId} revision={4} sourcesComplete onApply={apply} />);
    open(); askRemoval();
    expect(apply).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "确认移除质量规则并改走业务判断？" })).toHaveTextContent("下一次执行会按该类别调用模型");
    fireEvent.click(screen.getByRole("button", { name: "返回" }));
    expect(screen.getByLabelText("最低有效结果数量")).toHaveValue("1");
    expect(apply).not.toHaveBeenCalled();
    askRemoval(); confirmRemoval();
    expect(apply).toHaveBeenCalledOnce();
    expect(apply.mock.calls[0][0]).toMatchObject({ action: "remove" });
    expect(apply.mock.calls[0][0]).not.toHaveProperty("input");
    expect(screen.getByRole("status")).toHaveTextContent("下一次执行将按已有业务判断设置调用模型");
    expect(draft.nodes[reviewId].rule.kind).toBe("business_rule");
    expect(draft.nodes[reviewId]).toHaveProperty("quality");
    expect(network).not.toHaveBeenCalled(); expect(storage).not.toHaveBeenCalled();
  });

  it.each(["false", "throw"])("移除父层%s仍保留原规则与填写", (mode) => {
    const draft = removableQualityGateRulesDraft();
    const apply = vi.fn(() => { if (mode === "throw") throw new Error("拒绝"); return false; });
    render(<QualityGateRulesEditor canvasDraft={draft} nodeId={reviewId} revision={4} sourcesComplete onApply={apply} />);
    open(); minimum("0"); askRemoval(); confirmRemoval();
    expect(apply).toHaveBeenCalledOnce();
    expect(screen.getByLabelText("最低有效结果数量")).toHaveValue("0");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(draft.nodes[reviewId]).toHaveProperty("quality");
  });

  it("确认期间类别变化或填写ABA均不移除", () => {
    const draft = removableQualityGateRulesDraft(); const apply = vi.fn(() => true);
    const { rerender } = render(<QualityGateRulesEditor canvasDraft={draft} nodeId={reviewId} revision={4} sourcesComplete onApply={apply} />);
    open(); askRemoval(); minimum("0"); minimum("1"); confirmRemoval();
    expect(apply).not.toHaveBeenCalled();
    askRemoval();
    const next = { ...draft, nodes: { ...draft.nodes, [reviewId]: { ...draft.nodes[reviewId], rule: { ...draft.nodes[reviewId].rule, kind: "quality_review" } } } };
    rerender(<QualityGateRulesEditor canvasDraft={next} nodeId={reviewId} revision={5} sourcesComplete onApply={apply} />);
    confirmRemoval(); expect(apply).not.toHaveBeenCalled();
    expect(screen.getByLabelText("最低有效结果数量")).toHaveValue("1");
    expect(screen.queryByRole("button", { name: "移除质量规则并改走业务判断" })).not.toBeInTheDocument();
  });

  it("普通质量关卡和带未知质量字段的业务判断不能安全移除", () => {
    const draft = qualityGateRulesDraft();
    const { rerender } = render(<QualityGateRulesEditor canvasDraft={draft} nodeId={reviewId} revision={4} sourcesComplete onApply={() => false} />);
    open();
    expect(screen.getByText(/质量对象含未解释的额外字段/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "移除质量规则并改走业务判断" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "取消质量填写" }));
    const clean = removableQualityGateRulesDraft();
    const ordinary = { ...clean, nodes: { ...clean.nodes, [reviewId]: { ...clean.nodes[reviewId], rule: { kind: "quality_review" } } } };
    rerender(<QualityGateRulesEditor canvasDraft={ordinary} nodeId={reviewId} revision={5} sourcesComplete onApply={() => false} />);
    open();
    expect(screen.getByText(/移除质量对象后会缺少执行设置/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "移除质量规则并改走业务判断" })).not.toBeInTheDocument();
  });

  it("移除的memory也只在明确父层接收后清填写", () => {
    const apply = vi.fn();
    render(<MemoryHarness draft={removableQualityGateRulesDraft()} apply={apply} accept />);
    open(); askRemoval(); confirmRemoval();
    expect(apply).toHaveBeenCalledOnce();
    expect(apply.mock.calls[0][0]).toMatchObject({ action: "remove", memory: { epoch: 7, generation: 1 } });
    expect(screen.getByTestId("retained-minimum")).toHaveTextContent("没有填写");
  });
});
