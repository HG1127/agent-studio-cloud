import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkflowDraft, type WorkflowOutputField } from "@/contracts/workflow";
import { MAX_OUTPUT_PREVIEW_BODY_BYTES, MAX_OUTPUT_PREVIEW_RESULT_BYTES, MAX_OUTPUT_PREVIEW_SAMPLES_BYTES, WorkflowOutputPreviewResult } from "@/contracts/workflow-output-preview";
import { POST } from "@/app/api/workflows/output-preview/route";
import { WorkflowOutputPreview } from "@/features/workflow-canvas/WorkflowOutputPreview";
import { prepareWorkflowOutputPreview, requestWorkflowOutputPreview } from "@/features/workflow-canvas/workflow-output-preview-client";

function workflow(fields: WorkflowOutputField[] = [{ path: "交付.正文", label: "交付正文", sourceNodeId: "draft-private", required: true }]) {
  return WorkflowDraft.parse({
    id: "preview-private", rootAgent: { id: "owner-private", name: "核对助手", role: "核对" },
    memoryPolicy: { taskContext: false, longTerm: false },
    nodes: {
      start: { id: "start", type: "trigger", title: "开始", next: "draft-private" },
      "draft-private": { id: "draft-private", type: "system", title: "整理参考内容", next: "done" },
      "other-private": { id: "other-private", type: "system", title: "补充记录", next: "done" },
      done: { id: "done", type: "end", title: "结束", next: null },
    },
    outputContract: { fields },
  });
}
function renderPreview(draft = workflow(), sourceLabels?: Readonly<Record<string, string>>) {
  return render(<WorkflowOutputPreview workflow={draft} sources={[draft.nodes["draft-private"], draft.nodes["other-private"]]} sourceLabels={sourceLabels} />);
}
function input(text: string, label = "整理参考内容的参考值") {
  fireEvent.change(screen.getByLabelText(label), { target: { value: text } });
}
const failure = (code: "invalid_request" | "unavailable" = "invalid_request") =>
  WorkflowOutputPreviewResult.parse({ ok: false, executed: false, scope: "final-delivery-fields", code, error: "内部错误不可作为界面文案", fields: [] });
const success = () => WorkflowOutputPreviewResult.parse({
  ok: true, executed: false, scope: "final-delivery-fields", result: { 交付: { 正文: "仅供参考" } }, fields: [{ path: "交付.正文", status: "provided" }],
});
function bridge() {
  const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    headers.set("origin", "http://localhost");
    return POST(new Request("http://localhost" + String(url), { ...init, headers }));
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => { resolve = done; });
  const fetcher = vi.fn(() => promise);
  vi.stubGlobal("fetch", fetcher);
  return { fetcher, resolve };
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("交付参考数据试算", () => {
  it("空来源与未定义交付明确禁用试算，未填不补示例", () => {
    const draft = workflow();
    const view = render(<WorkflowOutputPreview workflow={draft} sources={[]} />);
    expect(screen.getByText(/当前没有可用的参考来源/)).toBeVisible();
    expect(screen.getByRole("button", { name: "试算这些参考值" })).toBeDisabled();
    view.rerender(<WorkflowOutputPreview workflow={workflow([])} sources={[draft.nodes["draft-private"]]} />);
    expect(screen.getByText(/尚未定义最终交付字段/)).toBeVisible();
    expect(screen.getByRole("button", { name: "试算这些参考值" })).toBeDisabled();
    expect(screen.getByLabelText("整理参考内容的参考值")).toHaveValue("");
    expect(screen.getByText("只试算参考数据，不执行、不保存、不证明真实交付或质量。")).toBeVisible();
  });

  it("通过真实只读接口组合参考数据，来源名称不显示内部标识、不保存浏览器数据", async () => {
    const fetcher = bridge();
    const local = vi.spyOn(Storage.prototype, "setItem");
    renderPreview(workflow(), { "draft-private": "业务组内的参考内容" });
    input('{"summary":"仅供参考"}', "业务组内的参考内容的参考值");
    await userEvent.click(screen.getByRole("button", { name: "试算这些参考值" }));
    const result = await screen.findByLabelText("本次参考数据试算结果");
    expect(result).toHaveTextContent("参考值已采用");
    expect(result).toHaveTextContent("提交时来源：业务组内的参考内容");
    expect(result).toHaveTextContent("对象，包含 1 项");
    const [url, request] = fetcher.mock.calls[0];
    expect(url).toBe("/api/workflows/output-preview");
    expect(request).toMatchObject({ method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error" });
    expect(JSON.parse(request!.body as string).outputs).toEqual({ "draft-private": { summary: "仅供参考" } });
    expect(local).not.toHaveBeenCalled();
    expect(screen.getByLabelText("交付参考来源")).not.toHaveTextContent("draft-private");
  });

  it("实际试算采用数字零和否值，不误报为空", async () => {
    bridge();
    renderPreview(workflow([
      { path: "交付.数量", label: "数量", sourceNodeId: "draft-private", required: true },
      { path: "交付.是否", label: "是否", sourceNodeId: "other-private", required: true },
    ]));
    input("0"); input("false", "补充记录的参考值");
    await userEvent.click(screen.getByRole("button", { name: "试算这些参考值" }));
    expect(await screen.findByText("参考结构：数字：0")).toBeVisible();
    expect(screen.getByText("参考结构：是 / 否值：否")).toBeVisible();
    expect(screen.getAllByText("参考值已采用")).toHaveLength(2);
  });

  it.each(["", "null", '""', "{}", "[]"])("真实缺少必需或空内容反馈并保留参考值：%s", async (value) => {
    const fetcher = bridge(); renderPreview(); input(value);
    await userEvent.click(screen.getByRole("button", { name: "试算这些参考值" }));
    expect(await screen.findByText(/缺少必填参考成果/)).toBeVisible();
    expect(screen.getByText("必填参考值缺失")).toBeVisible();
    expect(screen.getByLabelText("整理参考内容的参考值")).toHaveValue(value);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("可选值未填时真实省略并说明空试算结构", async () => {
    bridge(); renderPreview(workflow([{ path: "交付.记录", label: "可选记录", sourceNodeId: "draft-private", required: false }]));
    await userEvent.click(screen.getByRole("button", { name: "试算这些参考值" }));
    expect(await screen.findByText("可选项已省略")).toBeVisible();
    expect(screen.getByText(/本次试算结构为空/)).toBeVisible();
  });

  it("格式错误只聚焦问题填写区，保留输入且不请求", async () => {
    const fetcher = bridge(); renderPreview(); input('{"未完成":');
    await userEvent.click(screen.getByRole("button", { name: "试算这些参考值" }));
    expect(screen.getByRole("alert")).toHaveTextContent("数据格式不完整");
    expect(screen.getByLabelText("整理参考内容的参考值")).toHaveFocus();
    expect(screen.getByLabelText("整理参考内容的参考值")).toHaveValue('{"未完成":');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("按编码字节拒绝超过参考容量的中文，保留原值", async () => {
    const fetcher = bridge(); renderPreview();
    const value = JSON.stringify("文".repeat(Math.ceil(MAX_OUTPUT_PREVIEW_SAMPLES_BYTES / 3)));
    input(value);
    await userEvent.click(screen.getByRole("button", { name: "试算这些参考值" }));
    expect(screen.getByRole("alert")).toHaveTextContent("超过容量限制");
    expect(screen.getByLabelText("整理参考内容的参考值")).toHaveValue(value);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("真实凭据结果拒绝展示，只采用固定安全提示并保留原填写", async () => {
    bridge(); renderPreview(); input('{"api_key":"test-credential-only"}');
    await userEvent.click(screen.getByRole("button", { name: "试算这些参考值" }));
    expect(await screen.findByText(/包含凭据，已拒绝展示/)).toBeVisible();
    expect(screen.queryByText("核对试算原始结构（开发者数据）")).not.toBeInTheDocument();
    expect(screen.getByLabelText("本次参考数据试算结果")).not.toHaveTextContent("test-credential-only");
    expect(screen.getByLabelText("整理参考内容的参考值")).toHaveValue('{"api_key":"test-credential-only"}');
  });

  it("真实非法来源由接口拒绝，不按样例或字段位置猜测来源", async () => {
    bridge();
    renderPreview(workflow([{ path: "交付.正文", label: "失效来源交付", sourceNodeId: "missing-private", required: true }]));
    input('"参考"');
    await userEvent.click(screen.getByRole("button", { name: "试算这些参考值" }));
    expect(await screen.findByText(/交付来源无法采用/)).toBeVisible();
    expect(screen.getByText(/来源未在当前参考列表中/)).toBeVisible();
    expect(screen.getByLabelText("本次参考数据试算结果")).not.toHaveTextContent("missing-private");
    expect(screen.getByLabelText("整理参考内容的参考值")).toHaveValue('"参考"');
  });

  it("正式成果无效失败保留字段状态，不当作结构已采用", async () => {
    const value = WorkflowOutputPreviewResult.parse({ ...failure(), code: "invalid_result", fields: [{ path: "交付.正文", status: "invalid" }] });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(value, { status: 422 })));
    renderPreview(); input('"参考"');
    await userEvent.click(screen.getByRole("button", { name: "试算这些参考值" }));
    expect(await screen.findByText(/所选成果或组合结果无效/)).toBeVisible();
    expect(screen.getByText("参考值无效")).toBeVisible();
    expect(screen.queryByText("参考值已采用")).not.toBeInTheDocument();
  });

  it("条件参考关联值只放原始结构，不猜测实际运行路径", async () => {
    bridge();
    const draft = workflow();
    draft.nodes["draft-private"].type = "condition";
    renderPreview(draft);
    input('{"matched":"样例","next":"private-path-only"}');
    await userEvent.click(screen.getByRole("button", { name: "试算这些参考值" }));
    await screen.findByText("参考值已采用");
    expect(screen.getByLabelText("提交时交付字段核对")).not.toHaveTextContent("private-path-only");
    const details = screen.getByText("核对试算原始结构（开发者数据）").closest("details")!;
    expect(details).not.toHaveAttribute("open");
    expect(details).toHaveTextContent("private-path-only");
    expect(details).toHaveTextContent("不代表真实执行路径或完成证据");
  });

  it("等待期间只发一次，参考值变更拒用晚响应且不自动重发", async () => {
    const { fetcher, resolve } = deferredResponse(); renderPreview(); input('"原参考"');
    const submit = screen.getByRole("button", { name: "试算这些参考值" });
    await userEvent.dblClick(submit);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "正在试算参考数据…" })).toBeDisabled();
    input('"新参考"');
    expect(screen.getByText(/正在舍弃旧请求/)).toBeVisible();
    await act(async () => resolve(Response.json(success())));
    expect(await screen.findByText(/上次结果已过期/)).toBeVisible();
    expect(screen.queryByText("参考值已采用")).not.toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("整理参考内容的参考值")).toHaveValue('"新参考"');
  });

  it("流程变更拒用晚响应，不将旧字段状态套在新定义上", async () => {
    const { fetcher, resolve } = deferredResponse(); const draft = workflow();
    const view = renderPreview(draft); input('"参考"');
    await userEvent.click(screen.getByRole("button", { name: "试算这些参考值" }));
    const changed = workflow([{ path: "新交付", label: "新交付名称", sourceNodeId: "other-private", required: true }]);
    view.rerender(<WorkflowOutputPreview workflow={changed} sources={[changed.nodes["draft-private"], changed.nodes["other-private"]]} />);
    await act(async () => resolve(Response.json(success())));
    expect(await screen.findByText(/上次结果已过期/)).toBeVisible();
    expect(screen.queryByLabelText("提交时交付字段核对")).not.toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("已取得结果在参考值改变后永久过期，改回原值也不恢复", async () => {
    bridge(); renderPreview(); input('"原参考"');
    await userEvent.click(screen.getByRole("button", { name: "试算这些参考值" }));
    await screen.findByText("参考值已采用");
    input('"新参考"'); input('"原参考"');
    expect(screen.getByText(/上次结果已过期/)).toBeVisible();
    expect(screen.queryByText("参考值已采用")).not.toBeInTheDocument();
  });

  it("来源显示名称变更使旧快照过期，改回原名称也不恢复", async () => {
    bridge(); const draft = workflow();
    const sources = [draft.nodes["draft-private"]];
    const view = render(<WorkflowOutputPreview workflow={draft} sources={sources} sourceLabels={{ "draft-private": "原组内来源" }} />);
    input('"参考"', "原组内来源的参考值");
    await userEvent.click(screen.getByRole("button", { name: "试算这些参考值" }));
    expect(await screen.findByText(/提交时来源：原组内来源/)).toBeVisible();
    view.rerender(<WorkflowOutputPreview workflow={draft} sources={sources} sourceLabels={{ "draft-private": "新组内来源" }} />);
    expect(screen.getByText(/上次结果已过期/)).toBeVisible();
    expect(screen.queryByText(/提交时来源：新组内来源/)).not.toBeInTheDocument();
    view.rerender(<WorkflowOutputPreview workflow={draft} sources={sources} sourceLabels={{ "draft-private": "原组内来源" }} />);
    expect(screen.getByText(/上次结果已过期/)).toBeVisible();
    expect(screen.queryByLabelText("提交时交付字段核对")).not.toBeInTheDocument();
    expect(screen.getByLabelText("原组内来源的参考值")).toHaveValue('"参考"');
  });

  it("来源变更不清除保留的参考值，恢复同一来源后仍能核对原填写", () => {
    const draft = workflow();
    const view = renderPreview(draft); input('"参考"');
    view.rerender(<WorkflowOutputPreview workflow={draft} sources={[draft.nodes["other-private"]]} />);
    expect(screen.queryByLabelText("整理参考内容的参考值")).not.toBeInTheDocument();
    view.rerender(<WorkflowOutputPreview workflow={draft} sources={[draft.nodes["draft-private"]]} />);
    expect(screen.getByLabelText("整理参考内容的参考值")).toHaveValue('"参考"');
  });

  it("取消立即解锁保留原值，晚响应不恢复结果或自动重发", async () => {
    const { fetcher, resolve } = deferredResponse(); renderPreview(); input('"原参考"');
    await userEvent.click(screen.getByRole("button", { name: "试算这些参考值" }));
    await userEvent.click(screen.getByRole("button", { name: "取消本次试算" }));
    expect(screen.getByRole("alert")).toHaveTextContent("已取消本次试算");
    expect(screen.getByRole("button", { name: "试算这些参考值" })).toBeEnabled();
    await act(async () => resolve(Response.json(success())));
    expect(screen.queryByText("参考值已采用")).not.toBeInTheDocument();
    expect(screen.getByLabelText("整理参考内容的参考值")).toHaveValue('"原参考"');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("清除有确认，取消保留原值，确认清除结果并返回焦点", async () => {
    bridge(); renderPreview(); input('"参考"');
    await userEvent.click(screen.getByRole("button", { name: "试算这些参考值" }));
    await screen.findByText("参考值已采用");
    await userEvent.click(screen.getByRole("button", { name: "清除参考值" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "返回" }));
    expect(screen.getByLabelText("整理参考内容的参考值")).toHaveValue('"参考"');
    expect(screen.getByRole("button", { name: "清除参考值" })).toHaveFocus();
    await userEvent.click(screen.getByRole("button", { name: "清除参考值" }));
    await userEvent.click(screen.getByRole("button", { name: "确认清除参考值" }));
    expect(screen.getByLabelText("整理参考内容的参考值")).toHaveValue("");
    expect(screen.queryByText("参考值已采用")).not.toBeInTheDocument();
  });

  it("确认清除期间参考值改变会拒绝旧确认并保留原值", async () => {
    renderPreview(); input('"参考"');
    await userEvent.click(screen.getByRole("button", { name: "清除参考值" }));
    const view = screen.getByLabelText("整理参考内容的参考值");
    fireEvent.change(view, { target: { value: '"变更参考"' } });
    await userEvent.click(screen.getByRole("button", { name: "确认清除参考值" }));
    expect(screen.getByRole("alert")).toHaveTextContent("请重新确认清除");
    expect(view).toHaveValue('"变更参考"');
  });

  it("网络异常不暴露原始错误，不删除填写或自动重发", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("private-server-error"));
    vi.stubGlobal("fetch", fetcher); renderPreview(); input('"参考"');
    await userEvent.click(screen.getByRole("button", { name: "试算这些参考值" }));
    expect(await screen.findByText(/试算连接中断/)).toBeVisible();
    expect(screen.getByLabelText("本次参考数据试算结果")).not.toHaveTextContent("private-server-error");
    expect(screen.getByLabelText("整理参考内容的参考值")).toHaveValue('"参考"');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("契约合法但缺少字段状态时显示未知，不凭返回成功推断字段已采用", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ...success(), fields: [] })));
    renderPreview(); input('"参考"');
    await userEvent.click(screen.getByRole("button", { name: "试算这些参考值" }));
    expect(await screen.findByText("未返回可核对的字段状态")).toBeVisible();
    expect(screen.queryByText("参考值已采用")).not.toBeInTheDocument();
  });
});

describe("唯一契约与有界只读请求", () => {
  it("样例合计和完整请求分别使用真实容量常量", () => {
    const draft = workflow();
    const sources = [draft.nodes["draft-private"], draft.nodes["other-private"]];
    const half = JSON.stringify("a".repeat(MAX_OUTPUT_PREVIEW_SAMPLES_BYTES / 2));
    expect(prepareWorkflowOutputPreview(draft, sources, { "draft-private": half, "other-private": half })).toMatchObject({ ok: false, error: expect.stringContaining("合计") });
    const large = { ...draft, intentSource: { text: "a".repeat(MAX_OUTPUT_PREVIEW_BODY_BYTES - 1000) } };
    expect(prepareWorkflowOutputPreview(large, sources, { "draft-private": JSON.stringify("a".repeat(2000)) })).toMatchObject({ ok: false });
  });

  it("非法深层数据和保留字段由唯一输入契约拒绝", () => {
    const draft = workflow(); const sources = [draft.nodes["draft-private"]];
    expect(prepareWorkflowOutputPreview(draft, sources, { "draft-private": '{"__proto__":{"value":"不能采用"}}' })).toMatchObject({ ok: false });
    let deep: unknown = "参考";
    for (let index = 0; index < 35; index++) deep = { item: deep };
    expect(prepareWorkflowOutputPreview(draft, sources, { "draft-private": JSON.stringify(deep) })).toMatchObject({ ok: false });
  });

  it.each([
    [403, failure(), "forbidden"],
    [503, failure("unavailable"), "unavailable"],
  ] as const)("正式 HTTP %s 失败先解析契约并提供对应反馈", async (status, value, expected) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(value, { status })));
    if (expected === "forbidden") await expect(requestWorkflowOutputPreview("{}", new AbortController().signal)).rejects.toMatchObject({ reason: expected });
    else expect(await requestWorkflowOutputPreview("{}", new AbortController().signal)).toEqual(value);
  });

  it("HTTP 200 的正式失败保持失败，非 200 的成功载荷不声称成功", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json(failure())).mockResolvedValueOnce(Response.json(success(), { status: 503 }));
    vi.stubGlobal("fetch", fetcher);
    expect(await requestWorkflowOutputPreview("{}", new AbortController().signal)).toEqual(failure());
    await expect(requestWorkflowOutputPreview("{}", new AbortController().signal)).rejects.toMatchObject({ reason: "unavailable" });
  });

  it.each([
    { ...success(), executed: true }, { ...success(), scope: "whole-workflow" },
    { ok: true }, { ...failure(), error: "" },
  ])("错误范围、真实执行标记或无效结果都拒绝采用", async (value) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(value)));
    await expect(requestWorkflowOutputPreview("{}", new AbortController().signal)).rejects.toMatchObject({ reason: "unknown" });
  });

  it.each([403, 503])("HTTP %s 未知正文不进入界面，保留状态码反馈", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("private-error", { status })));
    await expect(requestWorkflowOutputPreview("{}", new AbortController().signal)).rejects.toMatchObject({ reason: status === 403 ? "forbidden" : "unavailable" });
  });

  it.each([true, false])("响应容量同时检查声明与实际流，不依赖声明：%s", async (declared) => {
    const response = new Response("a".repeat(MAX_OUTPUT_PREVIEW_RESULT_BYTES + 1), declared ? { headers: { "content-length": String(MAX_OUTPUT_PREVIEW_RESULT_BYTES + 1) } } : {});
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    await expect(requestWorkflowOutputPreview("{}", new AbortController().signal)).rejects.toMatchObject({ reason: "capacity" });
    expect(response.body?.locked).toBe(false);
  });

  it("非完整编码与空响应为未知，预先取消不发送请求", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(new Uint8Array([0xff]))).mockResolvedValueOnce(new Response(null));
    vi.stubGlobal("fetch", fetcher);
    await expect(requestWorkflowOutputPreview("{}", new AbortController().signal)).rejects.toMatchObject({ reason: "unknown" });
    await expect(requestWorkflowOutputPreview("{}", new AbortController().signal)).rejects.toMatchObject({ reason: "unknown" });
    const controller = new AbortController(); controller.abort();
    await expect(requestWorkflowOutputPreview("{}", controller.signal)).rejects.toMatchObject({ reason: "cancelled" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
