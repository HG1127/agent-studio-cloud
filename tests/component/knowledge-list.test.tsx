import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KnowledgeList, UploadSourceForm } from "@/features/knowledge/KnowledgeList";
import { setKnowledgeSourceArchivedAction } from "@/server/actions/archive-knowledge-source";
import { retryKnowledgeSourceAction } from "@/server/actions/retry-knowledge-source";

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
      .mockResolvedValueOnce({ json: async () => ({ ok: true, deduped: true, blobStored: true, source: { ...source, status: "indexed" } }) })
      .mockResolvedValueOnce({ json: async () => ({ ok: true, deduped: true, blobStored: true, source: { ...source, status: "parsing" } }) }));
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
