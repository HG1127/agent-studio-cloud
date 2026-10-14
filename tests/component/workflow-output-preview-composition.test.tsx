import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkflowOutputPreviewInput, WorkflowOutputPreviewResult } from "@/contracts/workflow-output-preview";
import { POST } from "@/app/api/workflows/output-preview/route";
import { WorkflowOutputEditor } from "@/features/workflow-canvas/WorkflowOutputEditor";
import { outputSourceWorkflow } from "../fixtures/output-source-workflow";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function openPreview() {
  await userEvent.click(screen.getByText(/^最终交付字段（/));
  await userEvent.click(screen.getByText("核对来源参考数据（不执行）"));
}
function bridge() {
  const responses: Array<ReturnType<typeof WorkflowOutputPreviewResult.parse>> = [];
  const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    headers.set("origin", "http://localhost");
    const response = await POST(new Request("http://localhost" + String(url), { ...init, headers }));
    responses.push(WorkflowOutputPreviewResult.parse(await response.clone().json()));
    return response;
  });
  vi.stubGlobal("fetch", fetcher);
  return { fetcher, responses };
}

describe("真实来源编辑与只读试算组装", () => {
  it("只展示真实定义采用的来源，组内零和否通过实际只读路由投影，绝不调用保存", async () => {
    const draft = outputSourceWorkflow();
    const { fetcher, responses } = bridge();
    const onChange = vi.fn();
    const storage = vi.spyOn(Storage.prototype, "setItem");
    render(<WorkflowOutputEditor nodes={draft.nodes} fields={draft.outputContract!.fields} workflow={draft} onChange={onChange} />);
    await openPreview();
    const samples = screen.getByRole("list", { name: "交付参考来源" });
    expect(within(samples).getAllByRole("textbox")).toHaveLength(2);
    expect(samples).not.toHaveTextContent("核对材料");
    expect(samples).not.toHaveTextContent("group.child.with.dot");
    fireEvent.change(screen.getByLabelText("整理材料 / 登记材料的参考值"), { target: { value: '{"a.b":[{"金额":0}]}' } });
    fireEvent.change(screen.getByLabelText("分别核对 / 业务核对 / 记录确认的参考值"), { target: { value: '{"确认":false}' } });
    await userEvent.click(screen.getByRole("button", { name: "试算这些参考值" }));
    expect(await screen.findByText("参考结构：数字：0")).toBeVisible();
    expect(screen.getByText("参考结构：是 / 否值：否")).toBeVisible();
    expect(responses).toEqual([{ ok: true, executed: false, scope: "final-delivery-fields", result: { 交付: { 金额: 0, 确认: false } }, fields: [{ path: "交付.金额", status: "provided" }, { path: "交付.确认", status: "provided" }] }]);
    const request = WorkflowOutputPreviewInput.parse(JSON.parse(fetcher.mock.calls[0][1]!.body as string));
    expect(request.workflow).toEqual(draft);
    expect(request.outputs).toEqual({ "group.child.with.dot": { "a.b": [{ 金额: 0 }] }, "parallel.right.check": { 确认: false } });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(onChange).not.toHaveBeenCalled();
    expect(storage).not.toHaveBeenCalled();
  });
  it("真实定义变化即使恢复原配置也不恢复旧试算为有效结果", async () => {
    const draft = outputSourceWorkflow();
    bridge();
    const onChange = vi.fn();
    const view = render(<WorkflowOutputEditor nodes={draft.nodes} fields={draft.outputContract!.fields} workflow={draft} onChange={onChange} />);
    await openPreview();
    fireEvent.change(screen.getByLabelText("整理材料 / 登记材料的参考值"), { target: { value: '{"a.b":[{"金额":0}]}' } });
    fireEvent.change(screen.getByLabelText("分别核对 / 业务核对 / 记录确认的参考值"), { target: { value: '{"确认":false}' } });
    await userEvent.click(screen.getByRole("button", { name: "试算这些参考值" }));
    await screen.findByText("参考结构：数字：0");
    const changed = { ...draft, outputContract: { fields: draft.outputContract!.fields.map((field, index) => index === 0 ? { ...field, sourcePath: ["新层级"] } : field) } };
    view.rerender(<WorkflowOutputEditor nodes={changed.nodes} fields={changed.outputContract.fields} workflow={changed} onChange={onChange} />);
    await waitFor(() => expect(screen.queryByLabelText("本次参考数据试算结果")).not.toBeInTheDocument());
    expect(screen.getByText(/上次结果已过期/)).toBeVisible();
    view.rerender(<WorkflowOutputEditor nodes={draft.nodes} fields={draft.outputContract!.fields} workflow={draft} onChange={onChange} />);
    expect(screen.queryByLabelText("本次参考数据试算结果")).not.toBeInTheDocument();
    expect(screen.getByText(/上次结果已过期/)).toBeVisible();
    expect(screen.getByLabelText("整理材料 / 登记材料的参考值")).toHaveValue('{"a.b":[{"金额":0}]}');
  });
  it("缺少全流程上下文不制造试算流程，未知来源不补成其他步骤", async () => {
    const draft = outputSourceWorkflow();
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const view = render(<WorkflowOutputEditor nodes={draft.nodes} fields={draft.outputContract!.fields} onChange={vi.fn()} />);
    await openPreview();
    expect(screen.getByText(/完整流程草稿暂不可读/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "试算这些参考值" })).not.toBeInTheDocument();
    const unknown = { ...draft, outputContract: { fields: [{ ...draft.outputContract!.fields[0], sourceNodeId: "missing" }] } };
    view.rerender(<WorkflowOutputEditor nodes={unknown.nodes} fields={unknown.outputContract.fields} workflow={unknown} onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "试算这些参考值" })).toBeDisabled();
    expect(screen.queryByRole("list", { name: "交付参考来源" })).not.toBeInTheDocument();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
