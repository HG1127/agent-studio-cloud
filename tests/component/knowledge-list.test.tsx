import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KnowledgeList, UploadSourceForm } from "@/features/knowledge/KnowledgeList";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));
vi.mock("@/server/actions/archive-knowledge-source", () => ({ archiveKnowledgeSourceAction: async () => ({ ok: true as const }) }));
afterEach(() => vi.unstubAllGlobals());

describe("知识库列表", () => {
  it("空列表显示引导文案，非空列表渲染状态与删除入口", () => {
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
    expect(screen.getByText("删除")).toBeInTheDocument();
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
