import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KnowledgeList, UploadSourceForm } from "@/features/knowledge/KnowledgeList";
import { setKnowledgeSourceArchivedAction } from "@/server/actions/archive-knowledge-source";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/server/actions/archive-knowledge-source", () => ({ setKnowledgeSourceArchivedAction: vi.fn(async () => ({ ok: true as const })) }));
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
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

  it("可以归档和恢复资料", async () => {
    const source = {
      id: "00000000-0000-4000-8000-0000000000f3", name: "售后手册.txt", mime: "text/plain",
      sizeBytes: 2048, status: "indexed" as const, chunkCount: 3, charCount: 1200, error: null,
      createdAt: "2026-09-23T00:00:00.000Z",
    };
    const { rerender } = render(<KnowledgeList initial={[source]} />);
    await userEvent.click(screen.getByRole("button", { name: "归档" }));
    expect(setKnowledgeSourceArchivedAction).toHaveBeenCalledWith({ sourceId: source.id, archived: true });

    rerender(<KnowledgeList initial={[{ ...source, status: "archived" }]} archived />);
    await userEvent.click(screen.getByRole("button", { name: "恢复" }));
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

  it("上传请求失败后允许重试", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const { container } = render(<UploadSourceForm />);
    await userEvent.upload(container.querySelector('input[type="file"]')!, new window.File(["退货说明"], "售后手册.txt", { type: "text/plain" }));
    await userEvent.click(screen.getByRole("button", { name: "上传文档" }));
    expect(await screen.findByText("上传失败，请检查网络后重试")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "上传文档" })).toBeEnabled();
  });
});
