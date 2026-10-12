import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/workflows/input-preview/route";
import { NodeInspector } from "@/features/workflow-canvas/NodeInspector";
import { nodeContractWorkflow } from "../fixtures/node-contract-workflow";

const calls: { init: RequestInit; resolve: (response: Response) => void }[] = [];
beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal("fetch", vi.fn((_url: unknown, init: RequestInit) => new Promise<Response>((resolve) => calls.push({ init, resolve }))));
});
afterEach(() => vi.unstubAllGlobals());
async function setup() {
  const workflow = nodeContractWorkflow(), change = vi.fn();
  const props = { node: workflow.nodes.top, workflow, onNodeChange: change, onNodeDelete: vi.fn() };
  const view = render(<NodeInspector {...props} />);
  await userEvent.click(screen.getByLabelText("当前步骤输入与结果约定"));
  const panel = within(await screen.findByRole("region", { name: "当前步骤字段约定" }));
  fireEvent.click(panel.getByRole("button", { name: "开始配置输入映射" }));
  fireEvent.click(panel.getByRole("button", { name: "添加字段映射" }));
  const row = within(panel.getByRole("group", { name: "字段映射 1" }));
  fireEvent.change(row.getByRole("textbox", { name: "目标路径第 1 层" }), { target: { value: "金额" } });
  fireEvent.change(row.getByRole("combobox", { name: "字段来源" }), { target: { value: "literal" } });
  fireEvent.change(row.getByRole("textbox", { name: "固定值（数据格式）" }), { target: { value: "0" } });
  fireEvent.change(panel.getByRole("textbox", { name: "运行输入样例（数据格式）" }), { target: { value: "{}" } });
  fireEvent.click(panel.getByRole("button", { name: "提交样例做只读试算" }));
  return { workflow, change, props, view, panel };
}
async function release(index: number) {
  const headers = new Headers(calls[index].init.headers);
  headers.set("origin", "http://localhost");
  const response = await POST(new Request("http://localhost/api/workflows/input-preview", { ...calls[index].init, headers }));
  await act(async () => calls[index].resolve(response));
}

describe("实际步骤检查器的试算取消接线", () => {
  it("手动取消沿实际父组件传递 AbortSignal，不应用字段、不保存，不接受迟到结果", async () => {
    const { panel, change } = await setup();
    fireEvent.click(panel.getByRole("button", { name: "取消本次试算" }));
    expect(calls[0].init.signal!.aborted).toBe(true);
    expect(panel.getByRole("textbox", { name: "运行输入样例（数据格式）" })).toHaveValue("{}");
    await release(0);
    expect(panel.queryByLabelText("本次只读试算结果")).not.toBeInTheDocument();
    expect(change).not.toHaveBeenCalled(); expect(fetch).toHaveBeenCalledOnce();
  });
  it("完整父草稿改变会取消请求；返回旧定义也不能复活旧回应或擅自再试算", async () => {
    const { props, view, workflow, panel, change } = await setup();
    view.rerender(<NodeInspector {...props} workflow={{ ...workflow, variables: [] }} />);
    expect(calls[0].init.signal!.aborted).toBe(true);
    view.rerender(<NodeInspector {...props} />);
    await release(0);
    expect(panel.queryByLabelText("本次只读试算结果")).not.toBeInTheDocument();
    expect(panel.getByRole("textbox", { name: "固定值（数据格式）" })).toHaveValue("0");
    expect(panel.getByRole("button", { name: "校验并应用到画布草稿" })).toBeDisabled();
    expect(change).not.toHaveBeenCalled(); expect(fetch).toHaveBeenCalledOnce();
  });
  it("父详情卸载真正取消网络等待，不只隐藏加载反馈", async () => {
    const { view, change } = await setup();
    view.unmount();
    expect(calls[0].init.signal!.aborted).toBe(true);
    await release(0);
    expect(screen.queryByLabelText("本次只读试算结果")).not.toBeInTheDocument();
    expect(change).not.toHaveBeenCalled(); expect(fetch).toHaveBeenCalledOnce();
  });
});
