import { describe, expect, it } from "vitest";
import { AgentTargetOption } from "@/contracts/agent";
import { checkWebToolDesign, createWebToolDesignDraft, designFieldsFromTarget, isDesignOrigin,
  readWebToolDesignJson, reorderDesignItem, splitDesignLines, WebToolDesignDraft } from "./web-tool-design-draft";

const target = AgentTargetOption.parse({ agentId: "11111111-1111-4111-8111-111111111111", agentName: "业务报告助手",
  versionId: "22222222-2222-4222-8222-222222222222", version: 2,
  inputContract: { fields: [{ name: "business_text", label: "业务正文", required: true, type: "string" },
    { name: "quantity", required: false, type: "number" }] }, outputContract: { fields: [] } });

function validDraft() {
  return { ...createWebToolDesignDraft(), name: "网页工具", fields: designFieldsFromTarget(target) };
}

describe("网页工具本页设计草稿", () => {
  it("初始空设计稳定，不产生助手、样本、结果模块或公开链接", () => {
    expect(createWebToolDesignDraft()).toEqual(createWebToolDesignDraft());
    expect(createWebToolDesignDraft()).toMatchObject({ name: "", versionId: "", slug: "", fields: [], modules: [] });
    expect(checkWebToolDesign(createWebToolDesignDraft(), null)).toContainEqual({ step: 0, path: ["name"], message: "请填写不超过 200 字的工具名称" });
  });

  it("从真实共享输入契约生成表单，保留类型和必填且不改来源", () => {
    const before = JSON.stringify(target);
    expect(designFieldsFromTarget(target)).toMatchObject([
      { name: "business_text", label: "业务正文", required: true, type: "string", rows: 3 },
      { name: "quantity", label: "输入项 2", required: false, type: "number", rows: 1 },
    ]);
    expect(JSON.stringify(target)).toBe(before);
  });

  it("200 字名称完整接受，超长、重复、保留字段拒绝", () => {
    expect(WebToolDesignDraft.safeParse({ ...validDraft(), name: "A".repeat(200) }).success).toBe(true);
    expect(WebToolDesignDraft.safeParse({ ...validDraft(), name: "A".repeat(201) }).success).toBe(false);
    const draft = validDraft();
    expect(WebToolDesignDraft.safeParse({ ...draft, fields: [draft.fields[0], { ...draft.fields[0], id: "second" }] }).success).toBe(false);
    expect(WebToolDesignDraft.safeParse({ ...draft, fields: [{ ...draft.fields[0], name: "__proto__" }] }).success).toBe(false);
    expect(WebToolDesignDraft.safeParse({ ...draft, fields: [{ ...draft.fields[0], name: "bad-field" }] }).success).toBe(false);
  });

  it("同区重复项目及未知结构字段不能导入", () => {
    const draft = validDraft();
    expect(WebToolDesignDraft.safeParse({ ...draft, fields: [draft.fields[0], { ...draft.fields[1], id: draft.fields[0].id }] }).success).toBe(false);
    expect(readWebToolDesignJson(JSON.stringify({ ...draft, token: "不是允许的配置字段" })).ok).toBe(false);
  });

  it.each(["https://example.com", "https://example.com/", "http://localhost:3300"])("接受网站来源 %s 但不发请求", (origin) => {
    expect(isDesignOrigin(origin)).toBe(true);
  });

  it.each(["example.com", "javascript:alert(1)", "https://a.example/path", "https://user:pass@a.example", "https://a.example?x=1", "https://a.example#part"])("拒绝非来源 %s", (origin) => {
    expect(isDesignOrigin(origin)).toBe(false);
  });

  it("指定网站不能为空，访问上限为正数且日上限不小于小时上限", () => {
    expect(checkWebToolDesign({ ...validDraft(), audienceType: "domain_sites" }, [])).toContainEqual({ step: 3, path: ["domains"], message: "请至少填写一个指定网站" });
    for (const maxPerHour of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(WebToolDesignDraft.safeParse({ ...validDraft(), maxPerHour }).success).toBe(false);
    }
    expect(checkWebToolDesign({ ...validDraft(), maxPerHour: 101, maxPerDay: 100 }, [])).toContainEqual({ step: 3, path: ["maxPerDay"], message: "每天上限不能小于每小时上限" });
    expect(WebToolDesignDraft.safeParse({ ...validDraft(), maxCostUnits: 0.5 }).success).toBe(true);
    expect(splitDesignLines("https://a.example\n https://b.example，https://c.example")).toEqual(["https://a.example", "https://b.example", "https://c.example"]);
  });

  it("来源未知与没有来源区分，不生成替代版本", () => {
    const draft = { ...validDraft(), versionId: target.versionId };
    expect(checkWebToolDesign(draft, [target])).toEqual([]);
    expect(checkWebToolDesign(draft, null)).toContainEqual({ step: 0, source: true, path: ["versionId"], message: "正式助手读取失败，当前无法核对所选版本；设计填写已保留" });
    expect(checkWebToolDesign(draft, [])).toContainEqual({ step: 0, source: true, path: ["versionId"], message: "所选正式版本已不在当前列表中，请重新选择；设计填写已保留" });
    expect(checkWebToolDesign(validDraft(), null)).toEqual([]);
  });

  it("重排保留全部项目且不改变原数组，越界不修改", () => {
    const items = ["正文", "评分", "风险"];
    expect(reorderDesignItem(items, 1, -1)).toEqual(["评分", "正文", "风险"]);
    expect(reorderDesignItem(items, 1, 1)).toEqual(["正文", "风险", "评分"]);
    expect(items).toEqual(["正文", "评分", "风险"]);
    expect(reorderDesignItem(items, 0, -1)).toBe(items);
    expect(reorderDesignItem(items, 2, 1)).toBe(items);
    expect(reorderDesignItem(items, -1, 1)).toBe(items);
  });

  it("专业结构解析只返回合法草稿，损坏或超限不会变成空成功", () => {
    const draft = validDraft();
    expect(readWebToolDesignJson(JSON.stringify(draft))).toEqual({ ok: true, draft });
    expect(readWebToolDesignJson("{")).toEqual({ ok: false, message: "配置不是有效的结构化文本；原草稿未变" });
    expect(readWebToolDesignJson("x".repeat(100 * 1024 + 1))).toEqual({ ok: false, message: "专业配置不能超过 100 千字节" });
    expect(readWebToolDesignJson(JSON.stringify({ ...draft, modules: [{ id: "m", title: "结果", source: "result", enabled: true, component: "Unsupported", description: "" }] })).ok).toBe(false);
  });
});
