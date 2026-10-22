import { describe, expect, it } from "vitest";
import { RunContextFilters, runContextHref } from "@/features/harness/run-context-navigation";
import { CONTEXT_PREVIEW_CHARACTERS, contextResultPreview } from "@/features/harness/run-context-preview";

describe("快照范围与只读地址", () => {
  it("默认第一页，搜索去两端空白，分页保留所选任务与来源筛选", () => {
    expect(RunContextFilters.parse({})).toEqual({ page: 1, query: "" });
    const scope = RunContextFilters.parse({ page: "2", query: "  合同 & 核对  " });
    const runId = "00000000-0000-4000-8000-000000000091";
    const href = runContextHref(runId, scope);
    const url = new URL(href, "https://example.test");
    expect(url.pathname).toBe("/harness");
    expect(url.searchParams.get("run")).toBe(runId);
    expect(url.searchParams.get("contextPage")).toBe("2");
    expect(url.searchParams.get("contextQuery")).toBe("合同 & 核对");
    expect(url.hash).toBe("#saved-context");
    expect(runContextHref(runId, { page: 1, query: "" })).toBe(`/harness?run=${runId}#saved-context`);
  });
  it("生成快照地址也遵守真实任务编号契约，不生成不可恢复的任务地址", () => {
    expect(() => runContextHref("实际任务", { page: 1, query: "" })).toThrow();
  });
  it.each(["0", "-1", "1e2", "01", "", "10001", "not-a-page", ["1", "2"]])("拒绝无效或重复快照页码 %j，不悄悄回第一页", (page) => {
    expect(RunContextFilters.safeParse({ page }).success).toBe(false);
  });
  it("来源筛选拒绝过长内容与重复参数", () => {
    expect(RunContextFilters.safeParse({ query: "字".repeat(101) }).success).toBe(false);
    expect(RunContextFilters.safeParse({ query: ["合同", "财务"] }).success).toBe(false);
  });
});

describe("有界脱敏快照预览", () => {
  it.each([0, false, "", [], {}, null].map((value) => ({ value })))("保留真实值 %j，不依赖真假判断", ({ value }) => {
    const preview = contextResultPreview(value);
    expect(preview.readable).toBe(true);
    if (preview.readable) {
      expect(preview.value).toEqual(value);
      expect(preview.shortened).toBe(false);
    }
  });
  it("先完整脱敏再截取，隐藏常见内部关联字段与敏感字典键", () => {
    const original = { runId: "内部任务", password: "private-password", output: "邮箱：staff@example.test", "联系人staff@example.test": "正文" };
    const preview = contextResultPreview(original);
    expect(preview.readable).toBe(true);
    if (preview.readable) {
      expect(JSON.stringify(preview.value)).not.toMatch(/内部任务|private-password|staff@example/);
      expect(JSON.stringify(preview.value)).toContain("已隐藏敏感信息");
      expect(preview.shortened).toBe(true);
    }
    expect(original.password).toBe("private-password");
  });
  it("条件分支引用只在已知条件步骤的预览中排除", () => {
    const normal = contextResultPreview({ next: "内部目标", matched: "内部分支", message: "符合要求" });
    const condition = contextResultPreview({ next: "内部目标", matched: "内部分支", message: "符合要求" }, "condition");
    expect(normal.readable && normal.value).toEqual({ next: "内部目标", matched: "内部分支", message: "符合要求" });
    expect(condition.readable && condition.value).toEqual({ message: "符合要求" });
  });
  it("长文字有总字符上限，原始内容保持不变", () => {
    const original = "业务内容".repeat(2000);
    const preview = contextResultPreview(original);
    expect(preview.readable).toBe(true);
    if (preview.readable) {
      expect(preview.value).toBe(original.slice(0, CONTEXT_PREVIEW_CHARACTERS) + "…");
      expect(preview.shortened).toBe(true);
    }
    expect(original.length).toBe(8000);
  });
  it("字符预算在各个字段间共享，不按每字段无限增加", () => {
    const preview = contextResultPreview({ summary: "甲".repeat(3000), detail: "乙".repeat(3000) });
    expect(preview.readable && preview.value).toEqual({ summary: "甲".repeat(3000), detail: "乙".repeat(1000) + "…" });
    expect(preview.readable && preview.shortened).toBe(true);
  });
  it("列表、对象和深层内容有界，明确预览省略而非原内容为空", () => {
    const list = contextResultPreview(Array.from({ length: 12 }, (_, i) => i));
    expect(list.readable && list.value).toEqual(Array.from({ length: 10 }, (_, i) => i));
    expect(list.readable && list.shortened).toBe(true);
    const object = contextResultPreview(Object.fromEntries(Array.from({ length: 12 }, (_, i) => ["项目" + i, i])));
    expect(object.readable && Object.keys(object.value as object)).toHaveLength(10);
    expect(object.readable && object.shortened).toBe(true);
    let deep: unknown = { text: "深层正文" };
    for (let i = 0; i < 10; i++) deep = { child: deep };
    const preview = contextResultPreview(deep);
    expect(preview.readable && JSON.stringify(preview.value)).toContain("预览已省略");
    expect(preview.readable && preview.shortened).toBe(true);
  });
  it("大分支集合受总节点预算限制", () => {
    const value = Array.from({ length: 10 }, () => Array.from({ length: 10 }, () => ({ text: "内容" })));
    const preview = contextResultPreview(value);
    expect(preview.readable && preview.shortened).toBe(true);
    expect(preview.readable && JSON.stringify(preview.value)).toContain("预览已省略");
  });
  it("截短后同名的长字段不互相覆盖", () => {
    const key = "很长的字段".repeat(30);
    const preview = contextResultPreview({ [key + "甲"]: "第一项", [key + "乙"]: "第二项" });
    expect(preview.readable && Object.values(preview.value as object)).toEqual(["第一项", "第二项"]);
    expect(preview.readable && preview.shortened).toBe(true);
  });
  it.each([BigInt(1), () => "无法序列化"])("不可读值不伪装为空对象", (value) => {
    expect(contextResultPreview(value)).toEqual({ readable: false });
  });
});
