import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { KnowledgeList } from "@/features/knowledge/KnowledgeList";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));
vi.mock("@/server/actions/archive-knowledge-source", () => ({ archiveKnowledgeSourceAction: async () => ({ ok: true as const }) }));

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
});
