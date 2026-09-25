import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AuditEventList } from "@/features/activity/AuditEventList";

describe("操作记录列表", () => {
  it("用中文标签展示知识与经验状态变更", () => {
    render(<AuditEventList events={[
      {
        id: "00000000-0000-4000-8000-000000000001",
        action: "knowledge.archived",
        targetType: "knowledge",
        targetId: "00000000-0000-4000-8000-000000000011",
        summary: "归档知识资料「退款规则.md」",
        actorName: "演示用户",
        data: {},
        createdAt: "2026-09-25T00:00:00.000Z",
      },
      {
        id: "00000000-0000-4000-8000-000000000002",
        action: "memory.restored",
        targetType: "memory",
        targetId: "00000000-0000-4000-8000-000000000012",
        summary: "恢复助手经验",
        actorName: "演示用户",
        data: {},
        createdAt: "2026-09-25T00:01:00.000Z",
      },
    ]} />);

    expect(screen.getByText("归档资料")).toBeVisible();
    expect(screen.getByText("恢复经验")).toBeVisible();
  });
});
