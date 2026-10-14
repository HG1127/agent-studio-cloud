import { describe, expect, it } from "vitest";
import { AttentionHandlingInput, type AttentionHandlingStatus } from "@/contracts/attention-handling";
import { AttentionKind } from "@/contracts/attention-reference";
import { attentionHandlingTransition, attentionSourceState } from "@/server/domain/attention-handling";
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const reference = { kind: "run-failed" as const, id, runId: id, occurrence: "saved:failure" };
function action(name: string, kind = reference.kind as string) {
  return AttentionHandlingInput.parse({ reference: { ...reference, kind }, requestId: id, expectedRevision: 0, reason: "已核对业务系统",
    action: name, ...(["close-resolved", "accept-failure"].includes(name) ? { confirmedReviewed: true } : {}), ...(name === "accept-failure" ? { confirmedNoRetry: true } : {}) });
}
describe("待处理记录安全关闭纯规则", () => {
  it("同一任务的新等待不能继承旧记录", () => {
    expect(attentionSourceState(reference, { ...reference })).toBe("active");
    expect(attentionSourceState(reference, { ...reference, occurrence: "next:wait" })).toBe("changed");
    expect(attentionSourceState(reference, null)).toBe("inactive");
  });
  it.each(AttentionKind.options)("活跃 %s 不能通过关闭跟踪跳过业务处理", (kind) => {
    expect(attentionHandlingTransition("in-progress", action("close-resolved", kind), "active").ok).toBe(false);
    expect(attentionHandlingTransition("in-progress", action("accept-failure", kind), "active").ok).toBe(kind === "run-failed");
  });
  it.each(["changed", "inactive"] as const)("旧事项 %s 可关闭但不能重开或接手新事项", (source) => {
    expect(attentionHandlingTransition("in-progress", action("close-resolved"), source)).toEqual({ ok: true, status: "closed" });
    expect(attentionHandlingTransition("closed", action("reopen"), source).ok).toBe(false);
    expect(attentionHandlingTransition("open", action("acknowledge"), source).ok).toBe(false);
  });
  it.each(["open", "in-progress", "closed"] as AttentionHandlingStatus[])("备注保留 %s，不能悄悄关闭或重新打开", (status) => {
    expect(attentionHandlingTransition(status, action("note"), "active")).toEqual({ ok: true, status });
  });
  it("接手、接受失败关闭与明确重开分别记录，不修改传入对象", () => {
    const input = action("acknowledge"); const original = structuredClone(input);
    expect(attentionHandlingTransition("open", input, "active")).toEqual({ ok: true, status: "in-progress" });
    expect(attentionHandlingTransition("closed", input, "active").ok).toBe(false);
    expect(attentionHandlingTransition("open", action("reopen"), "active").ok).toBe(false);
    expect(attentionHandlingTransition("closed", action("reopen"), "active")).toEqual({ ok: true, status: "in-progress" });
    expect(input).toEqual(original);
  });
  it("尚有未确认副作用时，明确确认也不能接受失败关闭", () => {
    expect(attentionHandlingTransition("in-progress", action("accept-failure"), "active", true)).toMatchObject({ ok: false });
  });
  it("离开人工清单但原工具或投递仍在重试，不等于已有回执", () => {
    expect(attentionHandlingTransition("in-progress", action("close-resolved", "delivery-failed"), "inactive", false, false)).toMatchObject({ ok: false });
  });
});
