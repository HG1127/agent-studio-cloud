import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkflowNode } from "@/contracts/workflow";
import { NodeModelOutputEditor } from "@/features/workflow-canvas/NodeModelOutputEditor";

const base = WorkflowNode.parse({ id: "private-model", title: "生成方案", type: "ai", next: "review" });
const config = { format: "json" as const, schema: { type: "object", properties: { 金额: { type: "number", enum: [0, 10] }, 同意: { type: "boolean" } } }, providerMode: "json" as const, maxRepairAttempts: 1, mockOutput: { 金额: 0, 同意: false } };
const configured = WorkflowNode.parse({ ...base, modelOutput: config });
afterEach(() => { vi.restoreAllMocks(); });

describe("模型结果字段约定编辑器", () => {
  it("未设置时不自动写配置，显式启用和应用才更改草稿，不发网络或写本地存储", async () => {
    const user = userEvent.setup();
    const change = vi.fn();
    const network = vi.spyOn(globalThis, "fetch");
    const storage = vi.spyOn(Storage.prototype, "setItem");
    const { container } = render(<NodeModelOutputEditor node={base} onNodeChange={change} />);
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(change).not.toHaveBeenCalled();
    await user.click(screen.getByRole("checkbox"));
    expect(change).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("结果字段规则"), { target: { value: JSON.stringify(config.schema) } });
    await user.selectOptions(screen.getByLabelText("结果请求方式"), "json-schema");
    await user.selectOptions(screen.getByLabelText("额外格式修正次数"), "0");
    await user.click(screen.getByRole("button", { name: "应用到当前草稿" }));
    expect(change).toHaveBeenCalledOnce();
    expect(change.mock.calls[0][0]).toMatchObject({ ...base, modelOutput: { format: "json", schema: config.schema, providerMode: "json-schema", maxRepairAttempts: 0 } });
    expect(screen.getByRole("status")).toHaveTextContent("尚未保存或发布");
    expect(container.textContent).not.toContain("private-model");
    expect(network).not.toHaveBeenCalled(); expect(storage).not.toHaveBeenCalled();
  });

  it("取消未应用的编辑保留原值并把焦点返回开关", async () => {
    const user = userEvent.setup(); const change = vi.fn();
    render(<NodeModelOutputEditor node={base} onNodeChange={change} />);
    const toggle = screen.getByRole("checkbox");
    await user.click(toggle);
    fireEvent.change(screen.getByLabelText("结果字段规则"), { target: { value: "未完成规则" } });
    await user.click(screen.getByRole("button", { name: "取消编辑" }));
    expect(change).not.toHaveBeenCalled(); expect(toggle).not.toBeChecked(); expect(toggle).toHaveFocus();
  });

  it("展示真实旧规则及明确开发者模拟边界，替换必须确认且保留模拟样例", async () => {
    const user = userEvent.setup(); const change = vi.fn();
    render(<NodeModelOutputEditor node={configured} onNodeChange={change} />);
    expect(screen.getByLabelText("原字段规则只读")).toHaveValue(JSON.stringify(config.schema, null, 2));
    expect(screen.getByLabelText("原模拟样例只读")).toHaveValue(JSON.stringify(config.mockOutput, null, 2));
    expect(screen.getByText(/仅后端模拟模式采用此测试样例/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "编辑结果约定" }));
    await user.selectOptions(screen.getByLabelText("额外格式修正次数"), "0");
    await user.click(screen.getByRole("button", { name: "应用到当前草稿" }));
    expect(change).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "替换当前结果约定？" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "确认替换约定" }));
    expect(change.mock.calls[0][0].modelOutput).toEqual({ ...config, maxRepairAttempts: 0 });
    await waitFor(() => expect(screen.getByRole("checkbox")).toHaveFocus());
  });

  it("清除需要确认，取消返回原开关；确认只删除当前节点结果约定", async () => {
    const user = userEvent.setup(); const change = vi.fn();
    render(<NodeModelOutputEditor node={configured} onNodeChange={change} />);
    const toggle = screen.getByRole("checkbox");
    await user.click(toggle);
    expect(change).not.toHaveBeenCalled();
    expect(screen.getByText(/字段规则和原模拟样例将一起/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "返回" }));
    expect(toggle).toBeChecked(); await waitFor(() => expect(toggle).toHaveFocus());
    await user.click(toggle);
    await user.click(screen.getByRole("button", { name: "确认清除约定" }));
    expect(change.mock.calls[0][0]).toEqual(base);
  });

  it("确认期间步骤变更拒绝覆盖，原配置仍保留", async () => {
    const user = userEvent.setup(); const change = vi.fn();
    const { rerender } = render(<NodeModelOutputEditor node={configured} onNodeChange={change} />);
    await user.click(screen.getByRole("button", { name: "编辑结果约定" }));
    await user.click(screen.getByRole("button", { name: "应用到当前草稿" }));
    rerender(<NodeModelOutputEditor node={{ ...configured, description: "并行修改" }} onNodeChange={change} />);
    await user.click(screen.getByRole("button", { name: "确认替换约定" }));
    expect(change).not.toHaveBeenCalled();
    expect(screen.getAllByRole("alert").some((alert) => alert.textContent?.includes("发生变化"))).toBe(true);
    expect(screen.getByRole("button", { name: "应用到当前草稿" })).toBeDisabled();
  });

  it("清除确认期间的并行变更同样保留", async () => {
    const user = userEvent.setup(); const change = vi.fn();
    const { rerender } = render(<NodeModelOutputEditor node={configured} onNodeChange={change} />);
    await user.click(screen.getByRole("checkbox"));
    rerender(<NodeModelOutputEditor node={{ ...configured, title: "新的步骤名称" }} onNodeChange={change} />);
    await user.click(screen.getByRole("button", { name: "确认清除约定" }));
    expect(change).not.toHaveBeenCalled(); expect(screen.getByRole("alert")).toHaveTextContent("原信息没有清除");
  });

  it("编辑期间换节点后保留输入但禁止应用，可取消重新打开", async () => {
    const user = userEvent.setup(); const change = vi.fn();
    const { rerender } = render(<NodeModelOutputEditor node={base} onNodeChange={change} />);
    await user.click(screen.getByRole("checkbox"));
    fireEvent.change(screen.getByLabelText("结果字段规则"), { target: { value: "保留未完成输入" } });
    rerender(<NodeModelOutputEditor node={{ ...base, id: "another-private" }} onNodeChange={change} />);
    expect(screen.getByLabelText("结果字段规则")).toHaveValue("保留未完成输入");
    expect(screen.getByRole("button", { name: "应用到当前草稿" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "取消编辑" }));
    expect(change).not.toHaveBeenCalled();
  });

  it("错误格式提示，不丢输入或假装应用成功", async () => {
    const user = userEvent.setup(); const change = vi.fn();
    render(<NodeModelOutputEditor node={base} onNodeChange={change} />);
    await user.click(screen.getByRole("checkbox"));
    fireEvent.change(screen.getByLabelText("结果字段规则"), { target: { value: "{" } });
    await user.click(screen.getByRole("button", { name: "应用到当前草稿" }));
    expect(screen.getByRole("alert")).toHaveTextContent("对象格式不正确");
    expect(screen.getByLabelText("结果字段规则")).toHaveValue("{"); expect(change).not.toHaveBeenCalled();
  });

  it("未知或损坏旧配置只读，不允许清除或丢未知键", () => {
    const change = vi.fn();
    const unknown = { ...configured, modelOutput: { ...config, futureField: false } };
    const { rerender } = render(<NodeModelOutputEditor node={unknown} onNodeChange={change} />);
    expect(screen.getByRole("checkbox")).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("已原样保留");
    expect(screen.getByLabelText("原字段规则只读")).toHaveValue(JSON.stringify(unknown.modelOutput, null, 2));
    expect(screen.queryByRole("button", { name: "编辑结果约定" })).not.toBeInTheDocument();
    rerender(<NodeModelOutputEditor node={{ ...configured, modelOutput: { ...config, maxRepairAttempts: 99 } }} onNodeChange={change} />);
    expect(screen.getByRole("checkbox")).toBeDisabled(); expect(change).not.toHaveBeenCalled();
  });

  it("其他类型上的旧约定只读且没有删除入口", () => {
    const change = vi.fn();
    render(<NodeModelOutputEditor node={{ ...configured, type: "tool" }} onNodeChange={change} />);
    expect(screen.getByRole("checkbox")).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("当前步骤类型");
    expect(screen.queryByRole("button", { name: "编辑结果约定" })).not.toBeInTheDocument();
    expect(change).not.toHaveBeenCalled();
  });
});
