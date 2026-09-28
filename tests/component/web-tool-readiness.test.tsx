import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { AgentTargetOption } from "@/contracts/agent";
import { WebToolReadiness } from "@/features/web-tools/WebToolReadiness";

const target: AgentTargetOption = {
  agentId: "00000000-0000-4000-8000-000000000001",
  agentName: "客户交付助手",
  versionId: "00000000-0000-4000-8000-000000000002",
  version: 3,
  inputContract: { fields: [{ name: "customerName", label: "客户名称", type: "string", required: true }] },
  outputContract: { fields: [{ path: "summary", label: "交付摘要", required: true }] },
};

describe("网页工具发布准备", () => {
  it("只展示真实正式版本的输入交付字段与未接入边界", () => {
    render(<WebToolReadiness targets={[target]} selectedVersionId={target.versionId} />);
    expect(screen.getByRole("heading", { name: "客户交付助手 · 版本 3" })).toBeVisible();
    expect(within(screen.getByRole("region", { name: "业务输入" })).getByText("客户名称")).toBeVisible();
    expect(within(screen.getByRole("region", { name: "交付字段" })).getByText("交付摘要")).toBeVisible();
    expect(screen.getByRole("heading", { name: "网页填写预览" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "当前不能发布网页工具" })).toBeVisible();
    expect(screen.queryByRole("button", { name: /发布|生成密钥/ })).not.toBeInTheDocument();
  });

  it("失效链接与没有正式版本时不伪造发布来源", () => {
    const { rerender } = render(<WebToolReadiness targets={[target]} selectedVersionId="00000000-0000-4000-8000-000000000099" />);
    expect(screen.getByRole("heading", { name: "找不到这个正式版本" })).toBeVisible();
    expect(screen.queryByText("客户名称")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "网页填写预览" })).not.toBeInTheDocument();
    rerender(<WebToolReadiness targets={[]} selectedVersionId={null} />);
    expect(screen.getByText(/当前没有可核对的正式版本/)).toBeVisible();
    expect(screen.getByRole("link", { name: /查看发布中心/ })).toHaveAttribute("href", "/releases");
  });
});
