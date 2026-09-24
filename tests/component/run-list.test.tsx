import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RunFilters } from "@/features/runs/RunFilters";
import { RunList } from "@/features/runs/RunList";

describe("运行记录", () => {
  it("停用助手的历史运行仍然可见并有明确标记", () => {
    render(<RunList runs={[{
      id: "00000000-0000-4000-8000-000000000001",
      agentId: "00000000-0000-4000-8000-000000000002",
      agentName: "旧版合同助手",
      status: "completed",
      sourceType: "manual",
      agentArchived: true,
      startedAt: "2026-09-24T00:00:00.000Z",
      finishedAt: "2026-09-24T00:01:00.000Z",
    }]} />);
    expect(screen.getByRole("link", { name: /旧版合同助手/ })).toBeInTheDocument();
    expect(screen.getByText("助手已停用")).toBeInTheDocument();
  });

  it("筛选器保留当前条件并提供清除入口", () => {
    render(<RunFilters
      filters={{ status: "failed", sourceType: "schedule", agentId: "00000000-0000-4000-8000-000000000002" }}
      agents={[{ id: "00000000-0000-4000-8000-000000000002", name: "合同助手" }]}
    />);
    expect(screen.getByLabelText("运行状态")).toHaveValue("failed");
    expect(screen.getByLabelText("发起方式")).toHaveValue("schedule");
    expect(screen.getByLabelText("助手")).toHaveValue("00000000-0000-4000-8000-000000000002");
    expect(screen.getByRole("link", { name: "清除筛选" })).toHaveAttribute("href", "/runs");
  });
});
