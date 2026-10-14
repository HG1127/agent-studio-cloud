import { describe, expect, it } from "vitest";
import { AuditFixActionResult, AuditIssueView } from "./audit";
import { auditWorkflow } from "@/server/domain/audit";

const legacyIssue = {
  id: "legacy-issue", severity: "critical" as const, title: "步骤需要检查", detail: "请核对步骤配置", fixable: false,
} satisfies AuditIssueView;

describe("审计步骤关联兼容契约", () => {
  it("旧五字段值仍可赋予共享类型，解析后关联未知而不是猜测步骤", () => {
    expect(AuditIssueView.parse(legacyIssue)).toEqual({ ...legacyIssue, nodeId: null });
    expect(AuditIssueView.parse({ ...legacyIssue, nodeId: undefined }).nodeId).toBeNull();
  });
  it("保留显式未知，不使用问题标识或标题猜测节点", () => {
    expect(AuditIssueView.parse({ ...legacyIssue, id: "work", title: "检查 work", nodeId: null }).nodeId).toBeNull();
  });
  it("真实字符串关联逐字保留，不重命名、截断或只接受顶层安全名称", () => {
    for (const nodeId of ["work", "group.step", "分组.步骤", "x".repeat(1000), ""]) {
      expect(AuditIssueView.parse({ ...legacyIssue, nodeId }).nodeId).toBe(nodeId);
    }
  });
  it("非文字关联不能静默归为未知", () => {
    for (const nodeId of [123, false, {}, []]) {
      expect(AuditIssueView.safeParse({ ...legacyIssue, nodeId }).success).toBe(false);
    }
  });
  it("只增加步骤关联，原内部类别和规则代码仍不进入共享视图", () => {
    const result = AuditIssueView.parse({ ...legacyIssue, nodeId: "work", category: "internal-category", code: "internal-code" });
    expect(result).toEqual({ ...legacyIssue, nodeId: "work" });
  });
  it("实际审计产生的步骤问题经过投影后仍能定位同一步骤", () => {
    const actual = auditWorkflow({
      id: "audit-contract-probe", startNodeId: "start", rootAgent: { id: "audit-owner" },
      memoryPolicy: { taskContext: true, longTerm: false },
      nodes: { start: { id: "start", title: "开始", type: "trigger", next: "work" },
        work: { id: "work", title: "整理输入", type: "ai", next: null } },
    });
    const linked = actual.issues.find((issue) => issue.code === "dead_end" && issue.nodeId === "work");
    expect(linked).toBeDefined();
    if (!linked) throw new Error("实际审计未返回步骤问题");
    expect(AuditIssueView.parse(linked)).toEqual({
      id: linked.id, severity: linked.severity, title: linked.title, detail: linked.detail, nodeId: "work", fixable: linked.fixable,
    });
    const general = actual.issues.find((issue) => issue.nodeId === null);
    expect(general).toBeDefined();
    expect(AuditIssueView.parse(general).nodeId).toBeNull();
  });
  it("安全修复结果的旧结构和错误分支不改变", () => {
    const success = { ok: true, applied: [], skipped: [], remainingCritical: 1, remainingWarnings: 0 };
    expect(AuditFixActionResult.parse(success)).toEqual(success);
    expect(AuditFixActionResult.parse({ ok: false, error: "不能确认修复" })).toEqual({ ok: false, error: "不能确认修复" });
  });
});
