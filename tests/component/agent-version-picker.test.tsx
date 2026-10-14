import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AgentTargetOption } from "@/contracts/agent";
import { AgentVersionPicker } from "@/features/workflow-canvas/AgentVersionPicker";

const current = AgentTargetOption.parse({ agentId: "00000000-0000-4000-8000-000000000021", agentName: "研究助手", versionId: "00000000-0000-4000-8000-000000000022", version: 2, inputContract: { fields: [] }, outputContract: { fields: [] } });
const previous = "00000000-0000-4000-8000-000000000019";

describe("固定助手版本选择", () => {
  it("已读到的版本显示助手名称和版本，不自动改变绑定", () => {
    const onSelect = vi.fn();
    render(<AgentVersionPicker label="接收助手" targets={[current]} versionId={current.versionId} onSelect={onSelect} />);
    expect(screen.getByLabelText("接收助手")).toHaveValue(current.versionId);
    expect(screen.getByRole("option", { name: "研究助手（版本 2）" })).toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("未显示的固定版本保持选中且不暴露编号，不假定已失效", () => {
    const onSelect = vi.fn();
    const { container } = render(<AgentVersionPicker label="协作助手" targets={[current]} versionId={previous} agentName="原研究助手" onSelect={onSelect} />);
    expect(screen.getByLabelText("协作助手")).toHaveValue(previous);
    expect(screen.getByRole("status")).toHaveTextContent("当前清单未显示不等于版本已失效");
    expect(container.textContent).not.toContain(previous);
    fireEvent.change(screen.getByLabelText("协作助手"), { target: { value: previous } });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("仅明确选择当前清单或清空时回调，不悄悄替换旧版本", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<AgentVersionPicker label="协作助手" targets={[current]} versionId={previous} onSelect={onSelect} />);
    await user.selectOptions(screen.getByLabelText("协作助手"), current.versionId);
    expect(onSelect).toHaveBeenLastCalledWith(current);
    await user.selectOptions(screen.getByLabelText("协作助手"), "");
    expect(onSelect).toHaveBeenLastCalledWith(undefined);
  });

  it("没有可选目标和已有旧绑定是不同状态", () => {
    const { rerender } = render(<AgentVersionPicker label="接收助手" targets={[]} onSelect={vi.fn()} />);
    expect(screen.getByText(/当前没有可选的已发布助手/)).toBeVisible();
    rerender(<AgentVersionPicker label="接收助手" targets={[]} versionId={previous} onSelect={vi.fn()} />);
    expect(screen.queryByText(/当前没有可选的已发布助手/)).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("原绑定已保留");
  });
});
