import { describe, expect, it } from "vitest";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { auditEventValues } from "@/server/audit/event-values";

describe("操作记录写入值", () => {
  it("超长业务名称不会让主事务因摘要长度失败", () => {
    const values = auditEventValues({
      workspaceId: DEMO_WORKSPACE_ID,
      createdBy: DEMO_USER_ID,
      action: "knowledge.uploaded",
      targetType: "knowledge",
      targetId: "00000000-0000-4000-8000-000000000091",
      summary: `上传知识资料「${"很长的文件名".repeat(50)}.pdf」`,
      data: {},
    });

    expect(values.summary).toHaveLength(200);
    expect(values.summary.endsWith("…")).toBe(true);
  });

  it("截断时不会留下半个 Unicode 代理字符", () => {
    const values = auditEventValues({
      workspaceId: DEMO_WORKSPACE_ID,
      createdBy: DEMO_USER_ID,
      action: "agent.created",
      targetType: "agent",
      targetId: null,
      summary: `${"甲".repeat(198)}😀尾部`,
      data: {},
    });

    expect(values.summary).toBe(`${"甲".repeat(198)}…`);
  });
});
