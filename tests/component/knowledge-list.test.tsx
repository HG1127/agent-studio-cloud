import { StrictMode, useLayoutEffect } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KnowledgeList, UploadSourceForm } from "@/features/knowledge/KnowledgeList";
import { setKnowledgeSourceArchivedAction } from "@/server/actions/archive-knowledge-source";
import { retryKnowledgeSourceAction } from "@/server/actions/retry-knowledge-source";
import { KnowledgeUploadResult, type KnowledgeSourceView } from "@/contracts/knowledge";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/server/actions/archive-knowledge-source", () => ({ setKnowledgeSourceArchivedAction: vi.fn(async () => ({ ok: true as const })) }));
vi.mock("@/server/actions/retry-knowledge-source", () => ({ retryKnowledgeSourceAction: vi.fn(async () => ({ ok: true as const })) }));
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("知识库列表", () => {
  it("空列表显示引导文案，非空列表渲染状态与归档入口", () => {
    render(<KnowledgeList initial={[]} />);
    expect(screen.getByText(/还没有上传过文档/)).toBeInTheDocument();
    render(
      <KnowledgeList
        initial={[{
          id: "00000000-0000-4000-8000-0000000000f3", name: "售后手册.txt", mime: "text/plain",
          sizeBytes: 2048, status: "indexed", chunkCount: 3, charCount: 1200, error: null,
          createdAt: "2026-09-23T00:00:00.000Z",
        }]}
      />,
    );
    expect(screen.getByText("售后手册.txt")).toBeInTheDocument();
    expect(screen.getByText(/已就绪/)).toBeInTheDocument();
    expect(screen.getByText("归档")).toBeInTheDocument();
  });

  it("按文件名查找为空时不误称资料库为空", () => {
    render(<KnowledgeList initial={[]} serverManaged hasFilter />);
    expect(screen.getByText(/没有找到匹配的资料/)).toBeInTheDocument();
    expect(screen.queryByText(/还没有上传过文档/)).not.toBeInTheDocument();
  });

  it("归档后页码失效时保留筛选并引导返回上一页", () => {
    render(<KnowledgeList initial={[]} serverManaged hasFilter emptyPageHref="/knowledge?source=%E5%90%88%E5%90%8C&page=2" />);
    expect(screen.getByText("当前页没有匹配的资料。")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "返回上一页" })).toHaveAttribute("href", "/knowledge?source=%E5%90%88%E5%90%8C&page=2");
    expect(screen.queryByText(/还没有上传过文档/)).not.toBeInTheDocument();
  });

  it("解析中的资料说明需手动核对状态，不把解析中称为可检索", () => {
    render(<KnowledgeList initial={[{
      id: "00000000-0000-4000-8000-0000000000f3", name: "合同库.pdf", mime: "application/pdf",
      sizeBytes: 100, status: "parsing", chunkCount: 0, charCount: 0, error: null,
      createdAt: "2026-09-23T00:00:00.000Z",
    }]} />);
    expect(screen.getByText(/可点页面顶部“重新读取状态”查看结果/)).toBeInTheDocument();
    expect(screen.getByText(/解析就绪后才能用于助手检索/)).toBeInTheDocument();
  });

  it("解析中不会持续轮询整页", () => {
    vi.useFakeTimers();
    render(<KnowledgeList initial={[{
      id: "00000000-0000-4000-8000-0000000000f3", name: "合同库.pdf", mime: "application/pdf",
      sizeBytes: 100, status: "parsing", chunkCount: 0, charCount: 0, error: null,
      createdAt: "2026-09-23T00:00:00.000Z",
    }]} />);
    act(() => vi.advanceTimersByTime(10_000));
    expect(refresh).not.toHaveBeenCalled();
  });

  it("可以归档和恢复资料", async () => {
    const source = {
      id: "00000000-0000-4000-8000-0000000000f3", name: "售后手册.txt", mime: "text/plain",
      sizeBytes: 2048, status: "indexed" as const, chunkCount: 3, charCount: 1200, error: null,
      createdAt: "2026-09-23T00:00:00.000Z",
    };
    const { rerender } = render(<KnowledgeList initial={[source]} />);
    await userEvent.click(screen.getByRole("button", { name: "归档" }));
    expect(screen.getByText(/归档后不再参与助手检索/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "确认归档" }));
    expect(setKnowledgeSourceArchivedAction).toHaveBeenCalledWith({ sourceId: source.id, archived: true });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    rerender(<KnowledgeList initial={[{ ...source, status: "archived" }]} archived />);
    await userEvent.click(screen.getByRole("button", { name: "恢复" }));
    await userEvent.click(screen.getByRole("button", { name: "确认恢复" }));
    expect(setKnowledgeSourceArchivedAction).toHaveBeenLastCalledWith({ sourceId: source.id, archived: false });
  });

  it("归档请求中断时显示错误并允许重试", async () => {
    vi.mocked(setKnowledgeSourceArchivedAction).mockRejectedValueOnce(new Error("offline"));
    render(<KnowledgeList initial={[{
      id: "00000000-0000-4000-8000-0000000000f3", name: "售后手册.txt", mime: "text/plain",
      sizeBytes: 2048, status: "indexed", chunkCount: 3, charCount: 1200, error: null,
      createdAt: "2026-09-23T00:00:00.000Z",
    }]} />);
    await userEvent.click(screen.getByRole("button", { name: "归档" }));
    await userEvent.click(screen.getByRole("button", { name: "确认归档" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("归档资料失败，请检查网络后重试");
    expect(screen.getByRole("button", { name: "归档" })).toBeEnabled();
  });

  it("解析失败时说明可以重新上传重试", () => {
    render(<KnowledgeList initial={[{
      id: "00000000-0000-4000-8000-0000000000f3", name: "损坏资料.txt", mime: "text/plain",
      sizeBytes: 100, status: "failed", chunkCount: 0, charCount: 0, error: "解析超时",
      createdAt: "2026-09-23T00:00:00.000Z",
    }]} />);
    expect(screen.getByText(/重新上传同一文件即可重试/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "重新解析" })).not.toBeInTheDocument();
  });

  it("保留原文件的失败资料可以直接重新解析", async () => {
    const sourceId = "00000000-0000-4000-8000-0000000000f3";
    render(<KnowledgeList initial={[{
      id: sourceId, name: "损坏资料.txt", mime: "text/plain", hasOriginal: true,
      sizeBytes: 100, status: "failed", chunkCount: 0, charCount: 0, error: "解析超时",
      createdAt: "2026-09-23T00:00:00.000Z",
    }]} />);

    expect(screen.getByText(/可直接重新解析/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "重新解析" }));

    expect(retryKnowledgeSourceAction).toHaveBeenCalledWith(sourceId);
    expect(refresh).toHaveBeenCalled();
  });

  it("解析任务中断后停止等待并提供恢复入口", async () => {
    const sourceId = "00000000-0000-4000-8000-0000000000f3";
    render(<KnowledgeList initial={[{
      id: sourceId, name: "合同库.pdf", mime: "application/pdf", hasOriginal: true, parsingStalled: true,
      sizeBytes: 100, status: "parsing", chunkCount: 0, charCount: 0, error: null,
      createdAt: "2026-09-23T00:00:00.000Z",
    }]} />);

    expect(screen.getByText(/解析已中断/)).toBeInTheDocument();
    expect(screen.getByText(/可直接重新解析/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "重新解析" }));

    expect(retryKnowledgeSourceAction).toHaveBeenCalledWith(sourceId);
    expect(refresh).toHaveBeenCalled();
  });

  it("已保存原文件时提供下载入口，未保存时明确说明", () => {
    const source = {
      id: "00000000-0000-4000-8000-0000000000f3", name: "售后手册.txt", mime: "text/plain",
      sizeBytes: 2048, status: "indexed" as const, chunkCount: 3, charCount: 1200, error: null,
      createdAt: "2026-09-23T00:00:00.000Z",
    };
    const { rerender } = render(<KnowledgeList initial={[{ ...source, hasOriginal: true }]} />);
    expect(screen.getByRole("link", { name: "下载原文件" })).toHaveAttribute("href", `/api/knowledge/sources/${source.id}/file`);
    rerender(<KnowledgeList initial={[source]} />);
    expect(screen.getByText("未保留原文件")).toBeInTheDocument();
  });

  it("未保存原文件时明确提示存储缺失", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true, deduped: false, blobStored: false,
        source: {
          id: "00000000-0000-4000-8000-0000000000f3", name: "售后手册.txt", mime: "text/plain",
          sizeBytes: 10, status: "parsing", chunkCount: 0, charCount: 0, error: null,
          createdAt: "2026-09-23T00:00:00.000Z",
        },
      }),
    }));
    const { container } = render(<UploadSourceForm />);
    await userEvent.upload(container.querySelector('input[type="file"]')!, new window.File(["退货说明"], "售后手册.txt", { type: "text/plain" }));
    await userEvent.click(screen.getByRole("button", { name: "上传文档" }));
    expect(await screen.findByRole("status")).toHaveTextContent("原文件尚未保存");
  });

  it("相同文件不重复创建，并按真实解析状态说明是否可检索", async () => {
    const source = {
      id: "00000000-0000-4000-8000-0000000000f3", name: "售后手册.txt", mime: "text/plain",
      sizeBytes: 10, chunkCount: 3, charCount: 1200, error: null, hasOriginal: true,
      createdAt: "2026-09-23T00:00:00.000Z",
    };
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, deduped: true, blobStored: true, source: { ...source, status: "indexed" } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, deduped: true, blobStored: true, source: { ...source, status: "parsing" } }) }));
    const user = userEvent.setup();
    const { container } = render(<UploadSourceForm />);
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    await user.upload(fileInput, new window.File(["退货说明"], "售后手册.txt", { type: "text/plain" }));
    await user.click(screen.getByRole("button", { name: "上传文档" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("这份文件已有记录，未重复创建。当前已就绪，可在资料库中检索。"));
    await user.upload(fileInput, new window.File(["退货说明"], "售后手册.txt", { type: "text/plain" }));
    await user.click(screen.getByRole("button", { name: "上传文档" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("这份文件已有记录，未重复创建。当前正在解析，完成后才能用于资料检索。"));
  });

  it("上传请求响应丢失时提示先核对资料列表", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const { container } = render(<UploadSourceForm />);
    await userEvent.upload(container.querySelector('input[type="file"]')!, new window.File(["退货说明"], "售后手册.txt", { type: "text/plain" }));
    await userEvent.click(screen.getByRole("button", { name: "上传文档" }));
    expect(await screen.findByText(/暂时无法确认是否上传成功/)).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "上传文档" })).toBeEnabled();
  });

  it("上传前拒绝不支持的格式和超大文件", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup({ applyAccept: false });
    const { container } = render(<UploadSourceForm />);
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    await user.upload(input, new window.File(["内容"], "资料.exe", { type: "application/octet-stream" }));
    await user.click(screen.getByRole("button", { name: "上传文档" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("暂不支持这种文件类型");
    expect(fetchMock).not.toHaveBeenCalled();

    await user.upload(input, new window.File([new Uint8Array(4 * 1024 * 1024 + 1)], "资料.pdf", { type: "application/pdf" }));
    await user.click(screen.getByRole("button", { name: "上传文档" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("文件超过 4MB 限制");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("上传前拒绝超长文件名", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { container } = render(<UploadSourceForm />);
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;

    await userEvent.upload(input, new window.File(["内容"], `${"a".repeat(241)}.txt`, { type: "text/plain" }));
    await userEvent.click(screen.getByRole("button", { name: "上传文档" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("文件名不能超过 240 个字符");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("可以按文件名查找资料", async () => {
    const source = {
      id: "00000000-0000-4000-8000-0000000000f3", mime: "text/plain", sizeBytes: 2048,
      status: "indexed" as const, chunkCount: 3, charCount: 1200, error: null,
      createdAt: "2026-09-23T00:00:00.000Z",
    };
    render(<KnowledgeList initial={[{ ...source, name: "售后手册.txt" }, { ...source, id: "00000000-0000-4000-8000-0000000000f4", name: "商品目录.csv" }]} />);
    await userEvent.type(screen.getByRole("searchbox"), "售后");
    expect(screen.getByText("售后手册.txt")).toBeInTheDocument();
    expect(screen.queryByText("商品目录.csv")).not.toBeInTheDocument();
    expect(screen.getByText("共 1 份")).toBeInTheDocument();
  });

  it("超过一页时可以翻页", async () => {
    const sources = Array.from({ length: 21 }, (_, index) => ({
      id: `source-${index}`, name: `资料 ${index + 1}.txt`, mime: "text/plain", sizeBytes: 100,
      status: "indexed" as const, chunkCount: 1, charCount: 80, error: null,
      createdAt: "2026-09-23T00:00:00.000Z",
    }));
    render(<KnowledgeList initial={sources} />);
    expect(screen.getByText("资料 1.txt")).toBeInTheDocument();
    expect(screen.queryByText("资料 21.txt")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "下一页" }));
    expect(screen.getByText("资料 21.txt")).toBeInTheDocument();
    expect(screen.getByText("第 2 / 2 页")).toBeInTheDocument();
  });

  it("服务端分页模式不再对当前页做二次筛选和分页", () => {
    const sources = Array.from({ length: 20 }, (_, index) => ({
      id: `server-source-${index}`, name: `资料 ${index + 1}.txt`, mime: "text/plain", sizeBytes: 100,
      status: "indexed" as const, chunkCount: 1, charCount: 80, error: null,
      createdAt: "2026-09-23T00:00:00.000Z",
    }));
    render(<KnowledgeList initial={sources} serverManaged />);
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("资料列表分页")).not.toBeInTheDocument();
    expect(screen.getByText("资料 20.txt")).toBeInTheDocument();
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function successfulUpload(name = "资料甲.txt", overrides: Partial<KnowledgeSourceView> = {}, deduped = false) {
  return KnowledgeUploadResult.parse({ ok: true, deduped, blobStored: overrides.hasOriginal ?? true,
    source: { id: "00000000-0000-4000-8000-000000000931", name, mime: "text/plain", sizeBytes: 1,
      status: "indexed", chunkCount: 1, charCount: 1, error: null, hasOriginal: true,
      createdAt: "2026-10-12T00:00:00.000Z", ...overrides } });
}
function httpReply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
function CommitUploadReply({ reply }: { reply: () => void }) {
  useLayoutEffect(() => { reply(); }, [reply]);
  return null;
}

describe("资料上传的真实文件会话与回执归属", () => {
  it("同一事件批次只提交一次已捕获文件，选择器与提交同时锁定", async () => {
    const reply = deferred<Response>(); const fetchMock = vi.fn().mockReturnValue(reply.promise);
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup(); render(<UploadSourceForm />);
    const input = screen.getByLabelText<HTMLInputElement>("选择业务资料");
    const file = new window.File(["a"], "资料甲.txt", { type: "text/plain" });
    await user.upload(input, file);
    act(() => { fireEvent.submit(input.form!); fireEvent.submit(input.form!); });
    expect(fetchMock).toHaveBeenCalledOnce(); expect(input).toBeDisabled();
    expect(screen.getByRole("button", { name: "上传中…" })).toBeDisabled();
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/knowledge/sources"); expect(options.method).toBe("POST");
    const submitted = (options.body as FormData).get("file") as File;
    expect(submitted.name).toBe(file.name); expect(submitted.size).toBe(file.size);
    await act(async () => reply.resolve(httpReply(successfulUpload())));
    expect(screen.getByRole("status")).toHaveTextContent("资料已接收。当前已就绪");
    expect(screen.getByText("尚未选择文件")).toBeVisible(); expect(input).toBeEnabled();
    expect(fetchMock).toHaveBeenCalledOnce(); expect(refresh).toHaveBeenCalledOnce();
  });

  it.each(["success", "failure", "unknown"] as const)("pending强制更换同名不同File后旧%s不清空、刷新或冒充新文件结果", async (outcome) => {
    const first = deferred<Response>(); const next = deferred<Response>();
    const fetchMock = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(next.promise); vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup(); render(<UploadSourceForm />);
    const input = screen.getByLabelText<HTMLInputElement>("选择业务资料");
    const oldFile = new window.File(["a"], "同名资料.txt", { type: "text/plain" });
    const newFile = new window.File(["bb"], "同名资料.txt", { type: "text/plain" });
    await user.upload(input, oldFile);
    act(() => { fireEvent.submit(input.form!); fireEvent.change(input, { target: { files: [newFile] } }); fireEvent.submit(input.form!); });
    expect(fetchMock).toHaveBeenCalledOnce(); expect(input).toBeDisabled();
    expect(input.files?.[0]).toBe(newFile);
    expect(screen.getByRole("alert")).toHaveTextContent("后来选择的文件尚未提交");
    const captured = (fetchMock.mock.calls[0][1].body as FormData).get("file") as File;
    expect(captured.name).toBe(oldFile.name); expect(captured.size).toBe(1);
    await act(async () => {
      if (outcome === "unknown") first.reject(new Error("private-old-network-error"));
      else first.resolve(httpReply(outcome === "success" ? successfulUpload(oldFile.name) : { ok: false, error: "private-old-reply" }, outcome === "success" ? 200 : 503));
    });
    expect(input.files?.[0]).toBe(newFile); expect(input).toBeEnabled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).not.toHaveTextContent("private-old"); expect(refresh).not.toHaveBeenCalled();
    fireEvent.submit(input.form!);
    expect(fetchMock).toHaveBeenCalledTimes(2); expect(input).toBeDisabled();
    const submitted = (fetchMock.mock.calls[1][1].body as FormData).get("file") as File;
    expect(submitted.size).toBe(newFile.size);
    await act(async () => next.resolve(httpReply(successfulUpload(newFile.name, { sizeBytes: 2, charCount: 2 }))));
    expect(refresh).toHaveBeenCalledOnce(); expect(screen.getByRole("status")).toHaveTextContent("资料已接收");
  });

  it("选择A→B→同一个A对象的revision仍拒绝旧A回执", async () => {
    const reply = deferred<Response>(); const fetchMock = vi.fn().mockReturnValue(reply.promise); vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup(); render(<UploadSourceForm />);
    const input = screen.getByLabelText<HTMLInputElement>("选择业务资料");
    const a = new window.File(["a"], "资料甲.txt", { type: "text/plain" });
    const b = new window.File(["b"], "资料乙.txt", { type: "text/plain" });
    await user.upload(input, a); fireEvent.submit(input.form!);
    act(() => { fireEvent.change(input, { target: { files: [b] } }); fireEvent.change(input, { target: { files: [a] } }); });
    await act(async () => reply.resolve(httpReply(successfulUpload())));
    expect(input.files?.[0]).toBe(a); expect(input).toBeEnabled();
    expect(screen.getByText(a.name)).toBeVisible(); expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled(); expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("响应已到但json读取仍未完成时改变选择也不能被旧解码结果reset", async () => {
    const body = deferred<unknown>(); const json = vi.fn().mockReturnValue(body.promise);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json }); vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup(); render(<UploadSourceForm />);
    const input = screen.getByLabelText<HTMLInputElement>("选择业务资料");
    await user.upload(input, new window.File(["a"], "资料甲.txt", { type: "text/plain" })); fireEvent.submit(input.form!);
    await waitFor(() => expect(json).toHaveBeenCalledOnce());
    const b = new window.File(["b"], "资料乙.txt", { type: "text/plain" });
    fireEvent.change(input, { target: { files: [b] } });
    await act(async () => body.resolve(successfulUpload()));
    expect(input.files?.[0]).toBe(b); expect(screen.getByText(b.name)).toBeVisible();
    expect(screen.queryByRole("status")).not.toBeInTheDocument(); expect(refresh).not.toHaveBeenCalled();
  });

  it.each(["success", "failure", "unknown"] as const)("StrictMode卸载后旧%s和finally不解锁新实例或触发刷新", async (outcome) => {
    const old = deferred<Response>(); const current = deferred<Response>();
    const fetchMock = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise); vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup(); const view = render(<StrictMode><UploadSourceForm key="old" /></StrictMode>);
    await user.upload(screen.getByLabelText("选择业务资料"), new window.File(["a"], "旧资料.txt", { type: "text/plain" }));
    fireEvent.submit(screen.getByLabelText<HTMLInputElement>("选择业务资料").form!);
    view.rerender(<StrictMode><UploadSourceForm key="new" /></StrictMode>);
    const input = screen.getByLabelText<HTMLInputElement>("选择业务资料");
    await user.upload(input, new window.File(["b"], "新资料.txt", { type: "text/plain" })); fireEvent.submit(input.form!);
    await act(async () => {
      if (outcome === "unknown") old.reject(new Error("private-unmounted-error"));
      else old.resolve(httpReply(outcome === "success" ? successfulUpload("旧资料.txt") : { ok: false, error: "private-unmounted-reply" }, outcome === "success" ? 200 : 503));
    });
    expect(input).toBeDisabled(); expect(screen.getByRole("button", { name: "上传中…" })).toBeDisabled();
    expect(screen.getByText("新资料.txt")).toBeVisible(); expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled(); expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => current.resolve(httpReply(successfulUpload("新资料.txt"))));
    expect(input).toBeEnabled(); expect(refresh).toHaveBeenCalledOnce();
  });

  it("A→B→新A挂载的layout迟到回复不复用旧generation", async () => {
    const reply = deferred<Response>(); const fetchMock = vi.fn().mockReturnValue(reply.promise); vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup(); const view = render(<StrictMode><UploadSourceForm key="a-old" /></StrictMode>);
    await user.upload(screen.getByLabelText("选择业务资料"), new window.File(["a"], "资料甲.txt", { type: "text/plain" }));
    fireEvent.submit(screen.getByLabelText<HTMLInputElement>("选择业务资料").form!);
    view.rerender(<StrictMode><UploadSourceForm key="b" /></StrictMode>);
    await act(async () => view.rerender(<StrictMode><UploadSourceForm key="a-new" /><CommitUploadReply reply={() => reply.resolve(httpReply(successfulUpload()))} /></StrictMode>));
    const input = screen.getByLabelText<HTMLInputElement>("选择业务资料");
    await user.upload(input, new window.File(["new"], "新资料甲.txt", { type: "text/plain" }));
    expect(input).toBeEnabled(); expect(screen.getByText("新资料甲.txt")).toBeVisible();
    expect(screen.queryByRole("status")).not.toBeInTheDocument(); expect(refresh).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([200, 503])("HTTP%s与ok:false只显示失败回执且保留选择，不声称资料或原件未保存、不自动重发", async (status) => {
    const fetchMock = vi.fn().mockResolvedValue(httpReply(KnowledgeUploadResult.parse({ ok: false, error: "资料可能已保存，解析启动状态暂时无法确认" }), status));
    vi.stubGlobal("fetch", fetchMock); const user = userEvent.setup(); render(<UploadSourceForm />);
    const input = screen.getByLabelText<HTMLInputElement>("选择业务资料");
    const file = new window.File(["a"], "资料甲.txt", { type: "text/plain" }); await user.upload(input, file); fireEvent.submit(input.form!);
    expect(await screen.findByRole("alert")).toHaveTextContent("解析启动状态暂时无法确认");
    expect(screen.getByRole("status")).toHaveTextContent("错误回复不能证明资料或原文件未保存");
    expect(screen.getByRole("status")).not.toHaveTextContent("原文件尚未保存");
    expect(input.files?.[0]).toBe(file); expect(input).toBeEnabled(); expect(fetchMock).toHaveBeenCalledOnce();
    expect(refresh).toHaveBeenCalledOnce();
  });

  it.each([403, 503])("非2xx HTTP%s即使夹带合法ok:true也不能当成功、reset或宣称原文件丢失", async (status) => {
    const fetchMock = vi.fn().mockResolvedValue(httpReply(successfulUpload("资料甲.txt", { hasOriginal: false }), status));
    vi.stubGlobal("fetch", fetchMock); const user = userEvent.setup(); render(<UploadSourceForm />);
    const input = screen.getByLabelText<HTMLInputElement>("选择业务资料");
    const file = new window.File(["a"], "资料甲.txt", { type: "text/plain" }); await user.upload(input, file); fireEvent.submit(input.form!);
    expect(await screen.findByRole("alert")).toHaveTextContent("上传结果无法读取");
    expect(screen.getByRole("status")).toHaveTextContent("尚未取得可确认的上传回执");
    expect(screen.getByRole("status")).not.toHaveTextContent("资料已接收"); expect(screen.getByRole("status")).not.toHaveTextContent("原文件尚未保存");
    expect(input.files?.[0]).toBe(file); expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("真实去重允许返回历史资料名称，不把不同文件名误判为错配", async () => {
    const fetchMock = vi.fn().mockResolvedValue(httpReply(successfulUpload("先前登记名称.txt", {}, true))); vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup(); render(<UploadSourceForm />);
    const input = screen.getByLabelText<HTMLInputElement>("选择业务资料");
    await user.upload(input, new window.File(["a"], "后来上传名称.txt", { type: "text/plain" })); fireEvent.submit(input.form!);
    expect(await screen.findByRole("status")).toHaveTextContent("这份文件已有记录，未重复创建。当前已就绪");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument(); expect(screen.getByText("尚未选择文件")).toBeVisible();
    expect(refresh).toHaveBeenCalledOnce(); expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("HTTP成功但共享回执缺项仍是未知，保留原文件且不自动重传", async () => {
    const fetchMock = vi.fn().mockResolvedValue(httpReply({ ok: true, deduped: false, source: { name: "资料甲.txt" } }));
    vi.stubGlobal("fetch", fetchMock); const user = userEvent.setup(); render(<UploadSourceForm />);
    const input = screen.getByLabelText<HTMLInputElement>("选择业务资料");
    const file = new window.File(["a"], "资料甲.txt", { type: "text/plain" });
    await user.upload(input, file); fireEvent.submit(input.form!);
    expect(await screen.findByRole("alert")).toHaveTextContent("上传结果无法读取");
    expect(screen.getByRole("status")).toHaveTextContent("尚未取得可确认的上传回执");
    expect(screen.getByRole("status")).not.toHaveTextContent("资料已接收");
    expect(input.files?.[0]).toBe(file); expect(screen.getByText(file.name)).toBeVisible();
    expect(input).toBeEnabled(); expect(fetchMock).toHaveBeenCalledOnce(); expect(refresh).toHaveBeenCalledOnce();
  });
});
