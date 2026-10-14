import { describe, expect, it } from "vitest";
import { RunExecutionClaim, type RunExecutionBinding } from "@/contracts/run-execution-binding";
import { runInitializationIssue, runStartAcknowledgementDisposition } from "./run-execution-binding";

const TOKEN = "123e4567-e89b-42d3-a456-426614174000";
const OTHER_TOKEN = "123e4567-e89b-42d3-a456-426614174001";
const claim = RunExecutionClaim.parse({ sdkRunId: "wrun_owner", startToken: TOKEN });
const binding = (overrides: Partial<RunExecutionBinding> = {}): RunExecutionBinding => ({ status: "queued", sdkRunId: null, startToken: TOKEN, ...overrides });

describe("运行初始化身份", () => {
  it("未绑定的排队运行可以领取，同一已绑定执行者可以重入", () => {
    expect(runInitializationIssue(binding(), claim)).toBeNull();
    expect(runInitializationIssue(binding({ sdkRunId: claim.sdkRunId }), claim)).toBeNull();
    expect(runInitializationIssue(binding({ status: "running", sdkRunId: claim.sdkRunId }), claim)).toBeNull();
  });
  it.each(["queued", "running"] as const)("%s 中其他执行者不能只凭相同租约继续", (status) => {
    expect(runInitializationIssue(binding({ status, sdkRunId: "wrun_other" }), claim)).toContain("其他执行请求");
  });
  it.each([OTHER_TOKEN, null])("租约已更换或撤销时不能继续", (startToken) => {
    expect(runInitializationIssue(binding({ startToken }), claim)).toContain("新的请求接管");
  });
  it.each(["waiting_approval", "waiting_event", "completed", "failed", "cancelled"] as const)("%s 不可迟到初始化", (status) => {
    expect(runInitializationIssue(binding({ status }), claim)).toContain("不能重新启动");
  });
  it("历史运行中但未绑定执行者保持未知，不认领或重置跟踪覆盖", () => {
    expect(runInitializationIssue(binding({ status: "running" }), claim)).toContain("尚未确认");
  });
  it("无租约根运行和内联子运行允许绑定实际共享执行者", () => {
    const inline = { ...claim, startToken: null };
    expect(runInitializationIssue(binding({ startToken: null }), inline)).toBeNull();
    expect(runInitializationIssue(binding({ status: "running", sdkRunId: claim.sdkRunId, startToken: null }), inline)).toBeNull();
    expect(runInitializationIssue(binding(), inline)).toContain("新的请求接管");
  });
  it.each(["", " wrun_owner", "wrun_owner\n", "x".repeat(201)])("无效执行身份不能形成领取凭证", (sdkRunId) => {
    expect(RunExecutionClaim.safeParse({ ...claim, sdkRunId }).success).toBe(false);
  });
  it("缺失或损坏绑定不靠省略字段确认执行者", () => {
    expect(runInitializationIssue(null, claim)).toContain("尚未确认");
    expect(runInitializationIssue({ status: "running", startToken: TOKEN }, claim)).toContain("尚未确认");
  });
});

describe("迟到启动回包的取消边界", () => {
  it.each(["queued", "running", "waiting_approval", "waiting_event", "completed", "failed"] as const)("同一执行者在 %s 保留，不因租约已清除误取消", (status) => {
    expect(runStartAcknowledgementDisposition(binding({ status, sdkRunId: claim.sdkRunId, startToken: null }), claim)).toBe("preserve");
  });
  it("明确取消先提交时只取消这个回包的执行句柄", () => {
    expect(runStartAcknowledgementDisposition(binding({ status: "cancelled", sdkRunId: claim.sdkRunId, startToken: null }), claim)).toBe("cancel");
  });
  it("已由另一执行者绑定或租约明确接管时取消迟到句柄", () => {
    expect(runStartAcknowledgementDisposition(binding({ sdkRunId: "wrun_other" }), claim)).toBe("cancel");
    expect(runStartAcknowledgementDisposition(binding({ startToken: OTHER_TOKEN }), claim)).toBe("cancel");
  });
  it("读取未知、未绑定同租约、历史完成但未绑定都不证明应取消", () => {
    for (const value of [null, {}, binding(), binding({ status: "running" }), binding({ status: "completed", startToken: null })]) {
      expect(runStartAcknowledgementDisposition(value, claim)).toBe("preserve");
    }
  });
  it("未绑定但已失败的记录不可被新执行复活", () => {
    expect(runStartAcknowledgementDisposition(binding({ status: "failed" }), claim)).toBe("cancel");
  });
});
