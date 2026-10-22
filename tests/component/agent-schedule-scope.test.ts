import { describe, expect, it } from "vitest";
import { agentScheduleHref, agentScheduleReturnHref, matchesAgentScheduleScope, parseAgentScheduleScope } from "@/features/schedules/agent-schedule-scope";

const first = "00000000-0000-4000-8000-0000000000ab";
const second = "00000000-0000-4000-8000-0000000000ac";

describe("助手计划范围与安全返回", () => {
  it("只有缺省条件表示全部计划，合法唯一编号统一大小写", () => {
    expect(parseAgentScheduleScope(undefined)).toEqual({ kind: "all" });
    expect(parseAgentScheduleScope(first.toUpperCase())).toEqual({ kind: "agent", agentId: first });
  });

  it.each(["", "  " + first, first + " ", "other", "https://example.com", "../agents", [first], [first, first], [first, second]].map((value) => ({ value })))("无效或重复范围不回退为全部计划：$value", ({ value }) => {
    const scope = parseAgentScheduleScope(value);
    expect(scope).toEqual({ kind: "invalid" });
    expect(matchesAgentScheduleScope(scope, first)).toBe(false);
    expect(matchesAgentScheduleScope(scope, second)).toBe(false);
  });

  it("仅同助手记录匹配，不修改输入范围对象", () => {
    const scope = Object.freeze(parseAgentScheduleScope(first));
    expect(matchesAgentScheduleScope(scope, first.toUpperCase())).toBe(true);
    expect(matchesAgentScheduleScope(scope, second)).toBe(false);
    expect(matchesAgentScheduleScope({ kind: "all" }, second)).toBe(true);
    expect(scope).toEqual({ kind: "agent", agentId: first });
  });

  it("入口与返回只生成经过共享编号契约校验的本地地址", () => {
    expect(agentScheduleHref(first.toUpperCase())).toBe(`/schedules?agent=${first}`);
    expect(agentScheduleReturnHref(first.toUpperCase())).toBe(`/agents/${first}`);
    expect(agentScheduleHref("//example.com")).toBeNull();
    expect(agentScheduleReturnHref("../agents")).toBeNull();
  });
});
