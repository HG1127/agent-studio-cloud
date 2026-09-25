import { describe, expect, it } from "vitest";
import { AuditEventCreate, AuditEventFilters } from "@/contracts/audit-event";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";

describe("操作记录契约", () => {
  it("接受受控的关键设计变更记录", () => {
    expect(AuditEventCreate.parse({
      workspaceId: DEMO_WORKSPACE_ID,
      createdBy: DEMO_USER_ID,
      action: "version.published",
      targetType: "version",
      targetId: "00000000-0000-4000-8000-000000000100",
      summary: "发布助手版本 3",
      data: { version: 3, release: "production" },
    }).action).toBe("version.published");
  });

  it("拒绝未知动作、类型和过长筛选词", () => {
    expect(AuditEventCreate.safeParse({
      workspaceId: DEMO_WORKSPACE_ID,
      createdBy: DEMO_USER_ID,
      action: "secret.changed",
      targetType: "secret",
      summary: "修改密钥",
    }).success).toBe(false);
    expect(AuditEventFilters.safeParse({ query: "字".repeat(201) }).success).toBe(false);
  });

  it("接受知识资料与经验的关键状态变更", () => {
    expect(AuditEventCreate.safeParse({
      workspaceId: DEMO_WORKSPACE_ID,
      createdBy: DEMO_USER_ID,
      action: "knowledge.archived",
      targetType: "knowledge",
      targetId: "00000000-0000-4000-8000-000000000101",
      summary: "归档知识资料",
    }).success).toBe(true);
    expect(AuditEventFilters.safeParse({ targetType: "memory" }).success).toBe(true);
    expect(AuditEventCreate.safeParse({
      workspaceId: DEMO_WORKSPACE_ID,
      createdBy: DEMO_USER_ID,
      action: "evaluation.started",
      targetType: "evaluation",
      targetId: "00000000-0000-4000-8000-000000000102",
      summary: "启动自动验收",
      data: { caseCount: 3 },
    }).success).toBe(true);
  });
});
