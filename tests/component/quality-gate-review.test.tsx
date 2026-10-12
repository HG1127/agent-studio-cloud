import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QualityGateReview } from "@/features/workflow-canvas/QualityGateReview";
import { qualityGateReworkDraft } from "../fixtures/quality-gate-rework";

afterEach(() => { vi.restoreAllMocks(); });

describe("质量规则只读叶子组件", () => {
  it("展示实际来源标题并仅通过回调定位，不发网络或写存储", () => {
    const draft = qualityGateReworkDraft(); const locate = vi.fn();
    const before = JSON.stringify(draft);
    const network = vi.spyOn(globalThis, "fetch"); const storage = vi.spyOn(Storage.prototype, "setItem");
    const { container } = render(<QualityGateReview originalNode={draft.nodes["review-private"]} originalWorkflow={draft} onLocateStep={locate} />);
    expect(screen.getAllByText("原始字段已保存")).toHaveLength(4);
    fireEvent.click(screen.getByRole("button", { name: "定位来源步骤：生成方案" }));
    expect(locate).toHaveBeenCalledWith("writer-private");
    expect(container.textContent).not.toContain("writer-private"); expect(container.textContent).not.toContain("review-private");
    expect(screen.getByText(/不证明来源已执行/)).toBeInTheDocument();
    expect(network).not.toHaveBeenCalled(); expect(storage).not.toHaveBeenCalled();
    expect(JSON.stringify(draft)).toBe(before);
  });

  it("原字段未保存时逐项标缺省，完整规则缺失不假造正常值", () => {
    const draft = qualityGateReworkDraft();
    const node = { ...draft.nodes["review-private"], quality: {} };
    const raw = { ...draft, nodes: { ...draft.nodes, "review-private": node } };
    const { rerender } = render(<QualityGateReview originalNode={node} originalWorkflow={raw} />);
    expect(screen.getAllByText(/原稿未保存此字段/)).toHaveLength(4);
    expect(screen.getByText(/不能把它当作无需形成结果/)).toBeInTheDocument();
    const { quality: omitted, ...withoutQuality } = node;
    expect(omitted).toEqual({});
    rerender(<QualityGateReview originalNode={withoutQuality} originalWorkflow={raw} />);
    expect(screen.getByRole("status")).toHaveTextContent("没有保存质量检查规则");
    expect(screen.queryByText("最低有效结果数量")).not.toBeInTheDocument();
  });

  it("未知来源与缺失来源分别说明，不产生虚假定位入口", () => {
    const draft = qualityGateReworkDraft(); const locate = vi.fn();
    const { rerender } = render(<QualityGateReview originalNode={draft.nodes["review-private"]} originalWorkflow={null} onLocateStep={locate} />);
    expect(screen.getByText("当前来源状态未知。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /定位来源步骤/ })).not.toBeInTheDocument();
    const node = { ...draft.nodes["review-private"], quality: { ...draft.nodes["review-private"].quality, requiredOutputTitles: ["不存在的来源"] } };
    const raw = { ...draft, nodes: { ...draft.nodes, "review-private": node } };
    rerender(<QualityGateReview originalNode={node} originalWorkflow={raw} onLocateStep={locate} />);
    expect(screen.getByText("当前这份流程中没有同名步骤。")).toBeInTheDocument();
    expect(locate).not.toHaveBeenCalled();
  });

  it("未指定来源且最低数量为零时不虚称仍要求形成有效结果", () => {
    const base = qualityGateReworkDraft();
    const node = { ...base.nodes["review-private"], quality: { ...base.nodes["review-private"].quality, requiredOutputTitles: [], minOutputCount: 0 } };
    const draft = { ...base, nodes: { ...base.nodes, "review-private": node } };
    render(<QualityGateReview originalNode={node} originalWorkflow={draft} />);
    expect(screen.getByText("0 项")).toBeInTheDocument();
    expect(screen.getByText(/不要求形成有效结果/)).toBeInTheDocument();
    expect(screen.queryByText(/不能把它当作无需形成结果/)).not.toBeInTheDocument();
  });

  it("重名不选择第一个步骤，额外字段不暴露为业务值", () => {
    const base = qualityGateReworkDraft(); const locate = vi.fn();
    const node = { ...base.nodes["review-private"], quality: { ...base.nodes["review-private"].quality, originalExtra: { secret: "不可展示" } } };
    const draft = { ...base, nodes: { ...base.nodes, "review-private": node, duplicate: { ...base.nodes["writer-private"], id: "duplicate" } } };
    const { container } = render(<QualityGateReview originalNode={node} originalWorkflow={draft} onLocateStep={locate} />);
    expect(screen.getByText(/多个同名步骤/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /定位来源步骤/ })).not.toBeInTheDocument();
    expect(screen.getByText(/还有 1 项额外字段/)).toBeInTheDocument();
    expect(container.textContent).not.toContain("不可展示"); expect(locate).not.toHaveBeenCalled();
  });

  it("真实来源没有定位接线时仍可按标题核对，回调异常不改原稿", () => {
    const draft = qualityGateReworkDraft();
    const { rerender } = render(<QualityGateReview originalNode={draft.nodes["review-private"]} originalWorkflow={draft} />);
    expect(screen.getByText(/当前页面没有接入定位入口/)).toBeInTheDocument();
    rerender(<QualityGateReview originalNode={draft.nodes["review-private"]} originalWorkflow={draft} onLocateStep={() => { throw new Error("定位不可用"); }} />);
    fireEvent.click(screen.getByRole("button", { name: "定位来源步骤：生成方案" }));
    expect(screen.getByRole("alert")).toHaveTextContent("暂时不能定位来源");
  });

  it("回执优先规则不冒充质量字段已执行，拒绝收尾不冒充获批准", () => {
    const draft = qualityGateReworkDraft();
    const node = { ...draft.nodes["review-private"], rule: { kind: "tool_receipt", sourceNodeId: "writer-private" } };
    const raw = { ...draft, nodes: { ...draft.nodes, "review-private": node } };
    render(<QualityGateReview originalNode={node} originalWorkflow={raw} />);
    expect(screen.getByRole("alert")).toHaveTextContent("优先核对回执");
    expect(screen.getByText(/检查通过也不等于业务交付获批准/)).toBeInTheDocument();
  });
});
