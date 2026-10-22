import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkflowDraft } from "@/contracts/workflow";
import { FrozenNodeContracts } from "@/features/versions/FrozenNodeContracts";
import { FrozenNodeDetails } from "@/features/versions/FrozenNodeDetails";
import { frozenWorkflowView } from "@/features/versions/frozen-workflow-view";
import { QualityGateReview } from "@/features/workflow-canvas/QualityGateReview";
import { AiReworkLimitReview } from "@/features/workflow-canvas/AiReworkLimitReview";
import { qualityGateReworkDraft } from "../fixtures/quality-gate-rework";
import { nodeContractWorkflow } from "../fixtures/node-contract-workflow";

afterEach(() => { vi.restoreAllMocks(); });
describe("冻结质量与返工的原字段核对", () => {
  it("真实冻结投影保留质量省略字段与未知尝试字段，不回填默认", () => {
    const base = qualityGateReworkDraft(), raw = { ...base, nodes: { ...base.nodes, "review-private": { ...base.nodes["review-private"], quality: {} } } };
    const before = JSON.stringify(raw), frozen = frozenWorkflowView(WorkflowDraft.parse(raw), raw);
    expect(frozen.nodes["review-private"].quality).toEqual({}); expect(frozen.nodes["writer-private"].retry).toEqual(base.nodes["writer-private"].retry);
    render(<FrozenNodeContracts node={frozen.nodes["review-private"]} workflow={frozen} />);
    const region = within(screen.getByRole("region", { name: "交付前检查规则核对" }));
    expect(region.getAllByText(/原稿未保存此字段/)).toHaveLength(4);
    expect(region.getByText("1 项")).toBeInTheDocument(); expect(JSON.stringify(raw)).toBe(before);
  });
  it("原尝试对象未保存与原质量对象未保存分别保留", () => {
    const base = qualityGateReworkDraft(), { retry: originalRetry, ...writer } = base.nodes["writer-private"], { quality: originalQuality, ...review } = base.nodes["review-private"];
    expect(originalRetry.maxAttempts).toBe(2); expect(originalQuality.minOutputCount).toBe(1);
    const raw = { ...base, nodes: { ...base.nodes, "writer-private": writer, "review-private": review } }, frozen = frozenWorkflowView(WorkflowDraft.parse(raw), raw);
    expect(frozen.nodes["writer-private"]).not.toHaveProperty("retry"); expect(frozen.nodes["review-private"]).not.toHaveProperty("quality");
    const { rerender } = render(<FrozenNodeContracts node={frozen.nodes["writer-private"]} workflow={frozen} />);
    expect(screen.getByText(/原步骤未保存尝试设置/)).toBeInTheDocument();
    expect(screen.getByText(/默认最多额外返工一次/)).toBeInTheDocument();
    rerender(<FrozenNodeContracts node={frozen.nodes["review-private"]} workflow={frozen} />);
    expect(screen.getByText(/没有保存质量检查规则/)).toBeInTheDocument();
  });
  it("原最低数量为零和两项否不被当成缺省，拒绝收尾不冒充批准", () => {
    const base = qualityGateReworkDraft(), raw = { ...base, nodes: { ...base.nodes, "review-private": { ...base.nodes["review-private"], quality: { requiredOutputTitles: [], minOutputCount: 0, checkToolReceipts: false, checkHumanBoundary: false } } } };
    const frozen = frozenWorkflowView(WorkflowDraft.parse(raw), raw);
    render(<FrozenNodeContracts node={frozen.nodes["review-private"]} workflow={frozen} />);
    expect(screen.getByText("0 项")).toBeInTheDocument(); expect(screen.getAllByText("未要求核对")).toHaveLength(2);
    expect(screen.getAllByText("原始字段已保存")).toHaveLength(4); expect(screen.getByText(/检查通过也不等于业务交付获批准/)).toBeInTheDocument();
  });
  it("真实冻结详情传递实际来源定位，原字段不改动且没有网络写入", () => {
    const raw = qualityGateReworkDraft(), frozen = frozenWorkflowView(WorkflowDraft.parse(raw), raw), locate = vi.fn(), network = vi.spyOn(globalThis, "fetch"), storage = vi.spyOn(Storage.prototype, "setItem");
    const before = JSON.stringify(raw), { container } = render(<FrozenNodeDetails node={frozen.nodes["review-private"]} workflow={frozen} onSelect={locate} />);
    fireEvent.click(screen.getByRole("button", { name: "定位来源步骤：生成方案" }));
    expect(locate).toHaveBeenCalledWith("writer-private"); expect(network).not.toHaveBeenCalled(); expect(storage).not.toHaveBeenCalled();
    expect(container.querySelector('section[aria-label="交付前检查规则核对"]')?.textContent).not.toContain("writer-private"); expect(JSON.stringify(raw)).toBe(before);
  });
  it.each(["group", "parallel"])("冻结组内返工只读且不认为自动返工生效：%s", (id) => {
    const raw = nodeContractWorkflow(), before = JSON.stringify(raw);
    render(<FrozenNodeContracts node={raw.nodes[id]} workflow={raw} />);
    expect(screen.getAllByText(/当前质量检查不会自动返工组内步骤/).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /编辑返工上限|设置返工上限/ })).not.toBeInTheDocument(); expect(JSON.stringify(raw)).toBe(before);
  });
  it("组内质量字段不冒用顶层同标识或假流程定位", () => {
    const raw = qualityGateReworkDraft(), locate = vi.fn();
    render(<QualityGateReview originalNode={raw.nodes["review-private"]} originalWorkflow={raw} inline onLocateStep={locate} />);
    expect(screen.getByText(/当前执行器不执行组内交付检查/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /定位来源步骤/ })).not.toBeInTheDocument(); expect(locate).not.toHaveBeenCalled();
  });
  it("原尝试有未知字段仅保留，等待参数不冒充质量返工实际间隔", () => {
    const raw = qualityGateReworkDraft(), frozen = frozenWorkflowView(WorkflowDraft.parse(raw), raw);
    render(<FrozenNodeDetails node={frozen.nodes["writer-private"]} workflow={frozen} onSelect={vi.fn()} />);
    expect(screen.getByText(/原保存总尝试上限：2 次/)).toBeInTheDocument();
    expect(screen.getByText(/当前质量返工不按此参数等待/)).toBeInTheDocument();
    expect(screen.getByText(/原尝试设置含额外字段/)).toBeInTheDocument(); expect(screen.queryByText(/间隔 500 毫秒/)).not.toBeInTheDocument();
  });
  it("未知或非法尝试不显示正常默认次数，访问器不读取", () => {
    const raw = qualityGateReworkDraft();
    const { rerender } = render(<AiReworkLimitReview originalNode={{ ...raw.nodes["writer-private"], retry: { maxAttempts: 0, backoffMs: 500 } }} />);
    expect(screen.getByText(/原尝试设置无法完整校验/)).toBeInTheDocument(); expect(screen.queryByText(/默认最多额外返工一次/)).not.toBeInTheDocument();
    let reads = 0; const node = Object.defineProperty({}, "retry", { enumerable: true, get: () => { reads += 1; return {}; } });
    rerender(<AiReworkLimitReview originalNode={node} />); expect(reads).toBe(0); expect(screen.getByText(/无法安全核对/)).toBeInTheDocument();
  });
  it("质量标题中的凭据与真实内部标识仅展示时隐藏，原来源不改写", () => {
    const base = qualityGateReworkDraft(), title = "生成方案 writer-private", writer = { ...base.nodes["writer-private"], title }, review = { ...base.nodes["review-private"], quality: { ...base.nodes["review-private"].quality, requiredOutputTitles: [title] } }, raw = { ...base, nodes: { ...base.nodes, "writer-private": writer, "review-private": review } }, locate = vi.fn();
    const before = JSON.stringify(raw), { container } = render(<QualityGateReview originalNode={review} originalWorkflow={raw} onLocateStep={locate} />);
    expect(container.textContent).not.toContain("writer-private");
    fireEvent.click(screen.getByRole("button", { name: /定位来源步骤：生成方案/ })); expect(locate).toHaveBeenCalledWith("writer-private"); expect(JSON.stringify(raw)).toBe(before);
  });
});
