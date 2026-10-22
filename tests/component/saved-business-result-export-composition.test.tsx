import { StrictMode, type ComponentProps } from "react";
import { flushSync } from "react-dom";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { RunView, RunStepView } from "@/contracts/run";
import { SavedBusinessResultExport } from "@/features/runs/SavedBusinessResultExport";

const tracked = vi.hoisted(() => ({ clientProps: vi.fn() }));
vi.mock("@/features/runs/BusinessResultExportButtons", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/runs/BusinessResultExportButtons")>();
  return { BusinessResultExportButtons: (props: ComponentProps<typeof actual.BusinessResultExportButtons>) => {
    tracked.clientProps(props);
    return <actual.BusinessResultExportButtons {...props} />;
  } };
});
const runId = "00000000-0000-4000-8000-000000000121";
const agentId = "00000000-0000-4000-8000-000000000122";
const versionId = "00000000-0000-4000-8000-000000000123";
const stepId = "00000000-0000-4000-8000-000000000124";
const date = new Date("2026-10-10T02:00:00.000Z");
function run(body = "本页已保存业务正文") {
  return RunView.parse({
    id: runId, agentId, versionId, agentName: "不发送到下载按钮的助手名", status: "completed", sourceType: "manual",
    input: { password: "private-input" }, error: "private-run-error", startedAt: null, finishedAt: null,
    result: { report: body, private_unselected: "private-developer-data" },
    outputContract: { fields: [{ path: "report", label: "业务正文", required: true }] },
  });
}
const capturedBlobs: { parts: BlobPart[]; type: string }[] = [];
const capturedLinks: { filename: string; href: string; connected: boolean }[] = [];
const createUrl = vi.fn(); const revokeUrl = vi.fn();
let click: MockInstance<() => void>;

beforeEach(() => {
  vi.useFakeTimers(); tracked.clientProps.mockReset(); createUrl.mockReset(); revokeUrl.mockReset();
  capturedBlobs.length = 0; capturedLinks.length = 0;
  const BrowserBlob = Blob; const BrowserUrl = URL;
  vi.stubGlobal("Blob", class extends BrowserBlob {
    constructor(parts: BlobPart[] = [], options: BlobPropertyBag = {}) {
      super(parts, options); capturedBlobs.push({ parts, type: options.type ?? "" });
    }
  });
  vi.stubGlobal("URL", class extends BrowserUrl {
    static createObjectURL = createUrl; static revokeObjectURL = revokeUrl;
  });
  createUrl.mockImplementation(() => "blob:manual-export-" + String(createUrl.mock.calls.length));
  click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    capturedLinks.push({ filename: this.download, href: this.href, connected: this.isConnected });
  });
});
afterEach(() => {
  vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});
function blobText(index: number) {
  expect(capturedBlobs[index].parts.every((part) => typeof part === "string")).toBe(true);
  return capturedBlobs[index].parts.join("");
}

describe("真实服务端导出叶子→真实下载按钮（未执行作者规格）", () => {
  it("StrictMode渲染不下载、不生成URL；客户端边界只得到安全MD/CSV字符串", () => {
    render(<StrictMode><SavedBusinessResultExport run={run("联系 buyer@example.test，密钥 sk-privatecredential123456")} /></StrictMode>);
    expect(screen.getByRole("button", { name: "导出业务成果文档" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "导出交付内容清单" })).toBeEnabled();
    expect(screen.getByText(/不转换成有业务含义的数据表/)).toBeVisible();
    expect(createUrl).not.toHaveBeenCalled(); expect(click).not.toHaveBeenCalled(); expect(capturedBlobs).toHaveLength(0);
    const props = tracked.clientProps.mock.lastCall?.[0];
    expect(Object.keys(props).sort()).toEqual(["csv", "markdown"]);
    expect(typeof props.markdown).toBe("string"); expect(typeof props.csv).toBe("string");
    expect(JSON.stringify(props)).not.toMatch(/buyer@example.test|sk-privatecredential123456|private-input|private-run-error|private-developer-data|不发送到下载按钮/);
    expect(JSON.stringify(props)).not.toContain(runId); expect(JSON.stringify(props)).not.toContain(agentId);
    expect(JSON.stringify(props)).not.toContain(versionId); expect(JSON.stringify(props)).not.toContain('"report"');
  });

  it("每个真实按钮只在手动点击创建对应Blob、固定中文文件名，并如实说明只发起下载", () => {
    render(<SavedBusinessResultExport run={run()} />);
    fireEvent.click(screen.getByRole("button", { name: "导出业务成果文档" }));
    expect(createUrl).toHaveBeenCalledOnce(); expect(click).toHaveBeenCalledOnce();
    expect(createUrl.mock.calls[0][0]).toBeInstanceOf(Blob);
    expect(capturedBlobs[0].type).toBe("text/markdown;charset=utf-8");
    expect(blobText(0)).toContain("本页已保存业务正文");
    expect(capturedLinks[0]).toEqual({ filename: "已保存业务成果.md", href: "blob:manual-export-1", connected: true });
    expect(screen.getByRole("status")).toHaveTextContent("本页不能确认文件是否已保存");
    expect(document.querySelector('a[download]')).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "导出交付内容清单" }));
    expect(createUrl).toHaveBeenCalledTimes(2); expect(click).toHaveBeenCalledTimes(2);
    expect(capturedBlobs[1].type).toBe("text/csv;charset=utf-8");
    expect(blobText(1)).toContain('"记录状态","交付内容","已保存内容"');
    expect(capturedLinks[1].filename).toBe("交付内容清单.csv");
    expect(revokeUrl).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1000));
    expect(revokeUrl.mock.calls.map((call) => call[0])).toEqual(["blob:manual-export-1", "blob:manual-export-2"]);
    expect(createUrl).toHaveBeenCalledTimes(2);
  });

  it.each(["create-url", "click", "append"] as const)("浏览器%s 失败显示真实失败，已创建URL立即尝试释放，不称已保存文件", (failure) => {
    render(<SavedBusinessResultExport run={run()} />);
    if (failure === "create-url") createUrl.mockImplementationOnce(() => { throw new Error("unsupported browser"); });
    if (failure === "click") click.mockImplementationOnce(() => { throw new Error("blocked download"); });
    if (failure === "append") vi.spyOn(document.body, "appendChild").mockImplementationOnce(() => { throw new Error("cannot attach"); });
    fireEvent.click(screen.getByRole("button", { name: "导出业务成果文档" }));
    expect(screen.getByRole("alert")).toHaveTextContent("暂时无法发起下载");
    expect(screen.getByRole("alert")).toHaveTextContent("未重新创建任务或修改保存结果");
    expect(screen.queryByText(/已发起下载/)).not.toBeInTheDocument();
    if (failure === "create-url") expect(revokeUrl).not.toHaveBeenCalled();
    else expect(revokeUrl).toHaveBeenCalledExactlyOnceWith("blob:manual-export-1");
    act(() => vi.advanceTimersByTime(2000));
    expect(createUrl).toHaveBeenCalledOnce();
    expect(document.querySelector('a[download]')).toBeNull();
  });

  it("下载失败可手动重试，不在错误、计时器或重渲染时自动下载", () => {
    createUrl.mockImplementationOnce(() => { throw new Error("first attempt failed"); });
    const rendered = render(<SavedBusinessResultExport run={run()} />);
    fireEvent.click(screen.getByRole("button", { name: "导出交付内容清单" }));
    expect(screen.getByRole("alert")).toBeVisible();
    rendered.rerender(<SavedBusinessResultExport run={run()} />);
    act(() => vi.advanceTimersByTime(2000));
    expect(createUrl).toHaveBeenCalledOnce(); expect(click).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "导出交付内容清单" }));
    expect(createUrl).toHaveBeenCalledTimes(2); expect(click).toHaveBeenCalledOnce();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("已发起下载");
  });

  it("结果A→B→A更新只使用当次安全文字，释放旧URL并清旧回执；无自动下载", () => {
    const rendered = render(<StrictMode><SavedBusinessResultExport run={run("A的原保存正文")} /></StrictMode>);
    fireEvent.click(screen.getByRole("button", { name: "导出业务成果文档" }));
    expect(blobText(0)).toContain("A的原保存正文");
    rendered.rerender(<StrictMode><SavedBusinessResultExport run={run("B的新保存正文")} /></StrictMode>);
    expect(screen.queryByText(/已发起下载/)).not.toBeInTheDocument();
    expect(revokeUrl).toHaveBeenCalledExactlyOnceWith("blob:manual-export-1");
    expect(createUrl).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "导出交付内容清单" }));
    expect(blobText(1)).toContain("B的新保存正文"); expect(blobText(1)).not.toContain("A的原保存正文");
    rendered.rerender(<StrictMode><SavedBusinessResultExport run={run("A的新保存正文")} /></StrictMode>);
    expect(screen.queryByText(/已发起下载/)).not.toBeInTheDocument();
    expect(revokeUrl).toHaveBeenCalledTimes(2); expect(createUrl).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "导出业务成果文档" }));
    expect(blobText(2)).toContain("A的新保存正文"); expect(blobText(2)).not.toContain("A的原保存正文");
    act(() => vi.advanceTimersByTime(2000));
    expect(createUrl).toHaveBeenCalledTimes(3);
    expect(screen.getByRole("status")).toHaveTextContent("已发起下载");
    expect(revokeUrl).toHaveBeenCalledTimes(3);
  });

  it("不同任务的安全文本完全相同时仍隔离下载回执并释放旧URL，切换不自动下载", () => {
    const first = run(); const second = { ...run(), id: "00000000-0000-4000-8000-000000000125" };
    const rendered = render(<StrictMode><SavedBusinessResultExport run={first} /></StrictMode>);
    const firstProps = tracked.clientProps.mock.lastCall?.[0];
    fireEvent.click(screen.getByRole("button", { name: "导出业务成果文档" }));
    expect(screen.getByRole("status")).toHaveTextContent("已发起下载");
    rendered.rerender(<StrictMode><SavedBusinessResultExport run={second} /></StrictMode>);
    expect(tracked.clientProps.mock.lastCall?.[0]).toEqual(firstProps);
    expect(Object.keys(tracked.clientProps.mock.lastCall?.[0]).sort()).toEqual(["csv", "markdown"]);
    expect(screen.queryByText(/已发起下载/)).not.toBeInTheDocument();
    expect(revokeUrl).toHaveBeenCalledExactlyOnceWith("blob:manual-export-1");
    expect(createUrl).toHaveBeenCalledOnce(); expect(click).toHaveBeenCalledOnce();
    rendered.rerender(<StrictMode><SavedBusinessResultExport run={first} /></StrictMode>);
    expect(screen.queryByText(/已发起下载/)).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(2000));
    expect(revokeUrl).toHaveBeenCalledOnce(); expect(createUrl).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "导出交付内容清单" }));
    expect(createUrl).toHaveBeenCalledTimes(2); expect(click).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("status")).toHaveTextContent("已发起下载");
    expect(blobText(0)).not.toContain(first.id); expect(blobText(1)).not.toContain(second.id);
  });

  it("手动下载的浏览器回调中同步换来源，旧处理不覆盖新页面回执或保留旧URL", () => {
    const rendered = render(<SavedBusinessResultExport run={run("旧已保存正文")} />);
    click.mockImplementationOnce(() => flushSync(() => rendered.rerender(<SavedBusinessResultExport run={run("新已保存正文")} />)));
    fireEvent.click(screen.getByRole("button", { name: "导出业务成果文档" }));
    expect(blobText(0)).toContain("旧已保存正文");
    expect(screen.queryByText(/已发起下载/)).not.toBeInTheDocument();
    expect(revokeUrl).toHaveBeenCalledExactlyOnceWith("blob:manual-export-1");
    expect(createUrl).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "导出交付内容清单" }));
    expect(blobText(1)).toContain("新已保存正文"); expect(blobText(1)).not.toContain("旧已保存正文");
    expect(screen.getByRole("status")).toHaveTextContent("已发起下载");
  });

  it("卸载立即尝试释放待回收URL，旧计时器不再次释放或自动操作", () => {
    const rendered = render(<SavedBusinessResultExport run={run()} />);
    fireEvent.click(screen.getByRole("button", { name: "导出业务成果文档" }));
    rendered.unmount();
    expect(revokeUrl).toHaveBeenCalledExactlyOnceWith("blob:manual-export-1");
    act(() => vi.advanceTimersByTime(2000));
    expect(revokeUrl).toHaveBeenCalledOnce(); expect(createUrl).toHaveBeenCalledOnce(); expect(click).toHaveBeenCalledOnce();
  });

  it("任一项未知即没有下载按钮或安全文本client props，不把另一项/说明当完整成果", () => {
    const saved = RunView.parse({ ...run(), result: { first: "真实第一项", second: "<think>private-unfinished" }, outputContract: { fields: [
      { path: "first", label: "第一项", required: true }, { path: "second", label: "第二项", required: true },
    ] } });
    render(<SavedBusinessResultExport run={saved} />);
    expect(screen.getByRole("status")).toHaveTextContent("整份导出已停用");
    expect(screen.queryByRole("button", { name: /导出/ })).not.toBeInTheDocument();
    expect(tracked.clientProps).not.toHaveBeenCalled(); expect(createUrl).not.toHaveBeenCalled();
    expect(screen.queryByText("真实第一项")).not.toBeInTheDocument();
    expect(screen.queryByText("private-unfinished")).not.toBeInTheDocument();
  });

  it("步骤不可读即不使用误附证据核对内部路由，不跨到真实动作、接口或报告下载", () => {
    const saved = RunView.parse({ ...run(), result: { report: { matched: "判断已保存", next: "private-target" } }, outputContract: { fields: [{ path: "report", label: "判断结果", required: true, sourceNodeId: "private-source" }] } });
    const source = RunStepView.parse({ id: stepId, runId, nodeId: "private-source", nodeType: "condition", nodeTitle: "不可读来源", output: saved.result && (saved.result as Record<string, unknown>).report, status: "succeeded", attempt: 1, error: null, startedAt: date, finishedAt: date, createdAt: date, updatedAt: date });
    render(<SavedBusinessResultExport run={saved} steps={[source]} stepsUnavailable />);
    expect(screen.getByRole("status")).toHaveTextContent("整份导出已停用");
    expect(tracked.clientProps).not.toHaveBeenCalled(); expect(createUrl).not.toHaveBeenCalled();
    expect(screen.queryByText(/不可读来源|private-target|private-source/)).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("自动验收完成也只展示真实中文记录状态，未添加修订、人工验收或安全模拟能力", () => {
    render(<SavedBusinessResultExport run={{ ...run(), sourceType: "evaluation" }} />);
    expect(screen.getByText(/运行已完成；自动验收发起/)).toHaveTextContent("完成状态不等于通过验收");
    expect(screen.getByText(/运行已完成；自动验收发起/)).toHaveTextContent("不代表安全模拟或外部业务未执行");
    expect(screen.queryByRole("button", { name: /验收|修订|重新运行/ })).not.toBeInTheDocument();
    expect(createUrl).not.toHaveBeenCalled();
  });
});
