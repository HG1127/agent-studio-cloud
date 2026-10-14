import { describe, expect, it } from "vitest";
import { approvalDecisionPolicy, approvalTaskState, normalizeApprovalNote } from "@/server/domain/approval/decision-policy";
import { RunStatus } from "@/contracts/run";

describe("程序化审批决定和恢复策略", () => {
  it("备注按去空白及凭据隐藏后的内容核对，不移除业务邮箱和零值", () => {
    expect(normalizeApprovalNote("  金额0，联系 finance@example.com，secret=private-value  ")).toBe("金额0，联系 finance@example.com，[已隐藏敏感信息]");
    expect(normalizeApprovalNote("   ")).toBeNull();
    expect(normalizeApprovalNote()).toBeNull();
  });
  it.each(RunStatus.options)("待确认记录在 %s 状态下仅允许真实等待时提交", (runStatus) => {
    expect(approvalDecisionPolicy({ status: "pending", note: null, runStatus, consumed: false, request: { decision: "approved" } })).toBe(runStatus === "waiting_approval" ? "decide" : "unavailable");
  });
  it.each(["approved", "rejected"] as const)("同一 %s 决定及备注可以补偿恢复", (status) => {
    expect(approvalDecisionPolicy({ status, note: "已核对", runStatus: "waiting_approval", consumed: false, request: { decision: status, note: " 已核对 " } })).toBe("resume");
  });
  it.each(["running", "waiting_event", "completed", "failed"] as const)("已保存的原请求在 %s 状态找回决定，不再恢复旧 Hook", (runStatus) => {
    expect(approvalDecisionPolicy({ status: "approved", note: null, runStatus, consumed: false, request: { decision: "approved" } })).toBe("accepted");
  });
  it("运行等待下一项确认时，已消费的旧确认仍能按原请求找回", () => {
    expect(approvalTaskState("approved", "waiting_approval", true)).toBe("processed");
    expect(approvalDecisionPolicy({ status: "approved", note: "第一次", runStatus: "waiting_approval", consumed: true, request: { decision: "approved", note: "第一次" } })).toBe("accepted");
  });
  it.each([{ decision: "rejected" as const, note: "原备注" }, { decision: "approved" as const, note: "已改动" }, { decision: "approved" as const }])("决定或备注不一致明确冲突 %j", (request) => {
    expect(approvalDecisionPolicy({ status: "approved", note: "原备注", runStatus: "completed", consumed: true, request })).toBe("conflict");
  });
  it("取消后未消费的决定不再恢复，但已经消费的历史决定仍可查回", () => {
    expect(approvalTaskState("approved", "cancelled", false)).toBe("unavailable");
    expect(approvalTaskState("approved", "cancelled", true)).toBe("processed");
    expect(approvalTaskState("unknown", "waiting_approval", true)).toBe("unavailable");
  });
});
