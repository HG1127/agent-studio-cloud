import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { KnowledgeSearch } from "@/features/knowledge/KnowledgeSearch";

describe("知识检索验证", () => {
  it("展示命中资料与摘录，并保留检索词", () => {
    render(<KnowledgeSearch result={{
      query: "退货期限",
      truncated: false,
      hits: [{
        sourceId: "00000000-0000-4000-8000-0000000000f3",
        sourceName: "售后手册.txt",
        chunkIndex: 1,
        excerpt: "客户签收后七天内可以申请退货。",
        score: 4.5,
      }],
    }} />);
    expect(screen.getByLabelText("检索关键词")).toHaveValue("退货期限");
    expect(screen.getByRole("status")).toHaveTextContent("找到 1 段相关内容");
    expect(screen.getByText("售后手册.txt · 第 2 段")).toBeInTheDocument();
    expect(screen.getByText(/七天内可以申请退货/)).toBeInTheDocument();
  });

  it("零命中和扫描范围受限时给出明确说明", () => {
    render(<KnowledgeSearch result={{ query: "不存在的规则", hits: [], truncated: true }} />);
    expect(screen.getByRole("status")).toHaveTextContent("没有找到相关内容");
    expect(screen.getByText(/只检查最近入库的 2000 段内容/)).toBeInTheDocument();
  });
});
