import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AiReworkLimitEditor } from "@/features/workflow-canvas/AiReworkLimitEditor";
import { acceptAiReworkRequest, type AiReworkRequest } from "@/features/workflow-canvas/ai-rework-editing";
import { qualityGateReworkDraft } from "../fixtures/quality-gate-rework";

const writerId = "writer-private";
afterEach(() => { vi.restoreAllMocks(); });

function open() { fireEvent.click(screen.getByRole("button", { name: /编辑返工上限|设置返工上限/ })); }
function fill(value: string) { fireEvent.change(screen.getByLabelText("包含首次处理的总尝试次数"), { target: { value } }); }
function ask() { fireEvent.click(screen.getByRole("button", { name: "应用到画布草稿" })); }
function confirm() { fireEvent.click(screen.getByRole("button", { name: "确认应用返工上限" })); }

describe("AI返工上限叶子编辑器的明确父接收", () => {
  it("先核对再应用，只在完整父层明确接收后清填写，不自动保存或运行", async () => {
    const user = userEvent.setup(); const original = qualityGateReworkDraft();
    let received: ReturnType<typeof acceptAiReworkRequest> | null = null;
    const apply = vi.fn((request: AiReworkRequest) => { received = acceptAiReworkRequest(original, 7, writerId, request); return received.ok; });
    const network = vi.spyOn(globalThis, "fetch"); const storage = vi.spyOn(Storage.prototype, "setItem");
    const { container } = render(<AiReworkLimitEditor originalDraft={original} nodeId={writerId} revision={7} onApply={apply} />);
    expect(apply).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "编辑返工上限" }));
    fill("1"); ask();
    expect(apply).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "确认应用自动返工上限？" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "确认应用返工上限" }));
    expect(apply).toHaveBeenCalledOnce();
    expect(received).toMatchObject({ ok: true, node: { retry: { maxAttempts: 1, backoffMs: 500 } } });
    expect(screen.queryByLabelText("包含首次处理的总尝试次数")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("仍需通过画布保存并发布");
    expect(container.textContent).not.toContain(writerId);
    expect(network).not.toHaveBeenCalled(); expect(storage).not.toHaveBeenCalled();
    expect(original.nodes[writerId].retry.maxAttempts).toBe(2);
  });

  it.each(["false", "void", "throw"])("父层%s不会清填写或显示应用成功", (mode) => {
    const apply = vi.fn(() => { if (mode === "throw") throw new Error("拒绝"); return mode === "void" ? undefined : false; });
    render(<AiReworkLimitEditor originalDraft={qualityGateReworkDraft()} nodeId={writerId} revision={1} onApply={apply as unknown as (request: AiReworkRequest) => boolean} />);
    open(); fill("3"); ask(); confirm();
    expect(apply).toHaveBeenCalledOnce();
    expect(screen.getByLabelText("包含首次处理的总尝试次数")).toHaveValue("3");
    expect(screen.getByRole("alert")).toHaveTextContent(/没有明确接受|发生异常/);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("父层按未渲染到叶子的最新原稿重新拒绝，不能靠旧画面写入", () => {
    const original = qualityGateReworkDraft();
    const current = { ...original, originalRoot: { ...original.originalRoot, zero: 9 } };
    const apply = vi.fn((request: AiReworkRequest) => acceptAiReworkRequest(current, 1, writerId, request).ok);
    render(<AiReworkLimitEditor originalDraft={original} nodeId={writerId} revision={1} onApply={apply} />);
    open(); fill("4"); ask(); confirm();
    expect(screen.getByRole("alert")).toHaveTextContent("没有明确接受");
    expect(screen.getByLabelText("包含首次处理的总尝试次数")).toHaveValue("4");
    expect(current.nodes[writerId].retry.maxAttempts).toBe(2);
  });

  it("确认期间完整草稿任一位置变化会失效，仍保留原填写", () => {
    const original = qualityGateReworkDraft(); const apply = vi.fn(() => true);
    const { rerender } = render(<AiReworkLimitEditor originalDraft={original} nodeId={writerId} revision={1} onApply={apply} />);
    open(); fill("3"); ask();
    rerender(<AiReworkLimitEditor originalDraft={{ ...original, originalRoot: { ...original.originalRoot, zero: 1 } }} nodeId={writerId} revision={2} onApply={apply} />);
    confirm();
    expect(apply).not.toHaveBeenCalled();
    expect(screen.getByLabelText("包含首次处理的总尝试次数")).toHaveValue("3");
    expect(screen.getByRole("button", { name: "应用到画布草稿" })).toBeDisabled();
  });

  it("完整草稿A→B→A回同JSON仍使原确认失效", () => {
    const original = qualityGateReworkDraft(); const apply = vi.fn(() => true);
    const { rerender } = render(<AiReworkLimitEditor originalDraft={original} nodeId={writerId} revision={4} onApply={apply} />);
    open(); fill("3"); ask();
    rerender(<AiReworkLimitEditor originalDraft={{ ...original, originalRoot: { ...original.originalRoot, zero: 1 } }} nodeId={writerId} revision={5} onApply={apply} />);
    rerender(<AiReworkLimitEditor originalDraft={structuredClone(original)} nodeId={writerId} revision={6} onApply={apply} />);
    confirm();
    expect(apply).not.toHaveBeenCalled();
    expect(screen.getByLabelText("包含首次处理的总尝试次数")).toHaveValue("3");
    expect(screen.getAllByRole("alert").some((alert) => alert.textContent?.includes("原确认失效"))).toBe(true);
  });

  it("批次结束时JSON未变也必须使用新的单调修订", () => {
    const original = qualityGateReworkDraft(); const apply = vi.fn(() => true);
    const { rerender } = render(<AiReworkLimitEditor originalDraft={original} nodeId={writerId} revision={1} onApply={apply} />);
    open(); fill("3"); ask();
    rerender(<AiReworkLimitEditor originalDraft={structuredClone(original)} nodeId={writerId} revision={3} onApply={apply} />);
    confirm(); expect(apply).not.toHaveBeenCalled();
    expect(screen.getByLabelText("包含首次处理的总尝试次数")).toHaveValue("3");
  });

  it("本页填写A→B→A不能沿用旧确认，即使最后值相同", () => {
    const apply = vi.fn(() => true);
    render(<AiReworkLimitEditor originalDraft={qualityGateReworkDraft()} nodeId={writerId} revision={1} onApply={apply} />);
    open(); fill("3"); ask(); fill("4"); fill("3"); confirm();
    expect(apply).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("本页填写已经变化");
    expect(screen.getByLabelText("包含首次处理的总尝试次数")).toHaveValue("3");
  });

  it("换步骤或改为其他类型均拒绝旧确认，不把填写套给新步骤", () => {
    const original = qualityGateReworkDraft(); const apply = vi.fn(() => true);
    const { rerender } = render(<AiReworkLimitEditor originalDraft={original} nodeId={writerId} revision={1} onApply={apply} />);
    open(); fill("3"); ask();
    rerender(<AiReworkLimitEditor originalDraft={original} nodeId="review-private" revision={1} onApply={apply} />);
    confirm(); expect(apply).not.toHaveBeenCalled();
    expect(screen.getByLabelText("包含首次处理的总尝试次数")).toHaveValue("3");
    fireEvent.click(screen.getByRole("button", { name: "取消本页填写" }));
    expect(screen.queryByRole("button", { name: "编辑返工上限" })).not.toBeInTheDocument();
  });

  it("原稿没有retry时字段留空，只有明确完整填写才能申请", () => {
    const base = qualityGateReworkDraft(); const { retry: omitted, ...node } = base.nodes[writerId];
    expect(omitted.maxAttempts).toBe(2);
    const original = { ...base, nodes: { ...base.nodes, [writerId]: node } };
    const apply = vi.fn((request: AiReworkRequest) => acceptAiReworkRequest(original, 1, writerId, request).ok);
    render(<AiReworkLimitEditor originalDraft={original} nodeId={writerId} revision={1} onApply={apply} />);
    expect(screen.getByText(/默认最多额外返工一次/)).toBeInTheDocument();
    open();
    expect(screen.getByLabelText("包含首次处理的总尝试次数")).toHaveValue("");
    expect(screen.getByLabelText("新设置所需的等待参数（毫秒）")).toHaveValue("");
    fill("1"); ask();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); expect(apply).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("新设置所需的等待参数（毫秒）"), { target: { value: "750" } });
    ask(); confirm(); expect(apply).toHaveBeenCalledOnce();
    expect(Object.hasOwn(original.nodes[writerId], "retry")).toBe(false);
  });

  it("无效填写不截断成合法次数，取消不写回原值", () => {
    const apply = vi.fn(() => true);
    render(<AiReworkLimitEditor originalDraft={qualityGateReworkDraft()} nodeId={writerId} revision={1} onApply={apply} />);
    open(); fill("9"); ask();
    expect(screen.getByRole("alert")).toHaveTextContent("1 到 8");
    expect(screen.getByLabelText("包含首次处理的总尝试次数")).toHaveValue("9");
    fireEvent.click(screen.getByRole("button", { name: "取消本页填写" }));
    expect(apply).not.toHaveBeenCalled(); expect(screen.queryByLabelText("包含首次处理的总尝试次数")).not.toBeInTheDocument();
  });

  it("完整原稿非法或修订未知时不开放编辑", () => {
    const apply = vi.fn(() => true);
    const { rerender } = render(<AiReworkLimitEditor originalDraft={null} nodeId={writerId} revision={1} onApply={apply} />);
    expect(screen.getByRole("alert")).toHaveTextContent("完整原稿不能通过校验");
    rerender(<AiReworkLimitEditor originalDraft={qualityGateReworkDraft()} nodeId={writerId} revision={Number.NaN} onApply={apply} />);
    expect(screen.getByRole("alert")).toHaveTextContent("草稿修订未知");
    expect(screen.queryByRole("button", { name: "编辑返工上限" })).not.toBeInTheDocument(); expect(apply).not.toHaveBeenCalled();
  });
});
