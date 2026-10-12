import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { FrozenResourceComparison } from "@/features/versions/FrozenResourceComparison";
import { afterFrozenResourceView, beforeFrozenResourceView, unknownFrozenResourceView } from "../fixtures/frozen-resource-comparison";

function renderComparison(
  beforeView = beforeFrozenResourceView(),
  afterView = afterFrozenResourceView(),
  beforeVersion = 8,
  afterVersion = 2,
) {
  return render(<FrozenResourceComparison beforeView={beforeView} afterView={afterView}
    beforeVersion={beforeVersion} afterVersion={afterVersion} />);
}

function side(label: string) { return within(screen.getByRole("region", { name: label })); }
function freeze(value: unknown) {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
}
function openReferences(label: string) {
  const region = screen.getByRole("region", { name: label });
  const details = region.querySelector("details");
  const summary = details?.querySelector("summary");
  if (!details || !summary) throw new Error("Expected native references disclosure");
  fireEvent.click(summary);
  return details;
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("FrozenResourceComparison", () => {
  it("按传入方向显示实际版本序号，不排序、计算业务变化或声称资源相同", () => {
    renderComparison();
    expect(screen.getByRole("heading", { name: "两个版本的资源声明核对" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "前一份 · 版本 8" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "后一份 · 版本 2" })).toBeInTheDocument();
    expect(screen.getByText(/相同显示名称不能证明资源相同或执行一致/)).toBeInTheDocument();
    expect(screen.queryByText(/没有变化|可执行内容一致|项变化|资源可用|已批准/)).not.toBeInTheDocument();
  });

  it("缺省来源、明确 false 与 null 的安全文本分别保留在对应记录中", () => {
    renderComparison();
    expect(side("前一份 · 版本 8").getByText("模拟模式原字段未保存；契约默认未启用模拟模式。")).toBeInTheDocument();
    expect(side("前一份 · 版本 8").getByText("连接原字段未保存；契约默认未指定已保存连接。")).toBeInTheDocument();
    expect(side("后一份 · 版本 2").getByText("原字段记录：未启用模拟模式。")).toBeInTheDocument();
    expect(side("后一份 · 版本 2").getByText("连接原字段明确未指定已保存连接。")).toBeInTheDocument();
    expect(side("前一份 · 版本 8").queryByText("原字段记录：未启用模拟模式。")).not.toBeInTheDocument();
  });

  it("资料列表原字段缺失与明确 0 项分别显示，不把缺省空列表改成明空", () => {
    renderComparison();
    expect(side("前一份 · 版本 8").getByText(/不能当作历史明确选择了 0 项/)).toBeInTheDocument();
    expect(side("后一份 · 版本 2").getByText(/原快照明确保存了 0 项资料声明/)).toBeInTheDocument();
    expect(side("前一份 · 版本 8").queryByText(/^原快照明确保存了 0 项/)).not.toBeInTheDocument();
  });

  it("前一份未知时后一份的声明、版本序号与引用保持独立可核对", () => {
    renderComparison(unknownFrozenResourceView(), afterFrozenResourceView());
    expect(side("前一份 · 版本 8").getByRole("status")).toHaveTextContent("范围未知");
    expect(side("前一份 · 版本 8").queryByText(/明确保存了 0 项/)).not.toBeInTheDocument();
    expect(side("后一份 · 版本 2").getByText("原字段记录：未启用模拟模式。")).toBeInTheDocument();
    expect(openReferences("后一份 · 版本 2")).toHaveAttribute("open");
    expect(side("后一份 · 版本 2").getByRole("list", { name: "冻结资源步骤列表" })).toBeInTheDocument();
  });

  it("后一份未知时前一份仍显示原字段来源，不用前一份补造后一份", () => {
    renderComparison(beforeFrozenResourceView(), unknownFrozenResourceView());
    expect(side("后一份 · 版本 2").getByRole("status")).toHaveTextContent("范围未知");
    expect(side("后一份 · 版本 2").queryByText("模型选择")).not.toBeInTheDocument();
    expect(side("前一份 · 版本 8").getByText(/模拟模式原字段未保存/)).toBeInTheDocument();
    expect(screen.getAllByText(/尚未确认拿到这个版本的完整原快照/)).toHaveLength(1);
  });

  it("两侧未知时保留两个范围未知状态，而不是空资源或空步骤", () => {
    renderComparison(unknownFrozenResourceView(), unknownFrozenResourceView());
    expect(side("前一份 · 版本 8").getByRole("status")).toHaveTextContent("范围未知");
    expect(side("后一份 · 版本 2").getByRole("status")).toHaveTextContent("范围未知");
    expect(screen.queryByText(/明确保存了 0 个顶层步骤/)).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "冻结资源步骤列表" })).not.toBeInTheDocument();
  });

  it("同名声明和步骤不合并，未提供跨版本名称匹配或替代选择", () => {
    const before = beforeFrozenResourceView();
    const after = afterFrozenResourceView();
    before.knowledge = { description: "原快照保存了 1 项资料声明；历史名称未保存。", items: [{ label: "资料声明第 1 项（历史名称未保存）", repeated: 1 }] };
    after.knowledge = { description: "原快照保存了 1 项资料声明；历史名称未保存。", items: [{ label: "资料声明第 1 项（历史名称未保存）", repeated: 1 }] };
    renderComparison(before, after);
    expect(screen.getAllByText("资料声明第 1 项（历史名称未保存）")).toHaveLength(2);
    openReferences("前一份 · 版本 8");
    openReferences("后一份 · 版本 2");
    expect(screen.getAllByRole("heading", { name: "第 1 项 · 核对办理资料" })).toHaveLength(2);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("重复资料声明和额外字段提示保留在各自一侧，不去重、不合计成业务变化", () => {
    const before = beforeFrozenResourceView();
    before.knowledge = {
      description: "原快照明确保存了 2 项资料声明；历史资料名称和内容未保存。",
      items: [{ label: "资料声明第 1 项（历史名称未保存）", repeated: 2 }, { label: "资料声明第 2 项（历史名称未保存）", repeated: 2 }],
    };
    before.unknownFieldCount = 3;
    before.warnings = ["资源核对范围内有 3 项额外字段，未用于补齐声明，也未修改原记录。"];
    renderComparison(before, afterFrozenResourceView());
    expect(side("前一份 · 版本 8").getAllByText(/原列表有 2 项同标识声明/)).toHaveLength(2);
    expect(side("前一份 · 版本 8").getByText(/有 3 项额外字段/)).toBeInTheDocument();
    expect(side("后一份 · 版本 2").queryByText(/有 3 项额外字段/)).not.toBeInTheDocument();
    expect(side("后一份 · 版本 2").getByText(/明确保存了 0 项资料声明/)).toBeInTheDocument();
    expect(screen.queryByText(/3 项变化/)).not.toBeInTheDocument();
  });

  it("两侧都保留工具目录历史缺口，不把相同缺口解释成相同工具", () => {
    renderComparison();
    expect(side("前一份 · 版本 8").getByText(/契约未保存工具目录快照/)).toBeInTheDocument();
    expect(side("后一份 · 版本 2").getByText(/契约未保存工具目录快照/)).toBeInTheDocument();
    expect(screen.queryByText(/相同工具|工具一致|历史权限已核实/)).not.toBeInTheDocument();
  });

  it("摘要常显，步骤引用使用两份独立原生 details，展开一份不展开另一份", () => {
    const rendered = renderComparison();
    const details = Array.from(rendered.container.querySelectorAll("details"));
    expect(details).toHaveLength(2);
    expect(details.every((item) => !item.open)).toBe(true);
    expect(side("前一份 · 版本 8").getByText(/历史模型名称未保存/)).toBeVisible();
    expect(side("后一份 · 版本 2").getByText(/明确保存了 0 项资料声明/)).toBeVisible();
    openReferences("前一份 · 版本 8");
    expect(details[0].open).toBe(true);
    expect(details[1].open).toBe(false);
    openReferences("前一份 · 版本 8");
    expect(details[0].open).toBe(false);
  });

  it("明确 0 个步骤仅显示在对应已知记录中，不吞掉另一份的引用", () => {
    const before = beforeFrozenResourceView();
    before.steps = [];
    renderComparison(before, afterFrozenResourceView());
    openReferences("前一份 · 版本 8");
    openReferences("后一份 · 版本 2");
    expect(side("前一份 · 版本 8").getByRole("status")).toHaveTextContent("明确保存了 0 个顶层步骤");
    expect(side("后一份 · 版本 2").getByRole("list", { name: "冻结资源步骤列表" })).toBeInTheDocument();
  });

  it("合法的 0 序号按原值展示，不使用真假值默认成其他版本", () => {
    renderComparison(beforeFrozenResourceView(), afterFrozenResourceView(), 0, 2);
    expect(screen.getByRole("region", { name: "前一份 · 版本 0" })).toBeInTheDocument();
    expect(screen.queryByText("版本序号待核对")).not.toBeInTheDocument();
  });

  it("无效版本序号只标为待核对，不隐藏或替换其安全资源记录", () => {
    renderComparison(beforeFrozenResourceView(), afterFrozenResourceView(), Number.NaN, 2);
    expect(screen.getByRole("region", { name: "前一份 · 版本序号待核对" })).toBeInTheDocument();
    expect(side("前一份 · 版本序号待核对").getByText(/模拟模式原字段未保存/)).toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });

  it("相同版本序号也保留两份独立区域，不声明它们相同或已批准", () => {
    renderComparison(beforeFrozenResourceView(), afterFrozenResourceView(), 4, 4);
    expect(screen.getByRole("region", { name: "前一份 · 版本 4" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "后一份 · 版本 4" })).toBeInTheDocument();
    expect(screen.queryByText(/内容一致|相同资源|已批准/)).not.toBeInTheDocument();
  });

  it("输入视图可被冻结；渲染和展开不写入、补齐或合并任一份", () => {
    const before = beforeFrozenResourceView();
    const after = afterFrozenResourceView();
    const originalBefore = JSON.stringify(before);
    const originalAfter = JSON.stringify(after);
    freeze(before);
    freeze(after);
    renderComparison(before, after);
    openReferences("前一份 · 版本 8");
    openReferences("后一份 · 版本 2");
    expect(JSON.stringify(before)).toBe(originalBefore);
    expect(JSON.stringify(after)).toBe(originalAfter);
  });

  it("即使安全视图带有所属步骤标识，也不显示标识、生成定位回调或版本链接", () => {
    const rendered = renderComparison();
    openReferences("前一份 · 版本 8");
    openReferences("后一份 · 版本 2");
    expect(rendered.container.innerHTML).not.toMatch(/comparison_owner_before|comparison_owner_after|modelId|connectionId|registryToolId|workflowFingerprint|runId|workspace/);
    expect(screen.queryByRole("button", { name: "定位所属步骤" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("不创建网络或存储调用，没有保存、发布、恢复、执行或运行操作", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const storageWrite = vi.spyOn(Storage.prototype, "setItem");
    const storageRemove = vi.spyOn(Storage.prototype, "removeItem");
    renderComparison();
    openReferences("前一份 · 版本 8");
    openReferences("后一份 · 版本 2");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(storageWrite).not.toHaveBeenCalled();
    expect(storageRemove).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /保存|发布|恢复|执行|运行|批准/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("多实例区域标题标识独立，更新安全视图后仍对应真实传入的方向和序号", () => {
    const rendered = renderComparison();
    rendered.rerender(<FrozenResourceComparison beforeView={unknownFrozenResourceView()} afterView={afterFrozenResourceView()} beforeVersion={3} afterVersion={10} />);
    expect(side("前一份 · 版本 3").getByRole("status")).toHaveTextContent("范围未知");
    expect(side("后一份 · 版本 10").getByText(/明确保存了 0 项资料声明/)).toBeInTheDocument();
    renderComparison(beforeFrozenResourceView(), afterFrozenResourceView(), 5, 6);
    const ids = Array.from(document.querySelectorAll("[id]")).map((element) => element.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
