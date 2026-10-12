import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AgentTargetOption } from "@/contracts/agent";
import { WebToolReadiness } from "@/features/web-tools/WebToolReadiness";

vi.mock("@/server/actions/start-run-task", () => ({ startRunTaskAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const target: AgentTargetOption = {
  agentId: "00000000-0000-4000-8000-000000000001",
  agentName: "客户交付助手",
  versionId: "00000000-0000-4000-8000-000000000002",
  version: 3,
  inputContract: { fields: [{ name: "customerName", label: "客户名称", type: "string", required: true }] },
  outputContract: { fields: [{ path: "summary", label: "交付摘要", required: true }] },
};

describe("网页工具发布准备", () => {
  it("只读核对入口锁定当前选择版本并能返回网页工具，不改变正式版本", () => {
    const { rerender } = render(<WebToolReadiness sourceStatus="production" targets={[target]} selectedVersionId={target.versionId} />);
    expect(screen.getByRole("link", { name: "只读核对这个版本的流程" })).toHaveAttribute("href",
      `/agents/${target.agentId}/versions/${target.versionId}?source=web-tools`);
    rerender(<WebToolReadiness sourceStatus="production" targets={[target]} selectedVersionId="00000000-0000-4000-8000-000000000099" />);
    expect(screen.queryByRole("link", { name: "只读核对这个版本的流程" })).not.toBeInTheDocument();
  });
  it("只展示真实正式版本的输入交付字段与未接入边界", () => {
    render(<WebToolReadiness sourceStatus="production" targets={[target]} selectedVersionId={target.versionId} />);
    expect(screen.getByRole("heading", { name: "客户交付助手 · 版本 3" })).toBeVisible();
    expect(within(screen.getByRole("region", { name: "业务输入" })).getByText("客户名称")).toBeVisible();
    expect(within(screen.getByRole("region", { name: "交付字段" })).getByText("交付摘要")).toBeVisible();
    expect(screen.getByRole("heading", { name: "网页填写预览" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "交付布局预览" })).toBeVisible();
    expect(screen.getByRole("region", { name: "内部试运行" })).toHaveTextContent("本次将指定本页选定的版本 3");
    expect(screen.getByRole("region", { name: "内部试运行" })).toHaveTextContent("创建记录不等于已执行、已完成或通过验收");
    expect(screen.getByRole("heading", { name: "当前不能发布网页工具" })).toBeVisible();
    expect(screen.queryByRole("button", { name: /发布|生成密钥/ })).not.toBeInTheDocument();
  });

  it("缺少或空白业务名称时使用中文顺序标签，不展示内部字段和路径", () => {
    const unnamed: AgentTargetOption = { ...target, inputContract: { fields: [{ name: "privateInput", label: "  ", required: true, type: "string" }] }, outputContract: { fields: [{ path: "privateStep.internalResult", required: true }] } };
    const { container } = render(<WebToolReadiness sourceStatus="production" targets={[unnamed]} selectedVersionId={target.versionId} />);
    expect(within(screen.getByRole("region", { name: "业务输入" })).getByText("业务信息 1")).toBeVisible();
    expect(within(screen.getByRole("region", { name: "交付字段" })).getByText("交付内容 1")).toBeVisible();
    expect(container.textContent).not.toContain("privateInput");
    expect(container.textContent).not.toContain("privateStep");
  });

  it("输入和交付契约分别核对，格式错误不补出字段或对应预览", () => {
    const { rerender } = render(<WebToolReadiness sourceStatus="production" targets={[{ ...target, inputContract: { fields: [{ name: "invalid field", required: true, type: "string" }] } }]} selectedVersionId={target.versionId} />);
    expect(screen.getByText(/输入契约暂时无法读取/)).toBeVisible();
    expect(screen.queryByRole("heading", { name: "网页填写预览" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "内部试运行" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "交付布局预览" })).toBeVisible();
    rerender(<WebToolReadiness sourceStatus="production" targets={[{ ...target, outputContract: { fields: [{ path: "", required: true }] } }]} selectedVersionId={target.versionId} />);
    expect(screen.getByText(/交付契约暂时无法读取/)).toBeVisible();
    expect(screen.queryByRole("heading", { name: "交付布局预览" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "网页填写预览" })).toBeVisible();
  });

  it("失效链接与没有正式版本时不伪造发布来源", () => {
    const { rerender } = render(<WebToolReadiness sourceStatus="production" targets={[target]} selectedVersionId="00000000-0000-4000-8000-000000000099" />);
    expect(screen.getByRole("heading", { name: "找不到所选版本" })).toBeVisible();
    expect(screen.queryByText("客户名称")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "网页填写预览" })).not.toBeInTheDocument();
    rerender(<WebToolReadiness sourceStatus="production" targets={[]} selectedVersionId={null} />);
    expect(screen.getByText(/当前没有可核对的正式版本/)).toBeVisible();
    expect(screen.getByRole("link", { name: /查看发布中心/ })).toHaveAttribute("href", "/releases");
  });
});
