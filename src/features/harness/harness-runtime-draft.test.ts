import { describe, expect, it } from "vitest";
import {
  HarnessRuntimeDraft, HarnessRuleDesignDraft, emptyRuntimeDraft, emptyRuleDesignDraft,
  hasLocalDraft, draftErrors, runtimeDraftSummary, ruleDesignSummary,
} from "./harness-runtime-draft";

function validRuntime(): HarnessRuntimeDraft {
  return { recovery: "safe_default", reviewer: "contract_safety", memoryItems: "5", memoryChars: "4000", blockSensitive: "yes", samplingRate: "50", evaluateFailures: "yes", evaluateHuman: "yes", regressionCandidate: "no", planner: "workflow_static", contextChars: "12000" };
}
function validRule(): HarnessRuleDesignDraft {
  return { name: "外部操作先确认", step: "tool", effect: "require_approval", role: "operator", environment: "test" };
}

describe("仅本页 Harness 默认规则草稿", () => {
  it("空白不填入旧版或服务端默认值，检查不能通过", () => {
    const draft = emptyRuntimeDraft();
    expect(Object.values(draft).every((value) => value === "")).toBe(true);
    expect(hasLocalDraft(draft)).toBe(false);
    const checked = HarnessRuntimeDraft.safeParse(draft);
    expect(checked.success).toBe(false);
    if (checked.success) throw new Error("空白草稿被误接纳");
    const errors = draftErrors(checked.error.issues);
    expect(Object.keys(errors)[0]).toBe("recovery");
    expect(Object.keys(errors)).toHaveLength(11);
  });
  it("有效填写仍只是本地字符串草稿，不生成生产保存请求", () => {
    const draft = validRuntime();
    expect(HarnessRuntimeDraft.parse(draft)).toEqual(draft);
    expect(hasLocalDraft(draft)).toBe(true);
    expect(draft).not.toHaveProperty("requestId");
    expect(draft).not.toHaveProperty("confirmed");
  });
  it.each([
    ["memoryItems", "0", "20", "-1", "21"],
    ["memoryChars", "0", "20000", "-1", "20001"],
    ["samplingRate", "0", "100", "-1", "101"],
    ["contextChars", "2000", "60000", "1999", "60001"],
  ] as const)("%s 的旧版范围上下界严格检查", (field, min, max, below, above) => {
    for (const value of [min, max]) expect(HarnessRuntimeDraft.safeParse({ ...validRuntime(), [field]: value }).success).toBe(true);
    for (const value of [below, above]) expect(HarnessRuntimeDraft.safeParse({ ...validRuntime(), [field]: value }).success).toBe(false);
  });
  it.each(["", " ", "1.5", "1e1", "Infinity", "NaN", "0x10", "9007199254740993"])("容量填写不隐式转换无效数字：%s", (value) => {
    expect(HarnessRuntimeDraft.safeParse({ ...validRuntime(), memoryItems: value }).success).toBe(false);
  });
  it.each(["recovery", "reviewer", "blockSensitive", "evaluateFailures", "evaluateHuman", "regressionCandidate", "planner"])("%s 的未知与未选择状态不能当默认值", (field) => {
    expect(HarnessRuntimeDraft.safeParse({ ...validRuntime(), [field]: "" }).success).toBe(false);
    expect(HarnessRuntimeDraft.safeParse({ ...validRuntime(), [field]: "unknown" }).success).toBe(false);
  });
  it("不接纳生产字段、undefined 或数字替代填写字符串", () => {
    expect(HarnessRuntimeDraft.safeParse({ ...validRuntime(), confirmed: true }).success).toBe(false);
    expect(HarnessRuntimeDraft.safeParse({ ...validRuntime(), memoryItems: undefined }).success).toBe(false);
    expect(HarnessRuntimeDraft.safeParse({ ...validRuntime(), memoryItems: 5 }).success).toBe(false);
  });
  it("无效容量摘要不把填写当成合法设置；空白保持未知", () => {
    expect(runtimeDraftSummary(emptyRuntimeDraft()).join(" ")).toContain("尚未选择");
    expect(runtimeDraftSummary({ ...validRuntime(), contextChars: "60001" }).join(" ")).toContain("上下文容量：填写待检查");
    expect(runtimeDraftSummary(validRuntime()).join(" ")).toContain("常规任务抽查：50 %");
  });
  it("错误仅取每个字段首条，保留表单顺序便于定位", () => {
    expect(draftErrors([{ path: ["memoryItems"], message: "首条" }, { path: ["memoryItems"], message: "次条" }, { path: ["planner"], message: "计划" }])).toEqual({ memoryItems: "首条", planner: "计划" });
  });
});

describe("仅本页其他规则效果与身份环境设计", () => {
  it("规则与模拟条件没有假初始选择，也不生成身份或判决", () => {
    expect(hasLocalDraft(emptyRuleDesignDraft())).toBe(false);
    expect(HarnessRuleDesignDraft.safeParse(emptyRuleDesignDraft()).success).toBe(false);
    const parsed = HarnessRuleDesignDraft.parse(validRule());
    expect(parsed).toEqual(validRule());
    expect(parsed).not.toHaveProperty("allowed");
    expect(parsed).not.toHaveProperty("matchedRuleIndex");
  });
  it.each(["require_approval", "deny", "observe", "allow"] as const)("%s 只形成设计摘要，不称已执行", (effect) => {
    const draft = { ...validRule(), effect };
    expect(HarnessRuleDesignDraft.safeParse(draft).success).toBe(true);
    expect(ruleDesignSummary(draft).join(" ")).toContain("设计意图");
    expect(ruleDesignSummary(draft).join(" ")).not.toContain("已生效");
  });
  it("未知类型和角色、超长或空名称、生产额外字段不通过", () => {
    for (const change of [{ step: "unknown" }, { role: "unknown" }, { environment: "unknown" }, { name: " " }, { name: "名".repeat(101) }, { revision: 1 }]) {
      expect(HarnessRuleDesignDraft.safeParse({ ...validRule(), ...change }).success).toBe(false);
    }
  });
  it("摘要严格注明审批、仅记录的接口缺口和允许的权限边界", () => {
    expect(ruleDesignSummary(validRule()).join(" ")).toContain("不会产生审批或暂停任务");
    expect(ruleDesignSummary({ ...validRule(), effect: "observe" }).join(" ")).toContain("不会生成命中或审计记录");
    expect(ruleDesignSummary({ ...validRule(), effect: "allow" }).join(" ")).toContain("不能绕过权限或安全拦截");
  });
});
